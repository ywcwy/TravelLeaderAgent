import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";
import { TravelDatabase } from "../src/database.ts";
import { TravelService } from "../src/travel-service.ts";

test("Phase 5 workflow resets, imports, and reviews one Trip end to end", () => {
  const directory = mkdtempSync(join(tmpdir(), "travel-leader-agent-phase-5-"));
  const databasePath = join(directory, "travel.sqlite");
  const markdownPath = join(directory, "trip.md");
  writeFileSync(markdownPath, "- [provisional] 東京住宿 | 2026-10-16 | 東京\n- [provisional] 東京活動 | 2026-10-17 | 東京");
  const database = new TravelDatabase(databasePath);
  const travel = new TravelService(database, "system-admin");
  const group = travel.createTravelGroup("system-admin", "C-phase-5-e2e", "Phase 5 E2E");
  const oldTrip = travel.createActiveTrip("system-admin", group.id, "舊旅程", "Asia/Taipei");
  travel.importMarkdown(oldTrip.id, "- [provisional] 舊資料 | 2026-10-01 | 台北", { idempotencyKey: "phase5:old" });
  database.close();

  const env = { ...process.env, TRAVEL_DATABASE_PATH: databasePath, TRAVEL_SYSTEM_ADMINISTRATOR_ID: "system-admin" };
  const resetOutput = execFileSync(process.execPath, ["--experimental-strip-types", "src/reset-trip.ts", oldTrip.id, "--confirm"], { cwd: process.cwd(), env, encoding: "utf8" });
  const reset = JSON.parse(resetOutput) as { activeTrip: { id: string }; archivedTrip: { status: string } };
  assert.equal(reset.archivedTrip.status, "archived");

  const importOutput = execFileSync(process.execPath, ["--experimental-strip-types", "src/import-itinerary.ts", reset.activeTrip.id, "phase5:e2e", markdownPath], { cwd: process.cwd(), env, encoding: "utf8" });
  const imported = JSON.parse(importOutput) as { outcome: string; proposalIds: string[] };
  assert.equal(imported.outcome, "created");
  assert.equal(imported.proposalIds.length, 2);

  const reviewOutput = execFileSync(process.execPath, ["--experimental-strip-types", "src/review-trip.ts", reset.activeTrip.id, "--json"], { cwd: process.cwd(), env, encoding: "utf8" });
  const review = JSON.parse(reviewOutput) as { trip: { id: string }; pendingProposals: Array<{ id: string }>; effectiveItinerary: unknown[] };
  assert.equal(review.trip.id, reset.activeTrip.id);
  assert.deepEqual(review.pendingProposals.map((proposal) => proposal.id), imported.proposalIds);
  assert.equal(review.effectiveItinerary.length, 0);
  rmSync(directory, { recursive: true, force: true });
});
