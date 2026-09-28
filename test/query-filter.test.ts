import assert from "node:assert/strict";
import test from "node:test";
import { DeterministicQueryFilterAdapter, validateQueryFilter } from "../src/query-filter.ts";

test("validates Proposal Kind Query Filters", () => {
  assert.deepEqual(validateQueryFilter({ kind: "shopping" }), { kind: "shopping" });
});

test("normalizes shopping wording into the existing shopping kind", () => {
  const adapter = new DeterministicQueryFilterAdapter();
  assert.deepEqual(adapter.interpret({ text: "什麼時候會有逛街行程", tripTimezone: "Asia/Taipei", currentDate: "2026-09-21" }), { kind: "shopping" });
  assert.deepEqual(adapter.interpret({ text: "購物安排", tripTimezone: "Asia/Taipei", currentDate: "2026-09-21" }), { kind: "shopping" });
  assert.deepEqual(adapter.interpret({ text: "買東西", tripTimezone: "Asia/Taipei", currentDate: "2026-09-21" }), { kind: "shopping" });
});

test("resolves relative dates without treating the phrase as a location", () => {
  const adapter = new DeterministicQueryFilterAdapter();
  assert.deepEqual(adapter.interpret({ text: "明天的行程？", tripTimezone: "Asia/Taipei", currentDate: "2026-09-28" }), { date: "2026-09-29" });
  assert.deepEqual(adapter.interpret({ text: "明天下午在 Page 有什麼", tripTimezone: "Asia/Phoenix", currentDate: "2026-09-28" }), { date: "2026-09-29", timeWindow: "afternoon", city: "Page" });
  assert.deepEqual(adapter.interpret({ text: "tomorrow itinerary", tripTimezone: "America/Los_Angeles", currentDate: "2026-12-31" }), { date: "2027-01-01" });
  assert.deepEqual(adapter.interpret({ text: "後日行程", tripTimezone: "Asia/Taipei", currentDate: "2026-09-28" }), { date: "2026-09-30" });
  assert.throws(() => adapter.interpret({ text: "明天 2026-10-02 的行程", tripTimezone: "Asia/Taipei", currentDate: "2026-09-28" }), /conflicting explicit and relative dates/);
});

test("parses normalized geography filters without treating them as raw locations", () => {
  const adapter = new DeterministicQueryFilterAdapter();
  assert.deepEqual(adapter.interpret({ text: "Arizona 行程", tripTimezone: "Asia/Taipei", currentDate: "2026-09-21" }), { region: "Arizona" });
  assert.deepEqual(adapter.interpret({ text: "Grand Canyon Village 行程", tripTimezone: "Asia/Taipei", currentDate: "2026-09-21" }), { city: "Grand Canyon Village" });
  assert.deepEqual(adapter.interpret({ text: "美西行程", tripTimezone: "Asia/Taipei", currentDate: "2026-09-21" }), { macroRegion: "US-West" });
  assert.deepEqual(validateQueryFilter({ city: "Grand Canyon Village", region: "Arizona", country: "United States", macroRegion: "US-West" }), { city: "Grand Canyon Village", region: "Arizona", country: "United States", macroRegion: "US-West" });
  assert.throws(() => validateQueryFilter({ city: "Atlantis" }));
});
