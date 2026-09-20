import assert from "node:assert/strict";
import test from "node:test";
import { OpenAiCompatibleLlmAdapter, LlmProviderError, TimeoutFallbackLlmAdapter, type LlmAdapter } from "../src/extraction-draft.ts";

const input = { sourceContent: "10/1 在 Page 住宿", tripTimezone: "Asia/Taipei", currentDate: "2026-09-17", inputType: "line_text" };
const output = { items: [{ kind: "lodging", kinds: ["lodging"], shape: "point", shapeSource: "inferred", title: "Page 住宿", status: "provisional", startsAt: "2026-10-01T18:00:00+08:00", endsAt: null, timezone: "Asia/Taipei", timezoneSource: "explicit", originTimezone: null, destinationTimezone: null, location: "Page", origin: null, destination: null, notes: null, deadlineAt: null, sourceLine: null, sourceExcerpt: "10/1 在 Page 住宿", startTimeFlexibility: "flexible", endTimeFlexibility: "flexible", timeWindow: "evening", assumptions: [] }], missing: [], assumptions: [], issues: [], sourceExcerpt: "10/1 在 Page 住宿" };

test("Grok-compatible adapter sends the contract and validates structured output", async () => {
  let request: RequestInit | undefined;
  let url = "";
  const adapter = new OpenAiCompatibleLlmAdapter({ apiKey: "secret-key", model: "grok-4.6", endpoint: "https://api.x.ai/v1/responses", fetchImpl: async (input, init) => { url = String(input); request = init; return new Response(JSON.stringify({ output_text: JSON.stringify(output) }), { status: 200 }); } });
  const result = await adapter.extract(input);
  assert.equal(result.items[0]?.title, "Page 住宿");
  assert.deepEqual(adapter.metadata, { provider: "grok", model: "grok-4.6", promptVersion: "extraction-draft-v8" });
  assert.equal(request?.headers && new Headers(request.headers).get("authorization"), "Bearer secret-key");
  const body = JSON.parse(String(request?.body)) as { model: string; store: boolean; instructions: string; text: { format: { type: string; name: string } } };
  assert.equal(url, "https://api.x.ai/v1/responses");
  assert.equal(body.model, "grok-4.6");
  assert.equal(body.store, false);
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.name, "extraction_draft");
  assert.match(body.instructions, /timeWindow/);
  assert.match(body.instructions, /localDate/);
  assert.match(body.instructions, /set location/);
  assert.match(body.instructions, /one itinerary item/);
  assert.match(body.instructions, /low_information_item/);
  assert.match(body.instructions, /full Markdown link/);
  assert.match(body.instructions, /notes/);
  assert.match(body.instructions, /Related itinerary context is reference-only/);
});

test("Grok-compatible adapter turns provider failures and malformed output into safe errors", async () => {
  const failed = new OpenAiCompatibleLlmAdapter({ apiKey: "secret-key", model: "test-model", fetchImpl: async () => new Response("provider secret details", { status: 503 }) });
  await assert.rejects(failed.extract(input), (error: unknown) => error instanceof LlmProviderError && error.message === "LLM provider request failed (HTTP 503).");
  const rateLimited = new OpenAiCompatibleLlmAdapter({ apiKey: "secret-key", model: "test-model", fetchImpl: async () => new Response(JSON.stringify({ error: { code: "insufficient_quota", type: "insufficient_quota", message: "do not expose this provider message" } }), { status: 429, headers: { "retry-after": "3" } }) });
  await assert.rejects(rateLimited.extract(input), (error: unknown) => error instanceof LlmProviderError && error.message === "LLM provider request failed (HTTP 429: insufficient_quota; retry-after=3s)." && !error.message.includes("do not expose"));
  const malformed = new OpenAiCompatibleLlmAdapter({ apiKey: "secret-key", model: "test-model", fetchImpl: async () => new Response(JSON.stringify({ output_text: "not-json" }), { status: 200 }) });
  await assert.rejects(malformed.extract(input), (error: unknown) => error instanceof LlmProviderError && error.message === "LLM provider returned malformed structured JSON.");
});

test("Grok-compatible adapter applies a bounded timeout", async () => {
  const timeout = new OpenAiCompatibleLlmAdapter({ apiKey: "secret-key", model: "test-model", timeoutMs: 1, fetchImpl: async (_url, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))); }) });
  await assert.rejects(timeout.extract(input), (error: unknown) => error instanceof LlmProviderError && error.message === "LLM provider request timed out.");
});

test("uses fallback only for timeout errors, not malformed output", async () => {
  let fallbackCalls = 0;
  const timeoutPrimary: LlmAdapter = { metadata: { provider: "primary", model: "a", promptVersion: "test" }, extract: async () => { throw new LlmProviderError("LLM provider request timed out."); } };
  const fallback: LlmAdapter = { metadata: { provider: "fallback", model: "b", promptVersion: "test" }, extract: async () => { fallbackCalls += 1; return output as unknown as import("../src/domain.ts").ExtractionDraftPayload; } };
  const adapter = new TimeoutFallbackLlmAdapter(timeoutPrimary, fallback);
  await adapter.extract(input);
  assert.equal(fallbackCalls, 1);
  assert.equal(adapter.metadata?.provider, "fallback");

  const malformedPrimary: LlmAdapter = { metadata: { provider: "primary", model: "a", promptVersion: "test" }, extract: async () => { throw new LlmProviderError("LLM provider returned malformed structured JSON."); } };
  await assert.rejects(new TimeoutFallbackLlmAdapter(malformedPrimary, fallback).extract(input), /malformed structured JSON/);
  assert.equal(fallbackCalls, 1);
});
