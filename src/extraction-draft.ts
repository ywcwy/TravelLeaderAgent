import {
  proposalShapeSources,
  proposalShapes,
  timeFlexibilities,
  timeWindows,
  tripItemKinds,
  tripItemStatuses,
  timezoneSources,
} from "./domain.ts";
import type { ExtractedTripItem, ExtractionDraft, ExtractionDraftItem, ExtractionDraftMetadata, ExtractionDraftPayload } from "./domain.ts";

export const EXTRACTION_PROMPT_VERSION = "extraction-draft-v3";

export interface LlmExtractionInput {
  sourceContent: string;
  tripTimezone: string;
  currentDate: string;
  inputType: string;
  existingDraft?: ExtractionDraftPayload;
}

export interface LlmAdapter {
  extract(input: LlmExtractionInput): ExtractionDraftPayload | Promise<ExtractionDraftPayload>;
  readonly metadata?: ExtractionDraftMetadata;
}

export class ExtractionDraftValidationError extends Error {}
export class LlmProviderError extends Error {}

export interface OpenAiCompatibleLlmAdapterOptions {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  endpoint?: string;
}

/** OpenAI Responses API adapter. The provider output is still validated at the domain boundary. */
export class OpenAiCompatibleLlmAdapter implements LlmAdapter {
  private readonly options: Required<Pick<OpenAiCompatibleLlmAdapterOptions, "apiKey" | "model" | "timeoutMs" | "endpoint">> & Pick<OpenAiCompatibleLlmAdapterOptions, "fetchImpl">;

  constructor(options: OpenAiCompatibleLlmAdapterOptions) {
    if (!options.apiKey.trim()) throw new LlmProviderError("Provider API key is required.");
    if (!options.model.trim()) throw new LlmProviderError("Provider model is required.");
    const timeoutMs = options.timeoutMs ?? 20_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new LlmProviderError("OpenAI provider timeout must be a positive integer.");
    this.options = { apiKey: options.apiKey, model: options.model, timeoutMs, endpoint: options.endpoint ?? "https://api.openai.com/v1/responses", fetchImpl: options.fetchImpl };
  }

  get metadata(): ExtractionDraftMetadata {
    return { provider: this.options.endpoint.includes("x.ai") ? "grok" : "openai", model: this.options.model, promptVersion: EXTRACTION_PROMPT_VERSION };
  }

  async extract(input: LlmExtractionInput): Promise<ExtractionDraftPayload> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await (this.options.fetchImpl ?? fetch)(this.options.endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${this.options.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: this.options.model,
          store: false,
          instructions: extractionInstructions,
          input: JSON.stringify(input),
          text: { format: { type: "json_schema", name: "extraction_draft", strict: true, schema: extractionDraftJsonSchema } },
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw await providerRequestError(response);
      let body: unknown;
      try { body = await response.json(); } catch { throw new LlmProviderError("LLM provider returned malformed JSON."); }
      const text = responseText(body);
      if (!text) throw new LlmProviderError("LLM provider returned no structured output.");
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { throw new LlmProviderError("LLM provider returned malformed structured JSON."); }
      return validateExtractionDraftPayload(removeNulls(parsed));
    } catch (error) {
      if (error instanceof LlmProviderError) throw error;
      if (error instanceof ExtractionDraftValidationError) throw new LlmProviderError("LLM provider returned invalid structured output.");
      if (error instanceof DOMException && error.name === "AbortError") throw new LlmProviderError("LLM provider request timed out.");
      throw new LlmProviderError("LLM provider request failed.");
    } finally {
      clearTimeout(timer);
    }
  }
}

async function providerRequestError(response: Response): Promise<LlmProviderError> {
  let detail: string | undefined;
  try {
    const body: unknown = await response.clone().json();
    if (isRecord(body) && isRecord(body.error)) {
      const code = safeProviderToken(body.error.code) ?? safeProviderToken(body.error.type);
      if (code) detail = code;
    }
  } catch {
    // Provider error bodies are optional; status alone remains safe and useful.
  }
  const retryAfter = response.headers.get("retry-after")?.trim();
  const safeRetryAfter = retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter) ? retryAfter : undefined;
  const suffix = `${detail ? `: ${detail}` : ""}${safeRetryAfter ? `; retry-after=${safeRetryAfter}s` : ""}`;
  return new LlmProviderError(`LLM provider request failed (HTTP ${response.status}${suffix}).`);
}

function safeProviderToken(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : undefined;
}

