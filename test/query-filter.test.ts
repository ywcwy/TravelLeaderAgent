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
