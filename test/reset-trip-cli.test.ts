import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";
import { TravelDatabase } from "../src/database.ts";
import { TravelService } from "../src/travel-service.ts";

test("reset:trip CLI requires confirmation and returns the reset result", () => {
  const directory = mkdtempSync(join(tmpdir(), "travel-leader-agent-reset-cli-"));
  const databasePath = join(directory, "travel.sqlite");
  const database = new TravelDatabase(databasePath);
  const travel = new TravelService(database, "system-admin");
  const group = travel.createTravelGroup("system-admin", "C-reset-cli", "CLI Reset");
  const trip = travel.createActiveTrip("system-admin", group.id, "舊旅程", "Asia/Taipei");
  database.close();

  const withoutConfirmation = spawnSync(process.execPath, ["--experimental-strip-types", "src/reset-trip.ts", trip.id], {
    cwd: process.cwd(),
    env: { ...process.env, TRAVEL_DATABASE_PATH: databasePath, TRAVEL_SYSTEM_ADMINISTRATOR_ID: "system-admin" },
    encoding: "utf8",
  });
  assert.equal(withoutConfirmation.status, 1);

  const output = execFileSync(process.execPath, ["--experimental-strip-types", "src/reset-trip.ts", trip.id, "--confirm", "新旅程", "Asia/Tokyo"], {
    cwd: process.cwd(),
    env: { ...process.env, TRAVEL_DATABASE_PATH: databasePath, TRAVEL_SYSTEM_ADMINISTRATOR_ID: "system-admin" },
    encoding: "utf8",
  });
  const result = JSON.parse(output) as { archivedTrip: { id: string; status: string }; activeTrip: { id: string; title: string; timezone: string }; copiedMemberCount: number };
  assert.equal(result.archivedTrip.id, trip.id);
  assert.equal(result.archivedTrip.status, "archived");
  assert.notEqual(result.activeTrip.id, trip.id);
  assert.equal(result.activeTrip.title, "新旅程");
  assert.equal(result.activeTrip.timezone, "Asia/Tokyo");
  assert.equal(result.copiedMemberCount, 0);
  rmSync(directory, { recursive: true, force: true });
});
