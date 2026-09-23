import type { ExtractedTripItem, ProposalShape, TripItemKind, TripItemStatus } from "./domain.ts";
import { resolveLocationCandidates } from "./location-normalization.ts";

export const HUMAN_CONFIRMED_TABLE_FORMAT_VERSION = "1";
export const HUMAN_CONFIRMED_TABLE_MARKER = "<!-- itinerary-table -->";

export type HumanTableConfirmationStatus = "draft" | "confirmed";

export interface HumanTableIssue {
  code: "table_format" | "table_metadata" | "table_header" | "table_row" | "table_validation";
  message: string;
  sourceLine?: number;
  itemKey?: string;
}

/** Validate human-entered geography and time fields without rewriting the row. */
export function validateHumanConfirmedTableItems(items: readonly ExtractedTripItem[]): HumanTableIssue[] {
  const issues: HumanTableIssue[] = [];
  for (const item of items) {
    const prefix = item.itemKey ? `［${item.itemKey}］` : `「${item.title}」`;
    const add = (field: string, message: string): void => { issues.push({ code: "table_validation", message: `${prefix}${field}：${message}`, sourceLine: item.sourceLine, ...(item.itemKey ? { itemKey: item.itemKey } : {}) }); };
    const confirmed = item.status === "confirmed";
    if (item.shape === "route" && item.address?.trim()) add("address", "MVP 僅支援 point 的 address；route endpoint address 尚未支援。");
    if (containsPlaceholder(item.location)) add("location", "不可使用 TBD、待確認 或其他 placeholder。");
    if (containsPlaceholder(item.origin)) add("origin", "不可使用 TBD、待確認 或其他 placeholder。");
    if (containsPlaceholder(item.destination)) add("destination", "不可使用 TBD、待確認 或其他 placeholder。");
    if (item.shape === "point") {
      if (confirmed) {
        requireField(add, "location", item.location);
        requireField(add, "city", item.city);
        requireField(add, "region", item.region);
        requireField(add, "country", item.country);
      }
      validatePlace(add, "location", item.location, item.city, item.region, item.country);
    } else {
      if (confirmed) {
        requireField(add, "origin", item.origin);
        requireField(add, "origin_city", item.originCity);
        requireField(add, "origin_region", item.originRegion);
        requireField(add, "origin_country", item.originCountry);
        requireField(add, "destination", item.destination);
        requireField(add, "destination_city", item.destinationCity);
        requireField(add, "destination_region", item.destinationRegion);
        requireField(add, "destination_country", item.destinationCountry);
      }
      validatePlace(add, "origin", item.origin, item.originCity, item.originRegion, item.originCountry);
      validatePlace(add, "destination", item.destination, item.destinationCity, item.destinationRegion, item.destinationCountry);
    }
    if (confirmed && (item.startsAt || item.endsAt)) {
      if (item.shape === "point") validateTimezone(add, "timezone", item.timezone);
      else {
        validateTimezone(add, "origin_timezone", item.originTimezone);
        validateTimezone(add, "destination_timezone", item.destinationTimezone);
      }
    }
  }
  return issues;
}

export interface HumanConfirmedTableParseResult {
  formatVersion: string | null;
  confirmationStatus: HumanTableConfirmationStatus | null;
  items: ExtractedTripItem[];
  issues: HumanTableIssue[];
  notes: string[];
}

const requiredHeaders = [
  "item_key", "title", "status", "kind", "shape", "date", "start_time", "end_time", "timezone",
  "location", "city", "region", "country", "origin", "origin_city", "origin_region",
  "origin_country", "origin_timezone", "destination", "destination_city", "destination_region",
  "destination_country", "destination_timezone", "notes",
] as const;

const knownStatuses = new Set<TripItemStatus>(["confirmed", "provisional", "open_decision"]);
const knownKinds = new Set<TripItemKind>(["flight", "lodging", "rental_car", "transport", "meal", "activity", "shopping", "meeting", "other"]);

/** Detect only the explicit versioned table format; compact Markdown remains separate. */
export function isHumanConfirmedTable(markdown: string): boolean {
  return hasHumanConfirmedTableMarker(markdown) && /^\s*format_version\s*:/imu.test(markdown);
}

