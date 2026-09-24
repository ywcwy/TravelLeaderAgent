import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLocationInventory, findLocationRegistryEntry, inferContextualLocations, LOCATION_REGISTRY_VERSION, normalizeLocation, normalizeItemLocations, normalizeLocationQueryDimension, resolveLocationCandidates } from "../src/location-normalization.ts";
import type { LocationRegistryEntry } from "../src/location-normalization.ts";
import { TravelDatabase } from "../src/database.ts";
import { TravelService } from "../src/travel-service.ts";
import type { ExtractedTripItem } from "../src/domain.ts";

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

test("excludes inactive Registry entries from new matches while retaining them for historical canonical IDs", () => {
  const registry: readonly LocationRegistryEntry[] = [
    { canonicalId: "business:active-cafe-us", canonicalName: "Active Cafe", aliases: ["active cafe"], kind: "business", city: "Page", region: "Arizona", country: "United States", macroRegion: "US-West" },
    { canonicalId: "business:retired-cafe-us", canonicalName: "Retired Cafe", aliases: ["retired cafe"], kind: "business", status: "inactive", city: "Page", region: "Arizona", country: "United States", macroRegion: "US-West" },
  ];

  assert.equal(normalizeLocation("Active Cafe", registry)?.canonicalId, "business:active-cafe-us");
  assert.deepEqual(normalizeLocation("Retired Cafe", registry), { source: "unresolved", confidence: "low" });
  assert.deepEqual(findLocationRegistryEntry("business:retired-cafe-us", registry), registry[1]);
  assert.match(LOCATION_REGISTRY_VERSION, /^location-registry-v\d+$/);
});

test("normalizes Phase 18 cities, landmarks, and compound business locations", () => {
  assert.equal(normalizeLocation("Kanab")?.canonicalId, "city:kanab-us");
  assert.equal(normalizeLocation("St. George")?.canonicalId, "city:st-george-us");
  assert.equal(normalizeLocation("Williams, AZ")?.city, "Williams");
  assert.equal(normalizeLocation("Hopi Point")?.city, "Grand Canyon Village");
  assert.equal(normalizeLocation("Grand Canyon Visitor Center")?.canonicalName, "Grand Canyon Visitor Center");
  assert.equal(normalizeLocation("Grand Canyon Visitor Center")?.city, "Grand Canyon Village");
  assert.equal(normalizeLocation("Grand Canyon National Park")?.city, "Grand Canyon Village");
  assert.equal(normalizeLocation("Mr. D'z Route 66 Diner, Kingman")?.city, "Kingman");
  assert.equal(normalizeLocation("Delgadillo’s Snow Cap, Seligman")?.city, "Seligman");
  assert.deepEqual(normalizeLocationQueryDimension("Kanab"), { city: "Kanab" });
});

test("builds a read-only inventory of unresolved locations", () => {
  assert.deepEqual(buildLocationInventory([
    { id: "P-1", type: "proposal", location: "Visitor Center", origin: null, destination: null },
    { id: "P-2", type: "proposal", location: "Visitor Center", origin: "Kanab", destination: "Unknown Stop" },
  ]), [
    { value: "Unknown Stop", occurrences: 1, references: [{ type: "proposal", id: "P-2", field: "destination" }], candidates: [] },
    { value: "Visitor Center", occurrences: 2, references: [{ type: "proposal", id: "P-1", field: "location" }, { type: "proposal", id: "P-2", field: "location" }], candidates: [] },
  ]);
});

test("does not leak a city anchor to unrelated distant items", () => {
  const items: ExtractedTripItem[] = [
    { kind: "activity", kinds: ["activity"], shape: "point", shapeSource: "explicit", title: "Page stop", status: "provisional", localDate: "2026-10-01", location: "Page" },
    { kind: "activity", kinds: ["activity"], shape: "point", shapeSource: "explicit", title: "Unrelated", status: "provisional", localDate: "2026-10-10", location: undefined },
  ];
  assert.equal(inferContextualLocations(items)[1]?.city, undefined);
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
  assert.equal(proposal?.locationResolverVersion, LOCATION_REGISTRY_VERSION);
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

test("context-aware re-normalization fills a placeholder from an explicit nearby city", () => {
  const db = new TravelDatabase(":memory:");
  const service = new TravelService(db, "admin");
  const group = service.createTravelGroup("admin", "context-group", "Context Group");
  const trip = service.createActiveTrip("admin", group.id, "Context Trip", "UTC");
  service.addMember("admin", trip.id, "owner", "Owner", "owner");
  const imported = service.importMarkdown(trip.id, "- [provisional] Stay | 2026-10-01 | Page\n- [provisional] Breakfast | 2026-10-02 | 住宿", { idempotencyKey: "context-renormalize-test" });
  const before = service.getProposal(trip.id, imported.proposalIds[1]!);
  assert.equal(before?.canonicalId, undefined);
  const result = service.renormalizeTripLocations(trip.id, { contextual: true });
  const after = service.getProposal(trip.id, imported.proposalIds[1]!);
  assert.equal(result.changed, 1);
  assert.equal(after?.canonicalId, undefined);
  assert.equal(after?.city, "Page");
  assert.equal(after?.locationProvenance, "context_inferred");
  db.close();
});

test("preserves contextual normalization after reopening the database", () => {
  const directory = mkdtempSync(join(tmpdir(), "travel-location-"));
  const databasePath = join(directory, "travel.sqlite");
  const firstDb = new TravelDatabase(databasePath);
  const firstService = new TravelService(firstDb, "admin");
  const group = firstService.createTravelGroup("admin", "reopen-group", "Reopen Group");
  const trip = firstService.createActiveTrip("admin", group.id, "Reopen Trip", "UTC");
  firstService.addMember("admin", trip.id, "owner", "Owner", "owner");
  const imported = firstService.importMarkdown(trip.id, "- [provisional] Stay | 2026-10-01 | Page\n- [provisional] Breakfast | 2026-10-02 | 住宿", { idempotencyKey: "reopen-context-test" });
  firstService.renormalizeTripLocations(trip.id, { contextual: true });
  firstDb.close();
  const secondDb = new TravelDatabase(databasePath);
  const secondService = new TravelService(secondDb, "admin");
  const breakfast = secondService.getProposal(trip.id, imported.proposalIds[1]!);
  assert.equal(breakfast?.city, "Page");
  assert.equal(breakfast?.canonicalId, undefined);
  assert.equal(breakfast?.locationProvenance, "context_inferred");
  secondDb.close();
  rmSync(directory, { recursive: true, force: true });
});