/** @deprecated Use OpenAiCompatibleLlmAdapter; retained for existing callers. */
export const OpenAiLlmAdapter = OpenAiCompatibleLlmAdapter;

export function validateExtractionDraftPayload(payload: unknown): ExtractionDraftPayload {
  if (!isRecord(payload)) throw new ExtractionDraftValidationError("Extraction Draft output must be a JSON object.");
  const items = payload.items;
  const missing = payload.missing;
  const assumptions = payload.assumptions;
  const issues = payload.issues;
  const sourceExcerpt = payload.sourceExcerpt;
  if (!Array.isArray(items) || !Array.isArray(missing) || !Array.isArray(assumptions) || !Array.isArray(issues) || typeof sourceExcerpt !== "string") {
    throw new ExtractionDraftValidationError("Extraction Draft output must include items, missing, assumptions, issues, and sourceExcerpt.");
  }
  return {
    items: items.map((item, index) => validateItem(item, index)),
    missing: missing.map((value, index) => validateMissing(value, index)),
    assumptions: assumptions.map((value, index) => validateString(value, `assumptions[${index}]`)),
    issues: issues.map((value, index) => validateIssue(value, index)),
    sourceExcerpt,
  };
}

/** Apply deterministic guards after model extraction while retaining the immutable Source. */
export function guardExtractionDraftPayload(payload: ExtractionDraftPayload, sourceContent: string): ExtractionDraftPayload {
  const items = [...payload.items];
  const issues = [...payload.issues];
  const hasSeparateArrival = /(?:separate|separately|another|另外|獨立|單獨).{0,24}(?:arrival|arriv|抵達|到達)/iu.test(sourceContent)
    || /(?:arrival|arriv|抵達|到達).{0,24}(?:separate|separately|another|另外|獨立|單獨)/iu.test(sourceContent);
  const lodgingLocations = new Set(items.filter((item) => item.kind === "lodging" && item.location).map((item) => item.location!.trim().toLocaleLowerCase()));
  const hasLodgingContext = /住宿|飯店|酒店|旅館|hotel|lodging|stay(?:ing)?|住/iu.test(sourceContent)
    || items.some((item) => item.kind === "lodging" || /住宿|飯店|酒店|旅館|hotel|lodging|stay(?:ing)?/iu.test(item.title));
  const kept: ExtractionDraftItem[] = [];
  const seen = new Map<string, ExtractionDraftItem>();
  for (const item of items) {
    const arrival = isArrivalCandidate(item);
    const locationKey = item.location?.trim().toLocaleLowerCase();
    const hasSchedule = Boolean(item.startsAt || item.localDate || item.timeWindow);
    if (arrival && !item.location && !hasSchedule) {
      issues.push({ code: "low_information_item", message: `排除低資訊行程「${item.title}」：缺少可用地點與時間。` });
      continue;
    }
    if (arrival && !hasSeparateArrival && (!item.startsAt || isDateOnlyTimestamp(item.startsAt)) && ((locationKey && lodgingLocations.has(locationKey)) || hasLodgingContext)) {
      issues.push({ code: "contextual_phrase", message: `「${item.title}」視為住宿情境，不另建立 Arrival 行程。` });
      continue;
    }
    const duplicateKey = [item.kind, item.title.trim().toLocaleLowerCase(), locationKey ?? "", item.localDate ?? "", item.startsAt ?? "", item.endsAt ?? ""].join("|");
    const previous = seen.get(duplicateKey);
    if (previous) {
      issues.push({ code: "duplicate_item", message: `排除重複行程「${item.title}」。` });
      continue;
    }
    const contradictionKey = [item.kind, item.title.trim().toLocaleLowerCase(), locationKey ?? ""].join("|");
    const contradiction = kept.find((candidate) => {
      const candidateKey = [candidate.kind, candidate.title.trim().toLocaleLowerCase(), candidate.location?.trim().toLocaleLowerCase() ?? ""].join("|");
      return candidateKey === contradictionKey
        && (candidate.localDate !== item.localDate || candidate.startsAt !== item.startsAt || candidate.endsAt !== item.endsAt)
        && Boolean(candidate.localDate || item.localDate || candidate.startsAt || item.startsAt);
    });
    if (contradiction) {
      issues.push({ code: "contradictory_item", message: `排除互相矛盾的行程「${item.title}」，保留先出現的候選。` });
      continue;
    }
    seen.set(duplicateKey, item);
    kept.push(item);
  }
  const retainedTransport = kept.some((item) => item.kind === "transport" || item.kinds.includes("transport"));
  const actionableIssues = issues.filter((issue) => !(/retain transportation .*remove lodging context/i.test(issue.message) && !retainedTransport));
  return { ...payload, items: kept, issues: actionableIssues };
}

