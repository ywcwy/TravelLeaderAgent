import { timeWindows, type ItineraryQuery } from "./domain.ts";

export interface QueryFilterAdapter {
  interpret(input: { text: string; tripTimezone: string; currentDate: string }): unknown | Promise<unknown>;
}

/** Deterministic fallback used by the runtime until a provider-backed query adapter is configured. */
export class DeterministicQueryFilterAdapter implements QueryFilterAdapter {
  interpret(input: { text: string; tripTimezone: string; currentDate: string }): unknown {
    const text = input.text.trim().replace(/^@[^\s]+\s*/, "").replace(/^(?:查詢|查询|query)\s*/i, "").trim();
    const date = parseShortDate(text, input.currentDate);
    const timeWindow = [
      ["morning", /上午|早上|morning/i], ["afternoon", /中午|下午|afternoon/i],
      ["evening", /傍晚|晚上|evening/i], ["night", /深夜|夜晚|night/i],
    ].find(([, pattern]) => (pattern as RegExp).test(text))?.[0];
    const location = text.replace(/\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}|上午|早上|中午|下午|傍晚|晚上|深夜|夜晚|有什麼安排[？?]?|在/g, " ").trim().replace(/\s+/g, " ");
    return { ...(date ? { date } : {}), ...(timeWindow ? { timeWindow } : {}), ...(location ? { location } : {}) };
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

export function validateQueryFilter(value: unknown): Pick<ItineraryQuery, "date" | "timeWindow" | "location" | "status"> {
  if (!isRecord(value)) throw new QueryFilterValidationError("Query Filter must be an object.");
  const allowed = new Set(["date", "timeWindow", "location", "status"]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new QueryFilterValidationError(`Unsupported Query Filter field: ${key}.`);
  const date = optionalString(value.date, "date");
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new QueryFilterValidationError("Query Filter date must be an ISO local date.");
  const timeWindow = optionalString(value.timeWindow, "timeWindow");
  if (timeWindow && !timeWindows.includes(timeWindow as (typeof timeWindows)[number])) throw new QueryFilterValidationError("Query Filter Time Window is unsupported.");
  const location = optionalString(value.location, "location");
  const status = optionalString(value.status, "status");
  if (status && status !== "confirmed" && status !== "pending") throw new QueryFilterValidationError("Query Filter status is unsupported.");
  if (!date && !timeWindow && !location && !status) throw new QueryFilterValidationError("Query Filter needs at least one condition.");
  return { ...(date ? { date } : {}), ...(timeWindow ? { timeWindow: timeWindow as ItineraryQuery["timeWindow"] } : {}), ...(location ? { location } : {}), ...(status ? { status: status as "confirmed" | "pending" } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) throw new QueryFilterValidationError(`Query Filter ${field} must be a non-empty string.`);
  return value.trim();
}
