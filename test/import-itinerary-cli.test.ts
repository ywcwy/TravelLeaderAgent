import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";
import { TravelDatabase } from "../src/database.ts";
import { TravelService } from "../src/travel-service.ts";

test("import:trip CLI persists a Markdown batch and reports its review issues", () => {
  const directory = mkdtempSync(join(tmpdir(), "travel-leader-agent-import-cli-"));
  const databasePath = join(directory, "travel.sqlite");
  const markdownPath = join(directory, "itinerary.md");
  writeFileSync(markdownPath, "- [provisional] 東京住宿 | 2026-10-16 | 東京\n- [provisional 東京活動 | 2026-10-17 | 東京");
  const database = new TravelDatabase(databasePath);
  const travel = new TravelService(database, "system-admin");
  const group = travel.createTravelGroup("system-admin", "C-import-cli", "CLI Import");
  const trip = travel.createActiveTrip("system-admin", group.id, "匯入旅程", "Asia/Taipei");
  database.close();

  const output = execFileSync(process.execPath, ["--experimental-strip-types", "src/import-itinerary.ts", trip.id, "batch-cli-1", markdownPath], {
    cwd: process.cwd(),
    env: { ...process.env, TRAVEL_DATABASE_PATH: databasePath, TRAVEL_SYSTEM_ADMINISTRATOR_ID: "system-admin" },
    encoding: "utf8",
  });
  const result = JSON.parse(output) as { outcome: string; sourceId: string; proposalIds: string[]; reviewIssueCount: number };
  assert.equal(result.outcome, "created");
  assert.equal(result.proposalIds.length, 1);
  assert.equal(result.reviewIssueCount, 2);
  assert.ok(result.sourceId);
  rmSync(directory, { recursive: true, force: true });
});
