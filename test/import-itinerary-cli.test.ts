import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";
import { TravelDatabase } from "../src/database.ts";
import { PermissionError, TravelService } from "../src/travel-service.ts";

test("import:trip CLI persists a Markdown batch as a reviewable Draft without Proposals", () => {
  const directory = mkdtempSync(join(tmpdir(), "travel-leader-agent-import-cli-"));
  const databasePath = join(directory, "travel.sqlite");
  const markdownPath = join(directory, "itinerary.md");
  writeFileSync(markdownPath, "- [provisional] 東京住宿 | 2026-10-16 | 東京 | | start_time_flexibility=estimated | time_window=evening\n- [provisional 東京活動 | 2026-10-17 | 東京");
  const database = new TravelDatabase(databasePath);
  const travel = new TravelService(database, "system-admin");
  const group = travel.createTravelGroup("system-admin", "C-import-cli", "CLI Import");
  const trip = travel.createActiveTrip("system-admin", group.id, "匯入旅程", "Asia/Taipei");
  assert.throws(() => travel.importMarkdownDraftBatch(trip.id, "- [provisional] 未授權 | 2026-10-16 | 東京", "batch-member", "not-admin"), PermissionError);
  database.close();

  const output = execFileSync(process.execPath, ["--experimental-strip-types", "src/import-itinerary.ts", trip.id, "batch-cli-1", markdownPath], {
    cwd: process.cwd(),
    env: { ...process.env, TRAVEL_DATABASE_PATH: databasePath, TRAVEL_SYSTEM_ADMINISTRATOR_ID: "system-admin" },
    encoding: "utf8",
  });
  const result = JSON.parse(output) as { outcome: string; sourceId: string; draftId: string; proposalIds: string[]; itemCount: number; reviewIssueCount: number; dateRange: { from: string | null; to: string | null } };
  assert.equal(result.outcome, "created");
  assert.match(result.draftId, /^X-[0-9A-F]{8}$/);
  assert.equal(result.proposalIds.length, 0);
  assert.equal(result.itemCount, 1);
  assert.equal(result.reviewIssueCount, 1);
  assert.deepEqual(result.dateRange, { from: "2026-10-16", to: "2026-10-16" });
  assert.ok(result.sourceId);
  const verificationDatabase = new TravelDatabase(databasePath);
  assert.equal((verificationDatabase.connection.prepare("SELECT COUNT(*) AS count FROM proposals").get() as { count: number }).count, 0);
  const draftRow = verificationDatabase.connection.prepare("SELECT payload_json FROM extraction_drafts WHERE id = ?").get(result.draftId) as { payload_json: string };
  const draftPayload = JSON.parse(draftRow.payload_json) as { items: Array<{ startTimeFlexibility: string; timeWindow?: string }> };
  assert.equal(draftPayload.items[0]?.startTimeFlexibility, "estimated");
  assert.equal(draftPayload.items[0]?.timeWindow, "evening");
  verificationDatabase.close();

  const replayOutput = execFileSync(process.execPath, ["--experimental-strip-types", "src/import-itinerary.ts", trip.id, "batch-cli-1", markdownPath], {
    cwd: process.cwd(),
    env: { ...process.env, TRAVEL_DATABASE_PATH: databasePath, TRAVEL_SYSTEM_ADMINISTRATOR_ID: "system-admin" },
    encoding: "utf8",
  });
  assert.equal((JSON.parse(replayOutput) as { outcome: string; draftId: string }).outcome, "reused");
  writeFileSync(markdownPath, "- [provisional] 改過的內容 | 2026-10-18 | 東京");
  assert.throws(() => execFileSync(process.execPath, ["--experimental-strip-types", "src/import-itinerary.ts", trip.id, "batch-cli-1", markdownPath], {
    cwd: process.cwd(),
    env: { ...process.env, TRAVEL_DATABASE_PATH: databasePath, TRAVEL_SYSTEM_ADMINISTRATOR_ID: "system-admin" },
    encoding: "utf8",
  }), /already contains different content/);
  rmSync(directory, { recursive: true, force: true });
});
