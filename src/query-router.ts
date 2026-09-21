import type { ItineraryQuery } from "./domain.ts";
import { validateQueryFilter } from "./query-filter.ts";
import { LOCATION_ALIASES, normalizeLocationQuery } from "./location-alias.ts";

export const QUERY_ROUTER_PROMPT_VERSION = "query-router-v1";

export interface QueryRouterInput {
  text: string;
  tripTimezone: string;
  currentDate: string;
}

export type QueryRouterResult =
  | { intent: "itinerary_query"; filter?: Pick<ItineraryQuery, "date" | "timeWindow" | "location" | "origin" | "destination" | "status" | "kind">; overview?: boolean; notesRequested?: boolean }
  | { intent: "itinerary_input" }
  | { intent: "clarification"; question: string }
  | { intent: "unsupported_action"; message?: string };

export interface QueryRouterAdapter {
  route(input: QueryRouterInput): QueryRouterResult | Promise<QueryRouterResult>;
  readonly metadata?: { provider: string; model: string; promptVersion: string };
}

export class QueryRouterValidationError extends Error {}
export class QueryRouterProviderError extends Error {}

export interface OpenAiCompatibleQueryRouterOptions {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  endpoint?: string;
}

/** OpenAI Responses API router with one constrained, read-only result schema. */
export class OpenAiCompatibleQueryRouter implements QueryRouterAdapter {
  private readonly options: Required<Pick<OpenAiCompatibleQueryRouterOptions, "apiKey" | "model" | "timeoutMs" | "endpoint">> & Pick<OpenAiCompatibleQueryRouterOptions, "fetchImpl">;

  constructor(options: OpenAiCompatibleQueryRouterOptions) {
    if (!options.apiKey.trim()) throw new QueryRouterProviderError("Router API key is required.");
    if (!options.model.trim()) throw new QueryRouterProviderError("Router model is required.");
    const timeoutMs = options.timeoutMs ?? 8_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new QueryRouterProviderError("Router timeout must be a positive integer.");
    this.options = { apiKey: options.apiKey, model: options.model, timeoutMs, endpoint: options.endpoint ?? "https://api.openai.com/v1/responses", fetchImpl: options.fetchImpl };
  }

  get metadata(): { provider: string; model: string; promptVersion: string } {
    return { provider: this.options.endpoint.includes("x.ai") ? "grok" : "openai", model: this.options.model, promptVersion: QUERY_ROUTER_PROMPT_VERSION };
  }

  async route(input: QueryRouterInput): Promise<QueryRouterResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await (this.options.fetchImpl ?? fetch)(this.options.endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${this.options.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: this.options.model, store: false, instructions: routerInstructions, input: JSON.stringify(input), text: { format: { type: "json_schema", name: "itinerary_router", strict: true, schema: routerJsonSchema } } }),
        signal: controller.signal,
      });
      if (!response.ok) throw new QueryRouterProviderError(`Router provider request failed (HTTP ${response.status}).`);
      let body: unknown;
      try { body = await response.json(); } catch { throw new QueryRouterProviderError("Router provider returned malformed JSON."); }
      const output = responseText(body);
      if (!output) throw new QueryRouterProviderError("Router provider returned no structured output.");
      let parsed: unknown;
      try { parsed = JSON.parse(output); } catch { throw new QueryRouterProviderError("Router provider returned malformed structured JSON."); }
      try { return validateQueryRouterResult(normalizeProviderResult(removeNulls(parsed), input.currentDate, input.text)); } catch { throw new QueryRouterProviderError("Router provider returned invalid structured output."); }
    } catch (error) {
      if (error instanceof QueryRouterProviderError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") throw new QueryRouterProviderError("Router provider request timed out.");
      throw new QueryRouterProviderError("Router provider request failed.");
    } finally { clearTimeout(timer); }
  }
}

/** Validates the model boundary; the router can never return a write operation. */
export function validateQueryRouterResult(value: unknown): QueryRouterResult {
  if (!isRecord(value) || typeof value.intent !== "string") throw new QueryRouterValidationError("Router output must include an intent.");
  switch (value.intent) {
    case "itinerary_query": {
      const keys = new Set(["intent", "filter", "overview", "notesRequested"]);
      rejectUnknown(value, keys);
      if (value.overview !== undefined && value.overview !== true) throw new QueryRouterValidationError("Router overview must be true.");
      if (value.notesRequested !== undefined && value.notesRequested !== true) throw new QueryRouterValidationError("Router notesRequested must be true.");
      if (value.overview === true && value.filter !== undefined) throw new QueryRouterValidationError("Router overview cannot include a filter.");
      if (value.overview !== true && value.filter === undefined) throw new QueryRouterValidationError("Router query needs a filter or overview.");
      return { intent: "itinerary_query", ...(value.overview === true ? { overview: true } : { filter: validateQueryFilter(value.filter) }), ...(value.notesRequested === true ? { notesRequested: true } : {}) };
    }
    case "itinerary_input":
      rejectUnknown(value, new Set(["intent"]));
      return { intent: "itinerary_input" };
    case "clarification": {
      rejectUnknown(value, new Set(["intent", "question"]));
      if (typeof value.question !== "string" || !value.question.trim()) throw new QueryRouterValidationError("Router clarification needs a question.");
      return { intent: "clarification", question: value.question.trim() };
    }
    case "unsupported_action": {
      rejectUnknown(value, new Set(["intent", "message"]));
      if (value.message !== undefined && (typeof value.message !== "string" || !value.message.trim())) throw new QueryRouterValidationError("Router unsupported-action message must be non-empty.");
      return { intent: "unsupported_action", ...(typeof value.message === "string" ? { message: value.message.trim() } : {}) };
    }
    default: throw new QueryRouterValidationError("Router intent is unsupported.");
  }
}

