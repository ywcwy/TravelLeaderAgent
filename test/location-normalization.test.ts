import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLocation, normalizeItemLocations } from "../src/location-normalization.ts";
import { TravelDatabase } from "../src/database.ts";
import { TravelService } from "../src/travel-service.ts";

test("normalizes known aliases to city, region, country, and macro region", () => {
  assert.deepEqual(normalizeLocation("Lower Antelope Canyon"), { city: "Page", region: "Arizona", country: "United States", macroRegion: "US-West", source: "registry", confidence: "high" });
  assert.deepEqual(normalizeLocation("vegas"), { city: "Las Vegas", region: "Nevada", country: "United States", macroRegion: "US-West", source: "registry", confidence: "high" });
  assert.equal(normalizeLocation("Mather Point")?.city, "Grand Canyon Village");
  assert.equal(normalizeLocation("Indn, Route 222, Page, AZ 86040")?.city, "Page");
  assert.equal(normalizeLocation("McCarran Rent-A-Car Center")?.city, "Las Vegas");
});

test("normalizes route endpoints independently and preserves unknowns", () => {
  assert.deepEqual(normalizeItemLocations({ origin: "Tusayan", destination: "Los Angeles" }), {
    origin: { city: "Tusayan", region: "Arizona", country: "United States", macroRegion: "US-West", source: "registry", confidence: "high" },
    destination: { city: "Los Angeles", region: "California", country: "United States", macroRegion: "US-West", source: "registry", confidence: "high" },
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