export function parseHumanConfirmedTable(markdown: string): HumanConfirmedTableParseResult {
  const lines = markdown.split(/\r?\n/);
  const issues: HumanTableIssue[] = [];
  const notes: string[] = [];
  let formatVersion: string | null = null;
  let confirmationStatus: HumanTableConfirmationStatus | null = null;
  let inTable = false;
  let inNotes = false;
  let header: string[] | null = null;
  let separatorSeen = false;
  let tableLines = 0;
  const parsedItems: ExtractedTripItem[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    const lineNumber = index + 1;
    const metadata = trimmed.match(/^([a-z_]+)\s*:\s*(.+)$/iu);
    if (!inTable && !inNotes && metadata) {
      const key = metadata[1]!.toLocaleLowerCase();
      const value = metadata[2]!.trim();
      if (key === "format_version") formatVersion = value;
      else if (key === "confirmation_status") {
        if (value === "draft" || value === "confirmed") confirmationStatus = value;
        else issues.push({ code: "table_metadata", message: `confirmation_status 僅支援 draft 或 confirmed：${value}。`, sourceLine: lineNumber });
      }
      continue;
    }
    if (/^##\s+Itinerary Table\s*$/iu.test(trimmed)) {
      inTable = true;
      inNotes = false;
      continue;
    }
    if (/^##\s+Notes\s*$/iu.test(trimmed)) {
      inTable = false;
      inNotes = true;
      continue;
    }
    if (inNotes) {
      if (trimmed) notes.push(trimmed);
      continue;
    }
    if (!inTable || !trimmed || trimmed === HUMAN_CONFIRMED_TABLE_MARKER) continue;
    if (!trimmed.startsWith("|")) {
      issues.push({ code: "table_format", message: `Itinerary Table 第 ${lineNumber} 行必須是 Markdown table。`, sourceLine: lineNumber });
      continue;
    }
    const cells = splitTableRow(trimmed);
    if (!header) {
      header = cells.map(normalizeHeader);
      const parsedHeader = header;
      const duplicates = parsedHeader.filter((value, position) => value && parsedHeader.indexOf(value) !== position);
      if (duplicates.length > 0) issues.push({ code: "table_header", message: `Itinerary Table 有重複欄位：${[...new Set(duplicates)].join(", " )}。`, sourceLine: lineNumber });
      const missing = requiredHeaders.filter((value) => !parsedHeader.includes(value));
      if (missing.length > 0) issues.push({ code: "table_header", message: `Itinerary Table 缺少欄位：${missing.join(", " )}。`, sourceLine: lineNumber });
      continue;
    }
    if (!separatorSeen && cells.every((cell) => /^:?-{3,}:?$/.test(cell))) {
      separatorSeen = true;
      continue;
    }
    if (!separatorSeen) {
      issues.push({ code: "table_format", message: `Itinerary Table 第 ${lineNumber} 行缺少分隔列。`, sourceLine: lineNumber });
      continue;
    }
    tableLines += 1;
    if (cells.length !== header.length) {
      issues.push({ code: "table_row", message: `Itinerary Table 第 ${lineNumber} 行欄位數量錯誤：預期 ${header.length} 欄，收到 ${cells.length} 欄。`, sourceLine: lineNumber });
    }
    const values = Object.fromEntries(header.map((key, position) => [key, cells[position] ?? ""]));
    const itemKey = values.item_key?.trim() || undefined;
    const rowIssue = (message: string): void => { issues.push({ code: "table_row", message, sourceLine: lineNumber, ...(itemKey ? { itemKey } : {}) }); };
    if (!itemKey) rowIssue("Table Item 缺少 item_key。");
    const status = values.status?.trim() as TripItemStatus;
    const kind = values.kind?.trim() as TripItemKind;
    const shape = values.shape?.trim() as ProposalShape;
    if (!knownStatuses.has(status)) rowIssue(`Table Item ${itemKey ?? "(unknown)"} 的 status 不支援：${values.status || "(blank)"}。`);
    if (!knownKinds.has(kind)) rowIssue(`Table Item ${itemKey ?? "(unknown)"} 的 kind 不支援：${values.kind || "(blank)"}。`);
    if (shape !== "point" && shape !== "route") rowIssue(`Table Item ${itemKey ?? "(unknown)"} 的 shape 不支援：${values.shape || "(blank)"}。`);
    const date = values.date?.trim();
    const startTime = values.start_time?.trim();
    const endTime = values.end_time?.trim();
    if (!date) rowIssue(`Table Item ${itemKey ?? "(unknown)"} 缺少 date。`);
    else if (!isIsoDate(date)) rowIssue(`Table Item ${itemKey ?? "(unknown)"} 的 date 必須是有效的 YYYY-MM-DD。`);
    if (startTime && !isClockTime(startTime)) rowIssue(`Table Item ${itemKey ?? "(unknown)"} 的 start_time 必須是 HH:MM 或 HH:MM:SS。`);
    if (endTime && !isClockTime(endTime)) rowIssue(`Table Item ${itemKey ?? "(unknown)"} 的 end_time 必須是 HH:MM 或 HH:MM:SS。`);
    if ((startTime || endTime) && !date) rowIssue(`Table Item ${itemKey ?? "(unknown)"} 有時間但缺少 date。`);
    if (shape === "route" && (!values.origin?.trim() || !values.destination?.trim())) rowIssue(`Table Item ${itemKey ?? "(unknown)"} 的 route 缺少 origin 或 destination。`);
    const item: ExtractedTripItem = {
      itemKey,
      title: values.title?.trim() || itemKey || `Table Item ${tableLines}`,
      kind: knownKinds.has(kind) ? kind : "other",
      kinds: knownKinds.has(kind) ? [kind] : ["other"],
      shape: shape === "route" ? "route" : "point",
      shapeSource: "explicit",
      status: knownStatuses.has(status) ? status : "provisional",
      localDate: date || undefined,
      startsAt: combineDateTime(date, startTime),
      endsAt: combineDateTime(date, endTime),
      timezone: values.timezone?.trim() || undefined,
      location: values.location?.trim() || undefined,
      address: values.address?.trim() || undefined,
      city: values.city?.trim() || undefined,
      region: values.region?.trim() || undefined,
      country: values.country?.trim() || undefined,
      origin: values.origin?.trim() || undefined,
      originCity: values.origin_city?.trim() || undefined,
      originRegion: values.origin_region?.trim() || undefined,
      originCountry: values.origin_country?.trim() || undefined,
      originTimezone: values.origin_timezone?.trim() || undefined,
      destination: values.destination?.trim() || undefined,
      destinationCity: values.destination_city?.trim() || undefined,
      destinationRegion: values.destination_region?.trim() || undefined,
      destinationCountry: values.destination_country?.trim() || undefined,
      destinationTimezone: values.destination_timezone?.trim() || undefined,
      notes: values.notes?.trim() || undefined,
      sourceLine: lineNumber,
      sourceExcerpt: line.trim(),
    };
    // Keep invalid rows reviewable in the Draft; validation is a later phase.
    // Do not create an item for a completely empty row.
    if (cells.some((cell) => cell.trim())) {
      parsedItems.push(item);
    }
  }

  if (!hasHumanConfirmedTableMarker(markdown)) issues.push({ code: "table_format", message: `缺少 ${HUMAN_CONFIRMED_TABLE_MARKER} 格式標記。` });
  if (!formatVersion) issues.push({ code: "table_metadata", message: "缺少 format_version。" });
  else if (formatVersion !== HUMAN_CONFIRMED_TABLE_FORMAT_VERSION) issues.push({ code: "table_metadata", message: `不支援的 format_version：${formatVersion}。` });
  if (!confirmationStatus) issues.push({ code: "table_metadata", message: "缺少 confirmation_status。" });
  if (!header) issues.push({ code: "table_format", message: "找不到正式的 Itinerary Table 欄位表頭。" });
  if (header && !separatorSeen) issues.push({ code: "table_format", message: "找不到 Itinerary Table 分隔列。" });
  return { formatVersion, confirmationStatus, items: parsedItems, issues, notes };
}

