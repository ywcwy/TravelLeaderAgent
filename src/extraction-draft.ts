import {
  proposalShapeSources,
  proposalShapes,
  timeFlexibilities,
  timeWindows,
  tripItemKinds,
  tripItemStatuses,
  timezoneSources,
} from "./domain.ts";
import type { ExtractedTripItem, ExtractionDraft, ExtractionDraftItem, ExtractionDraftPayload } from "./domain.ts";

export interface LlmExtractionInput {
  sourceContent: string;
  tripTimezone: string;
  currentDate: string;
  inputType: string;
}

export interface LlmAdapter {
  extract(input: LlmExtractionInput): ExtractionDraftPayload | Promise<ExtractionDraftPayload>;
}

export class ExtractionDraftValidationError extends Error {}

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

/** A deterministic adapter used by tests and local development; it never calls a model. */
export class FakeLlmAdapter implements LlmAdapter {
  private readonly fixtures: Map<string, ExtractionDraftPayload>;

  constructor(fixtures: ReadonlyMap<string, ExtractionDraftPayload> | Record<string, ExtractionDraftPayload> = {}) {
    this.fixtures = fixtures instanceof Map ? new Map(fixtures) : new Map(Object.entries(fixtures));
  }

  extract(input: LlmExtractionInput): ExtractionDraftPayload {
    const fixture = this.fixtures.get(input.sourceContent);
    if (fixture) return structuredClone(fixture);
    return defaultFixture(input);
  }
}

export function renderExtractionDraft(draft: Pick<ExtractionDraft, "id" | "status" | "items" | "missing" | "assumptions" | "issues">): string {
  const itemLines = draft.items.map((item) => {
    const time = item.startsAt ?? item.timeWindow ?? "未指定時間";
    const place = item.shape === "route" ? `${item.origin ?? "?"} → ${item.destination ?? "?"}` : (item.location ?? "未指定地點");
    return `- ${item.title}｜${time}｜${place}｜時間 ${item.startTimeFlexibility}/${item.endTimeFlexibility}`;
  });
  const lines = [`Extraction Draft ${draft.id}｜${draft.status}`, ...(itemLines.length > 0 ? itemLines : ["- 尚未解析出行程項目"])];
  if (draft.missing.length > 0) lines.push(`缺少：${draft.missing.map((entry) => `${entry.field}${entry.required ? "（必要）" : "（可選）"}`).join("、")}`);
  if (draft.assumptions.length > 0) lines.push(`假設：${draft.assumptions.join("；")}`);
  if (draft.issues.length > 0) lines.push(`問題：${draft.issues.map((issue) => issue.message).join("；")}`);
  lines.push(`請確認：確認 Draft ${draft.id}`);
  return lines.join("\n");
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
  for (const field of ["startsAt", "endsAt", "title", "sourceExcerpt"] as const) {
    if (value[field] !== undefined && typeof value[field] !== "string") throw new ExtractionDraftValidationError(`items[${index}].${field} must be a string.`);
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
