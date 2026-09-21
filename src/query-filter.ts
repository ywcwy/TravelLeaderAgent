import { timeWindows, tripItemKinds, type ItineraryQuery } from "./domain.ts";

export interface QueryFilterAdapter {
  interpret(input: { text: string; tripTimezone: string; currentDate: string }): unknown | Promise<unknown>;
}

/** Deterministic fallback used by the runtime until a provider-backed query adapter is configured. */
export class DeterministicQueryFilterAdapter implements QueryFilterAdapter {
  interpret(input: { text: string; tripTimezone: string; currentDate: string }): unknown {
    const text = input.text.trim().replace(/^@[^\s]+\s*/, "").replace(/^(?:查詢|查询|query)\s*/i, "").trim();
    if (/[;；]/u.test(text)) throw new QueryFilterValidationError("Query Filter cannot contain command separators.");
    const date = parseShortDate(text, input.currentDate);
    const route = text.match(/(?:從|from)\s+(.+?)\s+(?:到|to)\s+(.+?)(?:的)?行程?$/i);
    const timeWindow = [
      ["morning", /上午|早上|morning/i], ["afternoon", /中午|下午|afternoon/i],
      ["evening", /傍晚|晚上|evening/i], ["night", /深夜|夜晚|night/i],
    ].find(([, pattern]) => (pattern as RegExp).test(text))?.[0];
    const status = /(?:待確認|待确认|pending)/i.test(text) ? "pending" : /(?:已確認|已确认|confirmed)/i.test(text) ? "confirmed" : undefined;
    const kind = parseKind(text);
    const location = route ? undefined : text.replace(/\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}|上午|早上|中午|下午|傍晚|晚上|深夜|夜晚|什麼時候(?:會有)?|有什麼(?:安排)?[？?]?|(?:待確認|待确认|pending|已確認|已确认|confirmed)(?:行程)?|逛街|購物|购物|買東西|买东西|shopping|行程|安排|在|的/g, " ").trim().replace(/\s+/g, " ");
    return { ...(date ? { date } : {}), ...(timeWindow ? { timeWindow } : {}), ...(status ? { status } : {}), ...(route ? { origin: route[1].trim(), destination: route[2].trim() } : {}), ...(kind ? { kind } : {}), ...(location ? { location } : {}) };
  }
}

function parseShortDate(text: string, currentDate: string): string | undefined {
  const isoDate = text.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (isoDate) return isoDate[0];
  const match = text.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (!match) return undefined;
  return `${currentDate.slice(0, 4)}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

export class QueryFilterValidationError extends Error {}

export function validateQueryFilter(value: unknown): Pick<ItineraryQuery, "date" | "timeWindow" | "location" | "origin" | "destination" | "status" | "kind"> {
  if (!isRecord(value)) throw new QueryFilterValidationError("Query Filter must be an object.");
  const allowed = new Set(["date", "timeWindow", "location", "origin", "destination", "status", "kind"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new QueryFilterValidationError(`Unsupported Query Filter field: ${key}.`);
  const date = optionalString(value.date, "date");
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new QueryFilterValidationError("Query Filter date must be an ISO local date.");
  const timeWindow = optionalString(value.timeWindow, "timeWindow");
  if (timeWindow && !timeWindows.includes(timeWindow as (typeof timeWindows)[number])) throw new QueryFilterValidationError("Query Filter Time Window is unsupported.");
  const location = optionalString(value.location, "location");
  const origin = optionalString(value.origin, "origin");
  const destination = optionalString(value.destination, "destination");
  const status = optionalString(value.status, "status");
  const kind = optionalString(value.kind, "kind");
  if (kind && !tripItemKinds.includes(kind as (typeof tripItemKinds)[number])) throw new QueryFilterValidationError("Query Filter kind is unsupported.");
  if (status && status !== "confirmed" && status !== "pending") throw new QueryFilterValidationError("Query Filter status is unsupported.");
  if (!date && !timeWindow && !location && !origin && !destination && !status && !kind) throw new QueryFilterValidationError("Query Filter needs at least one condition.");
  return { ...(date ? { date } : {}), ...(timeWindow ? { timeWindow: timeWindow as ItineraryQuery["timeWindow"] } : {}), ...(location ? { location } : {}), ...(origin ? { origin } : {}), ...(destination ? { destination } : {}), ...(status ? { status: status as "confirmed" | "pending" } : {}), ...(kind ? { kind: kind as ItineraryQuery["kind"] } : {}) };
}

function parseKind(text: string): ItineraryQuery["kind"] | undefined {
  if (/逛街|購物|购物|買東西|买东西|shopping|shop(?:ping)?/iu.test(text)) return "shopping";
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new QueryFilterValidationError(`Query Filter ${field} must be a non-empty string.`);
  return value.trim();
}