function isArrivalCandidate(item: ExtractionDraftItem): boolean {
  return /^到|\barriv(?:al|e|ing)?\b|抵達|到達|抵店/iu.test(item.title);
}

function isDateOnlyTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** A deterministic adapter used by tests and local development; it never calls a model. */
export class FakeLlmAdapter implements LlmAdapter {
  private readonly fixtures: Map<string, ExtractionDraftPayload>;

  constructor(fixtures: ReadonlyMap<string, ExtractionDraftPayload> | Record<string, ExtractionDraftPayload> = {}) {
    this.fixtures = fixtures instanceof Map ? new Map(fixtures) : new Map(Object.entries(fixtures));
  }

  get metadata(): ExtractionDraftMetadata {
    return { provider: "fake", model: "fake", promptVersion: EXTRACTION_PROMPT_VERSION };
  }

  extract(input: LlmExtractionInput): ExtractionDraftPayload {
    const fixture = this.fixtures.get(input.sourceContent);
    if (fixture) return structuredClone(fixture);
    return defaultFixture(input);
  }
}

export function renderExtractionDraft(draft: Pick<ExtractionDraft, "id" | "status" | "items" | "missing" | "assumptions" | "issues">, options: { page?: number; pageSize?: number; maxLength?: number } = {}): string {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.max(1, options.pageSize ?? 8);
  const maxLength = Math.max(500, options.maxLength ?? 4_500);
  const itemLines = draft.items.map((item) => {
    const time = item.startsAt ?? (item.localDate ? `${item.localDate}${item.timeWindow ? ` ${item.timeWindow}` : ""}` : item.timeWindow) ?? "未指定時間";
    const place = item.shape === "route" ? `${item.origin ?? "?"} → ${item.destination ?? "?"}` : (item.location ?? "未指定地點");
    return `- ${item.title}｜${time}｜${place}｜時間 ${item.startTimeFlexibility}/${item.endTimeFlexibility}`;
  });
  const totalPages = Math.max(1, Math.ceil(itemLines.length / pageSize));
  const lines = [`Extraction Draft ${draft.id}｜${draft.status}｜第 ${Math.min(page, totalPages)}/${totalPages} 頁`, ...(itemLines.length > 0 ? itemLines.slice((page - 1) * pageSize, page * pageSize) : ["- 尚未解析出行程項目"])] as string[];
  if (page === 1) {
    if (draft.missing.length > 0) lines.push(`必要資訊待補：${draft.missing.map((entry) => `${entry.field}${entry.required ? "（必要）" : "（可選）"}${entry.message ? `｜${entry.message}` : ""}`).join("；")}`);
    if (draft.assumptions.length > 0) lines.push(`模型假設：${draft.assumptions.join("；")}`);
    const ignored = draft.issues.filter((issue) => /^(?:low_information_item|duplicate_item|contextual_phrase|contradictory_item)$/.test(issue.code));
    const otherIssues = draft.issues.filter((issue) => !ignored.includes(issue));
    if (ignored.length > 0) lines.push(`已忽略：${ignored.map((issue) => issue.message).join("；")}`);
    if (otherIssues.length > 0) lines.push(`需要注意：${otherIssues.map((issue) => issue.message).join("；")}`);
    if (draft.status === "pending_confirmation") lines.push(`請確認：確認 ${draft.id}`);
    else if (draft.status === "failed") lines.push(`請重試：重試 ${draft.id}`);
    else if (draft.status === "confirmed") lines.push(`已確認 Draft ${draft.id}`);
    else lines.push(`已取消 Draft ${draft.id}`);
  }
  if (page < totalPages) lines.push(`下一頁：查看 Draft ${draft.id} ${page + 1}`);
  let rendered = lines.join("\n");
  if (rendered.length > maxLength) rendered = `${rendered.slice(0, maxLength - 20).trimEnd()}…\n（內容已截短）`;
  return rendered;
}

function defaultFixture(input: LlmExtractionInput): ExtractionDraftPayload {
  const sourceExcerpt = input.sourceContent.trim().slice(0, 500);
  const item: ExtractionDraftItem = {
    kind: "other",
    kinds: ["other"],
    shape: "point",
    shapeSource: "inferred",
    title: sourceExcerpt || "未命名行程",
    status: "provisional",
    startTimeFlexibility: "flexible",
    endTimeFlexibility: "flexible",
    sourceExcerpt,
  };
  return {
    items: [item],
    missing: [{ field: "location", message: "請補充地點。", required: false }],
    assumptions: [`以 ${input.currentDate}（${input.tripTimezone}）作為相對日期判讀基準。`],
    issues: [],
    sourceExcerpt,
  };
}

