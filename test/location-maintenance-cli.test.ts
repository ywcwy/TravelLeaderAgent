import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TravelDatabase } from "../src/database.ts";
import { TravelService } from "../src/travel-service.ts";

function cliEnvironment(databasePath: string): NodeJS.ProcessEnv {
  return { ...process.env, TRAVEL_DATABASE_PATH: databasePath, TRAVEL_SYSTEM_ADMINISTRATOR_ID: "system-admin" };
}

function runCli(databasePath: string, script: string, ...args: string[]): string {
  return execFileSync(process.execPath, ["--experimental-strip-types", script, ...args], {
    cwd: process.cwd(),
    env: cliEnvironment(databasePath),
    encoding: "utf8",
  });
}

function locationRowSnapshot(database: TravelDatabase, tripId: string): string {
  return JSON.stringify({
    proposals: database.connection.prepare("SELECT id, location, origin, destination, location_canonical_id, city, region, country, macro_region, location_provenance FROM proposals WHERE trip_id = ? ORDER BY id").all(tripId),
    tripItems: database.connection.prepare("SELECT id, location, origin, destination, location_canonical_id, city, region, country, macro_region, location_provenance FROM trip_items WHERE trip_id = ? ORDER BY id").all(tripId),
    sourceCount: (database.connection.prepare("SELECT COUNT(*) AS count FROM sources WHERE trip_id = ?").get(tripId) as { count: number }).count,
    providerCalls: (database.connection.prepare("SELECT COALESCE(SUM(provider_calls), 0) AS calls FROM import_chunks WHERE trip_id = ?").get(tripId) as { calls: number }).calls,
  });
}

test("inventory:locations emits typed JSON references and does not write the Trip", () => {
  const directory = mkdtempSync(join(tmpdir(), "travel-location-inventory-cli-"));
  const databasePath = join(directory, "travel.sqlite");
  const database = new TravelDatabase(databasePath);
  const travel = new TravelService(database, "system-admin");
  const group = travel.createTravelGroup("system-admin", "C-location-inventory", "Location Inventory");
  const trip = travel.createActiveTrip("system-admin", group.id, "Inventory Trip", "UTC");
  travel.addMember("system-admin", trip.id, "U-owner", "Owner", "owner");
  const imported = travel.importMarkdown(trip.id, "- [provisional] Unknown stop | 2026-10-02 | Visitor Center", { idempotencyKey: "inventory:unknown" });
  travel.confirmProposal(trip.id, "U-owner", imported.proposalIds[0]!);
  database.close();

  const beforeDatabase = new TravelDatabase(databasePath, { readOnly: true });
  const before = locationRowSnapshot(beforeDatabase, trip.id);
  beforeDatabase.close();
  const output = runCli(databasePath, "src/inventory-locations.ts", trip.id, "--json");
  const result = JSON.parse(output) as {
    tripId: string;
    inventory: Array<{ value: string; occurrences: number; candidates: string[]; references: Array<{ type: string; id: string; field: string }> }>;
  };
  assert.equal(result.tripId, trip.id);
  assert.equal(result.inventory.length, 1);
  const entry = result.inventory[0]!;
  assert.equal(entry.value, "Visitor Center");
  assert.equal(entry.occurrences, 2);
  assert.deepEqual(entry.candidates, []);
  assert.deepEqual(entry.references[0], { type: "proposal", id: imported.proposalIds[0], field: "location" });
  assert.equal(entry.references[1]?.type, "trip_item");
  assert.match(entry.references[1]?.id ?? "", /^T-/);
  assert.equal(entry.references[1]?.field, "location");

  const afterDatabase = new TravelDatabase(databasePath, { readOnly: true });
  assert.equal(locationRowSnapshot(afterDatabase, trip.id), before);
  afterDatabase.close();
  rmSync(directory, { recursive: true, force: true });
});

test("normalize:locations is explicit, idempotent, and makes no provider calls", () => {
  const directory = mkdtempSync(join(tmpdir(), "travel-location-normalize-cli-"));
  const databasePath = join(directory, "travel.sqlite");
  const database = new TravelDatabase(databasePath);
  const travel = new TravelService(database, "system-admin");
  const group = travel.createTravelGroup("system-admin", "C-location-normalize", "Location Normalization");
  const trip = travel.createActiveTrip("system-admin", group.id, "Normalization Trip", "UTC");
  travel.addMember("system-admin", trip.id, "U-owner", "Owner", "owner");
  const imported = travel.importMarkdown(trip.id, "- [provisional] Las Vegas stop | 2026-10-02 | Vegas", { idempotencyKey: "normalize:vegas" });
  database.connection.prepare("UPDATE proposals SET location_canonical_id = NULL, city = NULL, region = NULL, country = NULL, macro_region = NULL, location_source = 'unresolved', location_confidence = 'low', location_provenance = 'unresolved', location_inference_evidence = NULL, location_resolver_version = NULL WHERE id = ?").run(imported.proposalIds[0]!);
  database.connection.prepare("INSERT INTO import_chunks (id, trip_id, source_id, import_batch_id, ordinal, start_line, end_line, content_hash, content, status, attempts, provider_calls, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run("C-maintenance", trip.id, imported.sourceId, "maintenance-test", 0, 1, 1, "maintenance-hash", "source", "completed", 1, 7, "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z");
  database.close();

  const first = JSON.parse(runCli(databasePath, "src/renormalize-locations.ts", trip.id, "--json")) as { tripId: string; proposals: number; tripItems: number; changed: number };
  const second = JSON.parse(runCli(databasePath, "src/renormalize-locations.ts", trip.id, "--json")) as { tripId: string; proposals: number; tripItems: number; changed: number };
  assert.deepEqual(first, { tripId: trip.id, proposals: 1, tripItems: 0, changed: 1 });
  assert.deepEqual(second, { tripId: trip.id, proposals: 1, tripItems: 0, changed: 0 });

  const verification = new TravelDatabase(databasePath, { readOnly: true });
  const proposal = verification.connection.prepare("SELECT location_canonical_id, city, region, country, macro_region FROM proposals WHERE id = ?").get(imported.proposalIds[0]!) as { location_canonical_id: string; city: string; region: string; country: string; macro_region: string };
  const providerCalls = verification.connection.prepare("SELECT provider_calls FROM import_chunks WHERE id = ?").get("C-maintenance") as { provider_calls: number };
  assert.deepEqual({ ...proposal }, { location_canonical_id: "city:las-vegas-us", city: "Las Vegas", region: "Nevada", country: "United States", macro_region: "US-West" });
  assert.equal(providerCalls.provider_calls, 7);
  verification.close();
  rmSync(directory, { recursive: true, force: true });
});