/** Deterministic fixture adapter for tests and local routing checks. */
export class FakeQueryRouterAdapter implements QueryRouterAdapter {
  readonly metadata = { provider: "fake", model: "fake-query-router", promptVersion: QUERY_ROUTER_PROMPT_VERSION };
  private readonly fixtures: Record<string, unknown>;
  constructor(fixtures: Record<string, unknown> = {}) { this.fixtures = fixtures; }
  route(input: QueryRouterInput): QueryRouterResult {
    return validateQueryRouterResult(this.fixtures[input.text] ?? { intent: "itinerary_input" });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function rejectUnknown(value: Record<string, unknown>, allowed: Set<string>): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new QueryRouterValidationError(`Router output has unsupported field: ${key}.`);
}

const routerInstructions = [
  "Classify one group message for a travel itinerary assistant.",
  "Return exactly one intent. Do not write, modify, delete, confirm, reject, or call any tool.",
  "Use itinerary_query only for a request to read the itinerary. Use overview true only when the user explicitly requests the entire/current itinerary; otherwise provide a Query Filter. If the user asks what to pay attention to, set notesRequested true and return only recorded itinerary notes.",
  "A named place with arrangement wording is a query: for example, 'Page 有什麼安排' must be itinerary_query with filter.location='Page'. Do not use clarification for a named place.",
  "Do not add a date filter unless the user explicitly states a date; currentDate is only for resolving an explicitly stated short date. For the exact text 'Page 有什麼安排', return filter {location:'Page'} with date null.",
  "An explicit date always makes this a query, including '10/2 那天有什麼': return itinerary_query with filter.date='2026-10-02' (using the currentDate year), not clarification.",
  "Use itinerary_input for text that should enter the existing Extraction Draft workflow unchanged.",
  "Use clarification only when a read query has an unresolved reference such as '那天有什麼' with no date or location. Use unsupported_action for any unrecognized destructive or modifying action.",
  "The only Query Filter fields are date, timeWindow, location, origin, destination, status, and kind. Status may only be confirmed or pending; kind must use the existing itinerary kind vocabulary.",
  `When a location wording is not already canonical, choose only from these bounded aliases; never invent a location: ${LOCATION_ALIASES.map((entry) => `${entry.alias}=${entry.canonical}`).join(", ")}.`,
].join("\n");

const routerJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "filter", "overview", "question", "message", "notesRequested"],
  properties: {
    intent: { type: "string", enum: ["itinerary_query", "itinerary_input", "clarification", "unsupported_action"] },
    filter: { type: ["object", "null"], additionalProperties: false, required: ["date", "timeWindow", "location", "origin", "destination", "status", "kind"], properties: { date: { type: ["string", "null"] }, timeWindow: { type: ["string", "null"], enum: ["morning", "afternoon", "evening", "night", null] }, location: { type: ["string", "null"] }, origin: { type: ["string", "null"] }, destination: { type: ["string", "null"] }, status: { type: ["string", "null"], enum: ["confirmed", "pending", null] }, kind: { type: ["string", "null"], enum: ["flight", "lodging", "rental_car", "transport", "meal", "activity", "shopping", "meeting", "other", null] } } },
    overview: { type: ["boolean", "null"] },
    question: { type: ["string", "null"] },
    message: { type: ["string", "null"] },
    notesRequested: { type: ["boolean", "null"] },
  },
};

function responseText(body: unknown): string | null {
  if (!isRecord(body) || !Array.isArray(body.output)) return null;
  for (const output of body.output) {
    if (!isRecord(output) || !Array.isArray(output.content)) continue;
    for (const content of output.content) if (isRecord(content) && content.type === "output_text" && typeof content.text === "string") return content.text;
  }
  return typeof body.output_text === "string" ? body.output_text : null;
}

function normalizeProviderResult(value: unknown, currentDate: string, inputText: string): unknown {
  if (!isRecord(value)) return value;
  const filter = isRecord(value.filter) ? { ...value.filter } : null;
  const alias = LOCATION_ALIASES.find((entry) => inputText.toLocaleLowerCase().includes(entry.alias.toLocaleLowerCase()));
  if (filter && alias) filter.location = normalizeLocationQuery(alias.alias);
  const hasExplicitDate = /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2})\b/u.test(inputText);
  if (filter && !hasExplicitDate) delete filter.date;
  if (filter && typeof filter.date === "string") {
    const shortDate = filter.date.match(/^(\d{1,2})\/(\d{1,2})$/u);
    if (shortDate) filter.date = `${currentDate.slice(0, 4)}-${shortDate[1].padStart(2, "0")}-${shortDate[2].padStart(2, "0")}`;
    if (value.intent === "clarification") return { intent: "itinerary_query", filter };
  }
  return filter ? { ...value, filter } : value;
}

function removeNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeNulls);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => child === null ? [] : [[key, removeNulls(child)]]));
}