function validateItem(value: unknown, index: number): ExtractionDraftItem {
  if (!isRecord(value)) throw new ExtractionDraftValidationError(`items[${index}] must be an object.`);
  const startTimeFlexibility = validateEnum(value.startTimeFlexibility, timeFlexibilities, `items[${index}].startTimeFlexibility`);
  const endTimeFlexibility = validateEnum(value.endTimeFlexibility, timeFlexibilities, `items[${index}].endTimeFlexibility`);
  const base = value as unknown as ExtractedTripItem;
  if (typeof base.title !== "string" || typeof base.kind !== "string" || !Array.isArray(base.kinds) || typeof base.shape !== "string" || typeof base.shapeSource !== "string" || typeof base.status !== "string") {
    throw new ExtractionDraftValidationError(`items[${index}] is missing required itinerary fields.`);
  }
  validateEnum(base.kind, tripItemKinds, `items[${index}].kind`);
  if (base.kinds.some((kind) => typeof kind !== "string" || !tripItemKinds.includes(kind as (typeof tripItemKinds)[number]))) {
    throw new ExtractionDraftValidationError(`items[${index}].kinds contains an unsupported kind.`);
  }
  if (!base.kinds.includes(base.kind)) throw new ExtractionDraftValidationError(`items[${index}].kinds must include kind.`);
  validateEnum(base.shape, proposalShapes, `items[${index}].shape`);
  validateEnum(base.shapeSource, proposalShapeSources, `items[${index}].shapeSource`);
  validateEnum(base.status, tripItemStatuses, `items[${index}].status`);
  if (value.localDate !== undefined && value.localDate !== null && (typeof value.localDate !== "string" || !isIsoCalendarDate(value.localDate))) {
    throw new ExtractionDraftValidationError(`items[${index}].localDate must be an ISO calendar date.`);
  }
  for (const field of ["startsAt", "endsAt", "title", "sourceExcerpt"] as const) {
    if (value[field] !== undefined && value[field] !== null && typeof value[field] !== "string") throw new ExtractionDraftValidationError(`items[${index}].${field} must be a string.`);
  }
  for (const field of ["origin", "destination", "location", "notes", "deadlineAt"] as const) {
    if (value[field] !== undefined && typeof value[field] !== "string") throw new ExtractionDraftValidationError(`items[${index}].${field} must be a string.`);
  }
  for (const field of ["timezone", "originTimezone", "destinationTimezone"] as const) {
    if (value[field] !== undefined && typeof value[field] !== "string") throw new ExtractionDraftValidationError(`items[${index}].${field} must be a string.`);
  }
  if (value.timezoneSource !== undefined) validateEnum(value.timezoneSource, timezoneSources, `items[${index}].timezoneSource`);
  if (value.sourceLine !== undefined && (typeof value.sourceLine !== "number" || !Number.isInteger(value.sourceLine) || value.sourceLine < 1)) {
    throw new ExtractionDraftValidationError(`items[${index}].sourceLine must be a positive integer.`);
  }
  if (value.assumptions !== undefined && (!Array.isArray(value.assumptions) || value.assumptions.some((assumption) => typeof assumption !== "string"))) {
    throw new ExtractionDraftValidationError(`items[${index}].assumptions must be an array of strings.`);
  }
  const timeWindow = value.timeWindow === undefined ? undefined : validateEnum(value.timeWindow, timeWindows, `items[${index}].timeWindow`);
  return { ...base, startTimeFlexibility, endTimeFlexibility, ...(timeWindow ? { timeWindow } : {}) } as ExtractionDraftItem;
}

function validateMissing(value: unknown, index: number) {
  if (!isRecord(value) || typeof value.field !== "string" || typeof value.message !== "string" || typeof value.required !== "boolean") {
    throw new ExtractionDraftValidationError(`missing[${index}] must contain field, message, and required.`);
  }
  return { field: value.field, message: value.message, required: value.required };
}

function validateIssue(value: unknown, index: number) {
  if (!isRecord(value) || typeof value.code !== "string" || typeof value.message !== "string") {
    throw new ExtractionDraftValidationError(`issues[${index}] must contain code and message.`);
  }
  return { code: value.code, message: value.message };
}

function validateString(value: unknown, path: string): string {
  if (typeof value !== "string") throw new ExtractionDraftValidationError(`${path} must be a string.`);
  return value;
}