function hasHumanConfirmedTableMarker(markdown: string): boolean {
  return new RegExp(HUMAN_CONFIRMED_TABLE_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu").test(markdown);
}

function normalizeHeader(value: string): string {
  return value.trim().toLocaleLowerCase().replaceAll(" ", "_");
}

function splitTableRow(line: string): string[] {
  const body = line.replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  let escaped = false;
  for (const character of body) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  if (escaped) current += "\\";
  cells.push(current.trim());
  return cells;
}

function combineDateTime(date: string, time: string): string | undefined {
  if (!date || !time) return undefined;
  return `${date}T${time.length === 5 ? `${time}:00` : time}`;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year!, month! - 1, day!));
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month! - 1 && candidate.getUTCDate() === day;
}

function isClockTime(value: string): boolean {
  const match = value.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return false;
  const hour = Number(match[1]); const minute = Number(match[2]); const second = Number(match[3] ?? "0");
  return hour <= 23 && minute <= 59 && second <= 59;
}

function requireField(add: (field: string, message: string) => void, field: string, value: string | undefined): void {
  if (!value?.trim()) add(field, "缺少必要欄位。");
}

function containsPlaceholder(value: string | undefined): boolean {
  return Boolean(value && /^(?:tbd|待確認|待定|unknown|n\/a|-)$/iu.test(value.trim()));
}

function validateTimezone(add: (field: string, message: string) => void, field: string, value: string | undefined): void {
  if (!value?.trim()) {
    add(field, "有時間的 confirmed row 必須填寫 IANA timezone。");
    return;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
  } catch {
    add(field, `不是有效的 IANA timezone：${value}。`);
  }
}

function validatePlace(add: (field: string, message: string) => void, field: string, text: string | undefined, city: string | undefined, region: string | undefined, country: string | undefined): void {
  if (!text?.trim() || containsPlaceholder(text)) return;
  const resolution = resolveLocationCandidates(text);
  if (resolution.status !== "resolved") {
    add(field, resolution.status === "ambiguous" ? "對應到多個 Registry 地點，請改用明確名稱。" : `尚未在 Location Registry 正規化：${text}。`);
    return;
  }
  const expected: Array<[string, string | undefined, string | undefined]> = [["city", city, resolution.location.city], ["region", region, resolution.location.region], ["country", country, resolution.location.country]];
  for (const [name, actual, canonical] of expected) {
    if (actual?.trim() && canonical && actual.trim().toLocaleLowerCase() !== canonical.trim().toLocaleLowerCase()) add(`${field}.${name}`, `與 Registry 不一致：填入「${actual}」，Registry 為「${canonical}」。`);
  }
}
