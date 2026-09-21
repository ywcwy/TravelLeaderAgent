import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLocation, normalizeItemLocations, resolveLocationCandidates } from "../src/location-normalization.ts";
import { TravelDatabase } from "../src/database.ts";
import { TravelService } from "../src/travel-service.ts";

test("normalizes known aliases to city, region, country, and macro region", () => {
  assert.deepEqual(normalizeLocation("Lower Antelope Canyon"), { canonicalId: "landmark:lower-antelope-canyon-page-us", canonicalName: "Lower Antelope Canyon", kind: "landmark", city: "Page", region: "Arizona", country: "United States", macroRegion: "US-West", source: "registry", confidence: "high" });
  assert.deepEqual(normalizeLocation("vegas"), { canonicalId: "city:las-vegas-us", canonicalName: "Las Vegas", kind: "city", city: "Las Vegas", region: "Nevada", country: "United States", macroRegion: "US-West", source: "registry", confidence: "high" });
  assert.equal(normalizeLocation("Mather Point")?.city, "Grand Canyon Village");
  assert.equal(normalizeLocation("Indn, Route 222, Page, AZ 86040")?.city, "Page");
  assert.equal(normalizeLocation("McCarran Rent-A-Car Center")?.city, "Las Vegas");
});

test("uses complete aliases and exposes ambiguity candidates", () => {
  assert.equal(normalizeLocation("Pageant venue")?.source, "unresolved");
  assert.equal(resolveLocationCandidates("Springfield").status, "ambiguous");
  assert.deepEqual(resolveLocationCandidates("Springfield").candidates?.map((candidate) => candidate.canonicalId), ["city:springfield-il-us", "city:springfield-mo-us"]);
});

test("normalizes route endpoints independently and preserves unknowns", () => {
  assert.deepEqual(normalizeItemLocations({ origin: "Tusayan", destination: "Los Angeles" }), {
    origin: { canonicalId: "city:tusayan-us", canonicalName: "Tusayan", kind: "city", city: "Tusayan", region: "Arizona", country: "United States", macroRegion: "US-West", source: "registry", confidence: "high" },
    destination: { canonicalId: "city:los-angeles-us", canonicalName: "Los Angeles", kind: "city", city: "Los Angeles", region: "California", country: "United States", macroRegion: "US-West", source: "registry", confidence: "high" },
  });
  assert.deepEqual(normalizeLocation("Somewhere"), { source: "unresolved", confidence: "low" });
});

test("persists normalized location fields on new Proposals", () => {
  const db = new TravelDatabase(":memory:");
  const service = new TravelService(db, "admin");
  const group = service.createTravelGroup("admin", "group", "Group");
  const trip = service.createActiveTrip("admin", group.id, "Trip", "UTC");
  service.addMember("admin", trip.id, "owner", "Owner", "owner");
  const source = service.importMarkdown(trip.id, "- [provisional] Lunch | 2026-10-02T13:00:00 | Page", { idempotencyKey: "location-normalization-test" });
  const proposal = service.getProposal(trip.id, source.proposalIds[0]);
  assert.equal(proposal?.location, "Page");
  assert.equal(proposal?.city, "Page");
  assert.equal(proposal?.region, "Arizona");
  assert.equal(proposal?.macroRegion, "US-West");
  db.close();
});

test("re-normalizes existing rows idempotently without creating records", () => {
  const db = new TravelDatabase(":memory:");
  const service = new TravelService(db, "admin");
  const group = service.createTravelGroup("admin", "group", "Group");
  const trip = service.createActiveTrip("admin", group.id, "Trip", "UTC");
  service.addMember("admin", trip.id, "owner", "Owner", "owner");
  const imported = service.importMarkdown(trip.id, "- [provisional] Stop | 2026-10-02 | Vegas", { idempotencyKey: "renormalize-test" });
  db.connection.prepare("UPDATE proposals SET location_canonical_id = NULL, location_source = 'unresolved', location_confidence = 'low' WHERE id = ?").run(imported.proposalIds[0]);
  const before = (db.connection.prepare("SELECT COUNT(*) AS count FROM proposals WHERE trip_id = ?").get(trip.id) as { count: number }).count;
  const first = service.renormalizeTripLocations(trip.id);
  const second = service.renormalizeTripLocations(trip.id);
  const proposal = service.getProposal(trip.id, imported.proposalIds[0]);
  assert.equal(first.changed, 1);
  assert.equal(second.changed, 0);
  assert.equal(proposal?.canonicalId, "city:las-vegas-us");
  assert.equal((db.connection.prepare("SELECT COUNT(*) AS count FROM proposals WHERE trip_id = ?").get(trip.id) as { count: number }).count, before);
  db.close();
});