function validateEnum<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new ExtractionDraftValidationError(`${path} must be one of: ${allowed.join(", ")}.`);
  return value as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

const extractionInstructions = [
  "Extract itinerary candidates from the user's source content. Return only JSON matching the extraction_draft schema.",
  "Preserve uncertainty as assumptions or missing fields; do not invent exact dates, times, or locations.",
  "A vague part-of-day phrase such as 晚上, tonight, or in the evening is a timeWindow, not an exact timestamp: set startTimeFlexibility and endTimeFlexibility to flexible unless the source explicitly says the time is fixed or tied to a ticket/tour/reservation.",
  "When a calendar date is known but no exact clock time is stated, set localDate to the ISO date, keep startsAt null, and preserve any part-of-day phrase in timeWindow.",
  "When the source says arriving at, going to, staying in, or lodging in a named place (for example, 到 Page，想住 Holiday Inn), set location to that named place and keep the lodging property in title or notes.",
  "Group one user intention into one itinerary item: arrival wording used only to explain where a lodging is should remain context, not become a second item. Keep a separate Arrival only when the source explicitly requests it or provides an independently actionable time/location.",
  "Exclude low-information candidates such as Arrival with neither a usable location nor a date/time; report them in issues with code low_information_item. Do not invent recommendations. Do not emit duplicate candidates; if two candidates conflict, keep the source facts and report the ambiguity in issues.",
  "When existingDraft is present, treat sourceContent as a natural-language correction to that Draft and return the complete revised item batch. Preserve unchanged items, apply additions, and remove items the user explicitly excludes; do not create Proposals at extraction time.",
].join(" ");

const extractionDraftJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["items", "missing", "assumptions", "issues", "sourceExcerpt"],
  properties: {
    items: { type: "array", items: {
      type: "object", additionalProperties: false,
      required: ["kind", "kinds", "shape", "shapeSource", "title", "status", "localDate", "startsAt", "endsAt", "timezone", "timezoneSource", "originTimezone", "destinationTimezone", "location", "origin", "destination", "notes", "deadlineAt", "sourceLine", "sourceExcerpt", "startTimeFlexibility", "endTimeFlexibility", "timeWindow", "assumptions"],
      properties: {
        kind: { type: "string", enum: [...tripItemKinds] }, kinds: { type: "array", items: { type: "string", enum: [...tripItemKinds] } }, shape: { type: "string", enum: [...proposalShapes] }, shapeSource: { type: "string", enum: [...proposalShapeSources] }, title: { type: "string" }, status: { type: "string", enum: [...tripItemStatuses] },
        localDate: { type: ["string", "null"] }, startsAt: { type: ["string", "null"] }, endsAt: { type: ["string", "null"] }, timezone: { type: ["string", "null"] }, timezoneSource: { type: ["string", "null"], enum: [...timezoneSources, null] }, originTimezone: { type: ["string", "null"] }, destinationTimezone: { type: ["string", "null"] }, location: { type: ["string", "null"] }, origin: { type: ["string", "null"] }, destination: { type: ["string", "null"] }, notes: { type: ["string", "null"] }, deadlineAt: { type: ["string", "null"] }, sourceLine: { type: ["integer", "null"] }, sourceExcerpt: { type: ["string", "null"] }, startTimeFlexibility: { type: "string", enum: [...timeFlexibilities] }, endTimeFlexibility: { type: "string", enum: [...timeFlexibilities] }, timeWindow: { type: ["string", "null"], enum: [...timeWindows, null] }, assumptions: { type: "array", items: { type: "string" } },
      },
    } },
    missing: { type: "array", items: { type: "object", additionalProperties: false, required: ["field", "message", "required"], properties: { field: { type: "string" }, message: { type: "string" }, required: { type: "boolean" } } } },
    assumptions: { type: "array", items: { type: "string" } },
    issues: { type: "array", items: { type: "object", additionalProperties: false, required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" } } } },
    sourceExcerpt: { type: "string" },
  },
};

function responseText(body: unknown): string | null {
  if (!isRecord(body)) return null;
  if (typeof body.output_text === "string") return body.output_text;
  if (!Array.isArray(body.output)) return null;
  for (const output of body.output) {
    if (!isRecord(output) || !Array.isArray(output.content)) continue;
    for (const content of output.content) if (isRecord(content) && typeof content.text === "string") return content.text;
  }
  return null;
}

function removeNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeNulls);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null).map(([key, entry]) => [key, removeNulls(entry)]));
}
