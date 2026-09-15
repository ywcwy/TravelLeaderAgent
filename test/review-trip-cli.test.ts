import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";
import { TravelDatabase } from "../src/database.ts";
import { TravelService } from "../src/travel-service.ts";

test("review:trip CLI renders stable JSON and human-readable Trip Review", () => {
  const directory = mkdtempSync(join(tmpdir(), "travel-leader-agent-review-cli-"));
  const databasePath = join(directory, "travel.sqlite");
  const database = new TravelDatabase(databasePath);
  const travel = new TravelService(database, "system-admin");
  const group = travel.createTravelGroup("system-admin", "C-review-cli", "CLI Review");
  const trip = travel.createActiveTrip("system-admin", group.id, "Review 旅程", "Asia/Taipei");
  travel.addMember("system-admin", trip.id, "U-owner", "Owner", "owner");
  const imported = travel.importMarkdown(trip.id, "- [confirmed] 已確認行程 | 2026-10-16 | 台北\n- [provisional] 待確認住宿 | 2026-10-17 | 台中\n- [provisional] Las Vegas → St. George | 2026-10-18 | | | shape=route | origin=Las Vegas | destination=St. George", { idempotencyKey: "review:cli" });
  travel.confirmProposal(trip.id, "U-owner", imported.proposalIds[0]);
  database.close();

  const jsonOutput = execFileSync(process.execPath, ["--experimental-strip-types", "src/review-trip.ts", trip.id, "--json"], {
    cwd: process.cwd(),
    env: { ...process.env, TRAVEL_DATABASE_PATH: databasePath },
    encoding: "utf8",
  });
  const json = JSON.parse(jsonOutput) as { trip: { id: string; title: string }; effectiveItinerary: Array<{ title: string }>; pendingProposals: Array<{ title: string }>; reviewIssues: unknown[]; counts: { confirmed: number; pending: number } };
  assert.equal(json.trip.id, trip.id);
  assert.equal(json.trip.title, "Review 旅程");
  assert.deepEqual(json.effectiveItinerary.map((item) => item.title), ["已確認行程"]);
  assert.deepEqual(json.pendingProposals.map((proposal) => proposal.title), ["Las Vegas → St. George", "待確認住宿"]);
  assert.equal(json.counts.confirmed, 1);
  assert.equal(json.counts.pending, 2);

  const humanOutput = execFileSync(process.execPath, ["--experimental-strip-types", "src/review-trip.ts", trip.id], {
    cwd: process.cwd(),
    env: { ...process.env, TRAVEL_DATABASE_PATH: databasePath },
    encoding: "utf8",
  });
  assert.match(humanOutput, /Effective Itinerary/);
  assert.match(humanOutput, /Pending Proposals/);
  assert.match(humanOutput, /已確認行程/);
  assert.match(humanOutput, /待確認住宿/);
  assert.match(humanOutput, /\[route\].*Las Vegas.*St\. George/);
  assert.match(humanOutput, /\[lodging\]/);
  rmSync(directory, { recursive: true, force: true });
});
