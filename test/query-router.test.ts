import assert from "node:assert/strict";
import test from "node:test";
import { OpenAiCompatibleQueryRouter, QueryRouterValidationError, validateQueryRouterResult } from "../src/query-router.ts";

test("accepts only closed read-only router intents", () => {
  assert.deepEqual(validateQueryRouterResult({ intent: "itinerary_query", filter: { date: "2026-10-02", location: "Page" } }), { intent: "itinerary_query", filter: { date: "2026-10-02", location: "Page" } });
  assert.deepEqual(validateQueryRouterResult({ intent: "itinerary_query", overview: true }), { intent: "itinerary_query", overview: true });
  assert.deepEqual(validateQueryRouterResult({ intent: "itinerary_input" }), { intent: "itinerary_input" });
  assert.deepEqual(validateQueryRouterResult({ intent: "clarification", question: "你想查哪一天？" }), { intent: "clarification", question: "你想查哪一天？" });
  assert.deepEqual(validateQueryRouterResult({ intent: "unsupported_action" }), { intent: "unsupported_action" });
});

test("rejects router output that could widen its tool surface", () => {
  assert.throws(() => validateQueryRouterResult({ intent: "itinerary_query", filter: { location: "Page", deleteAll: true } }));
  assert.throws(() => validateQueryRouterResult({ intent: "itinerary_query", overview: true, filter: { location: "Page" } }), QueryRouterValidationError);
  assert.throws(() => validateQueryRouterResult({ intent: "confirm_proposal", proposalId: "P-1" }), QueryRouterValidationError);
});

test("provider router sends only minimal context and validates its structured result", async () => {
  let request: Record<string, unknown> | undefined;
  const router = new OpenAiCompatibleQueryRouter({ apiKey: "test-key", model: "router-test", fetchImpl: async (_url, init) => {
    request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ intent: "itinerary_query", filter: { location: "Page" } }) }] }] }), { status: 200 });
  } });
  assert.deepEqual(await router.route({ text: "Page 有什麼安排", tripTimezone: "America/Phoenix", currentDate: "2026-09-21" }), { intent: "itinerary_query", filter: { location: "Page" } });
  assert.equal(request?.store, false);
  assert.match(String(request?.input), /Page 有什麼安排/);
  assert.match(String(request?.instructions), /Page 有什麼安排/);
  assert.doesNotMatch(String(request?.input), /Source|Proposal|Draft/);
  assert.equal((request?.text as { format: { type: string } }).format.type, "json_schema");
  const schema = (request?.text as { format: { schema: { required: string[]; properties: { filter: { required: string[] } } } } }).format.schema;
  assert.deepEqual(schema.required, ["intent", "filter", "overview", "question", "message", "notesRequested"]);
  assert.deepEqual(schema.properties.filter.required, ["date", "timeWindow", "location", "origin", "destination", "status", "kind"]);
});

test("normalizes a model that mixes explicit date extraction with clarification", async () => {
  const router = new OpenAiCompatibleQueryRouter({ apiKey: "test-key", model: "router-test", fetchImpl: async () => new Response(JSON.stringify({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ intent: "clarification", filter: { date: "10/2" }, overview: null, question: null, message: null }) }] }] }), { status: 200 }) });
  assert.deepEqual(await router.route({ text: "10/2 那天有什麼", tripTimezone: "America/Phoenix", currentDate: "2026-09-21" }), { intent: "itinerary_query", filter: { date: "2026-10-02" } });
});

test("accepts a read-only notes request", () => {
  assert.deepEqual(validateQueryRouterResult({ intent: "itinerary_query", filter: { location: "Lower Antelope Canyon" }, notesRequested: true }), { intent: "itinerary_query", filter: { location: "Lower Antelope Canyon" }, notesRequested: true });
});

test("normalizes a location alias from a notes question before querying", async () => {
  const router = new OpenAiCompatibleQueryRouter({ apiKey: "test", model: "test", fetchImpl: async () => new Response(JSON.stringify({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ intent: "itinerary_query", filter: { date: null, timeWindow: null, location: "馬蹄灣", origin: null, destination: null, status: null, kind: null }, overview: null, question: null, message: null, notesRequested: true }) }] }] })) });
  assert.deepEqual(await router.route({ text: "去馬蹄灣有什麼事情需要注意？", tripTimezone: "Asia/Taipei", currentDate: "2026-09-21" }), { intent: "itinerary_query", filter: { location: "Horseshoe Bend" }, notesRequested: true });
});

test("does not retain a model-invented date for a date-less location question", async () => {
  const router = new OpenAiCompatibleQueryRouter({ apiKey: "test", model: "test", fetchImpl: async () => new Response(JSON.stringify({ output: [{ content: [{ type: "output_text", text: JSON.stringify({ intent: "itinerary_query", filter: { date: "2026-09-21", timeWindow: null, location: "大峽谷", origin: null, destination: null, status: null, kind: null }, overview: null, question: null, message: null, notesRequested: true }) }] }] })) });
  assert.deepEqual(await router.route({ text: "去大峽谷有什麼事情需要注意？", tripTimezone: "Asia/Taipei", currentDate: "2026-09-21" }), { intent: "itinerary_query", filter: { location: "Grand Canyon" }, notesRequested: true });
});
