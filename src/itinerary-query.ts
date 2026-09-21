import type { ItineraryQuery, ItineraryQueryResult, TimeWindow, TripItemKind } from "./domain.ts";
import { formatLocalDateTime } from "./timezone.ts";
import { parseItineraryKind } from "./itinerary-kinds.ts";
import { displayLocationAlias } from "./location-alias.ts";

export type ParsedItineraryMessage = { type: "query"; query: ItineraryQuery } | { type: "help" } | null;

export type ParsedProposalCommand = { type: "confirm"; proposalId: string } | { type: "reject"; proposalId: string; reason: string | null } | { type: "select"; decisionId: string; proposalId: string } | { type: "cancel"; decisionId: string } | { type: "invalid" } | null;
export type ParsedDraftCommand = { type: "confirm_draft"; draftId: string; itemIndexes?: number[] } | { type: "edit_draft"; draftId: string; content: string } | { type: "cancel_draft"; draftId: string } | { type: "retry_draft"; draftId: string } | { type: "retry_chunk"; chunkId: string } | { type: "view_draft"; draftId: string; page: number } | { type: "invalid_draft" } | null;

export function parseProposalCommand(text: string): ParsedProposalCommand {
  const normalized = text.trim().replace(/^@[^\s]+\s*/, "").trim();
  const confirm = normalized.match(/^(?:確認|confirm)\s+(P-[A-Z0-9]{8})$/i);
  if (confirm) return { type: "confirm", proposalId: confirm[1].toUpperCase() };
  const reject = normalized.match(/^(?:拒絕|reject)\s+(P-[A-Z0-9]{8})(?:\s*[|｜]\s*(.*))?$/i);
  if (reject) return { type: "reject", proposalId: reject[1].toUpperCase(), reason: reject[2]?.trim() || null };
  const select = normalized.match(/^(?:選擇|select)\s+(D-[A-Z0-9]{8})\s+(P-[A-Z0-9]{8})$/i);
  if (select) return { type: "select", decisionId: select[1].toUpperCase(), proposalId: select[2].toUpperCase() };
  const cancel = normalized.match(/^(?:取消\s+Decision|cancel\s+decision)\s+(D-[A-Z0-9]{8})$/i);
  if (cancel) return { type: "cancel", decisionId: cancel[1].toUpperCase() };
  if (/^(?:確認|confirm|拒絕|reject|選擇|select|取消\s+Decision|cancel\s+decision)(?:\s|$)/i.test(normalized)) return { type: "invalid" };
  return null;
}

export const proposalCommandHelp = "指令格式：確認 P-XXXXXXXX、拒絕 P-XXXXXXXX｜原因、選擇 D-XXXXXXXX P-XXXXXXXX，或取消 Decision D-XXXXXXXX。";

export function parseDraftCommand(text: string): ParsedDraftCommand {
  const normalized = text.trim().replace(/^@[^\s]+\s*/, "").trim();
  const confirm = normalized.match(/^(?:確認|confirm)\s+(X-[A-Z0-9]{8})(?:\s+(?:項目|items?)\s*=?\s*([0-9０-９]+(?:\s*[,，、]\s*[0-9０-９]+)*))?$/i);
  if (confirm) {
    const itemIndexes = confirm[2]?.split(/\s*[,，、]\s*/u).map((value) => Number(value.replace(/[０-９]/g, (digit) => String("０１２３４５６７８９".indexOf(digit)))) - 1);
    return { type: "confirm_draft", draftId: confirm[1].toUpperCase(), itemIndexes };
  }
  const edit = normalized.match(/^(?:修改|edit)\s+(X-[A-Z0-9]{8})\s*[|｜]\s*(.+)$/is);
  if (edit) return { type: "edit_draft", draftId: edit[1].toUpperCase(), content: edit[2].trim() };
  const cancel = normalized.match(/^(?:取消|cancel)\s+(?:Draft\s+)?(X-[A-Z0-9]{8})$/i);
  if (cancel) return { type: "cancel_draft", draftId: cancel[1].toUpperCase() };
  const retry = normalized.match(/^(?:重試|retry)\s+(?:Draft\s+)?(X-[A-Z0-9]{8})$/i);
  if (retry) return { type: "retry_draft", draftId: retry[1].toUpperCase() };
  const retryChunk = normalized.match(/^(?:重試|retry)\s+(?:Chunk\s+)?(C-[A-Z0-9]{8,})$/i);
  if (retryChunk) return { type: "retry_chunk", chunkId: retryChunk[1].toUpperCase() };
  const view = normalized.match(/^(?:查看|view|draft)\s+(?:Draft\s+)?(X-[A-Z0-9]{8})(?:\s+(?:第\s*)?(\d+)\s*頁?)?$/i);
  if (view) return { type: "view_draft", draftId: view[1].toUpperCase(), page: Math.max(1, Number(view[2] ?? "1")) };
  if (/^(?:確認|confirm|修改|edit|取消|cancel|重試|retry)\s+(?:Draft\s+)?X-/i.test(normalized)) return { type: "invalid_draft" };
  return null;
}

export const draftCommandHelp = "Draft 指令格式：查看 Draft X-XXXXXXXX [頁碼]、確認 X-XXXXXXXX（或確認 X-XXXXXXXX 項目 1,2）、修改 X-XXXXXXXX｜新內容、取消 Draft X-XXXXXXXX、重試 Draft X-XXXXXXXX，或重試 Chunk C-XXXXXXXX。";

export function parseItineraryMessage(text: string): ParsedItineraryMessage {
  const normalized = text.trim().replace(/^@[^\s]+\s*/, "").trim();
  const command = normalized.match(/^(查詢|查询|query)(.*)$/i);
  if (!command) return null;
  const rest = command[2].trim();
  if (!rest || /^(行程|itinerary)$/i.test(rest)) return { type: "query", query: {} };
  const history = rest.match(/^(?:歷史|history)\s+([A-Za-z0-9-]+)$/i);
  if (history) return { type: "query", query: { tripId: history[1], includeArchived: true } };
  const continuation = rest.match(/^(?:繼續|next)\s+(Q-[A-Z0-9]+)$/i);
  if (continuation) return { type: "query", query: { continuationToken: continuation[1].toUpperCase() } };
  if (/^(?:來源|source)$/i.test(rest)) return { type: "query", query: { includeSourceContent: true } };
  if (/^(待確認|待确认|pending)$/i.test(rest)) return { type: "query", query: { pendingOnly: true } };
  if (/^review\s*issues?$/i.test(rest)) return { type: "query", query: { reviewIssuesOnly: true } };
  const proposal = rest.match(/^(?:proposal\s+)?(P-[A-Z0-9]{8})$/i);
  if (proposal) return { type: "query", query: { proposalId: proposal[1].toUpperCase() } };
  if (/^\d{4}-\d{2}-\d{2}$/.test(rest)) return { type: "query", query: { date: rest } };
  const kind = parseKind(rest);
  if (kind) return { type: "query", query: { kind } };
  const filter = parseFixedQueryFilter(rest);
  if (filter) return { type: "query", query: filter };
  if (/^proposal\b/i.test(rest)) return { type: "help" };
  return { type: "query", query: { location: rest } };
}

export function renderItineraryQuery(result: ItineraryQueryResult, options: { notesRequested?: boolean; displayAlias?: string } = {}): string {
  const lines = [`${result.trip.title}｜${result.trip.status === "active" ? "Active" : "Archived"} Trip`];
  if (result.confirmed.length) lines.push(`Confirmed：${result.confirmed.map((item) => formatItem(item, "confirmed", options.displayAlias)).join("、")}`);
  if (result.pending.length) lines.push(`Pending：${result.pending.map((item) => `${item.id} ${formatItem(item, "pending", options.displayAlias)}`).join("、")}`);
  if (result.openDecisions.length) lines.push(`Open Decision：${result.openDecisions.map((decision) => `${decision.id} ${decision.title}`).join("、")}`);
  if (result.issues.length) lines.push(`Review Issues：${result.issues.length} 筆`);
  const matchedItems = [...result.confirmed, ...result.pending];
  if (options.notesRequested && matchedItems.length > 0 && matchedItems.every((item) => !item.notes)) lines.push("注意事項：行程未記錄注意事項");
  if (result.sources.length) lines.push(`Source 原文：${result.sources.map((source) => `${source.id}｜${source.content}`).join("\n")}`);
  if (result.nextPageToken) lines.push(`下一頁：查詢繼續 ${result.nextPageToken}`);
  if (lines.length === 1) return `${lines[0]}\n查無符合條件的行程資料。`;
  return lines.join("\n");
}

export const itineraryQueryHelp = "可用查詢：查詢行程、查詢 2026-10-01 下午 Page、查詢 confirmed、查詢 pending、查詢歷史 <Trip ID>、查詢繼續 Q-XXXXXXXX。";

function formatItem(item: { title: string; localDate?: string; startsAt?: string; timeWindow?: string; timezone?: string; timezoneSource?: string; originTimezone?: string; destinationTimezone?: string; location?: string; origin?: string; destination?: string; notes?: string }, status: "confirmed" | "pending", displayAlias?: string): string {
  const time = item.startsAt ? `｜${item.timezone ? formatLocalDateTime(item.startsAt, item.timezone) : item.startsAt}` : item.localDate ? `｜${item.localDate}${item.timeWindow ? ` ${item.timeWindow}` : ""}` : item.timeWindow ? `｜${item.timeWindow}` : "";
  const endpointZones = item.originTimezone || item.destinationTimezone ? `｜${item.originTimezone ?? item.timezone ?? "?"} → ${item.destinationTimezone ?? item.timezone ?? "?"}` : "";
  const place = item.origin && item.destination ? `｜Route: ${displayLocationAlias(item.origin, displayAlias)} → ${displayLocationAlias(item.destination, displayAlias)}` : item.location ? `｜${displayLocationAlias(item.location, displayAlias)}` : "";
  const notes = item.notes ? `｜備註: ${item.notes}` : "";
  return `${item.title}${time}${place}｜${status}${notes}${item.timezone ? `｜${item.timezone}` : ""}${endpointZones}${item.timezoneSource === "fallback" ? "｜timezone fallback" : ""}`;
}

function parseKind(value: string): TripItemKind | undefined {
  return parseItineraryKind(value);
}

function parseFixedQueryFilter(value: string): ItineraryQuery | null {
  let remainder = value;
  const query: ItineraryQuery = {};
  const date = remainder.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (date) {
    query.date = date[0];
    remainder = remainder.replace(date[0], " ");
  }
  const timeWindow = findTimeWindow(remainder);
  if (timeWindow) {
    query.timeWindow = timeWindow.value;
    remainder = remainder.replace(timeWindow.pattern, " ");
  }
  const status = remainder.match(/(?:^|\s)(confirmed|已確認|已确认|pending|待確認|待确认)(?=\s|$)/i);
  if (status) {
    query.status = /^(?:confirmed|已確認|已确认)$/i.test(status[1]) ? "confirmed" : "pending";
    remainder = remainder.replace(status[0], " ");
  }
  const location = remainder.trim().replace(/\s+/g, " ");
  if (Object.keys(query).length === 0) return null;
  if (location) query.location = location;
  return query;
}

function findTimeWindow(value: string): { value: TimeWindow; pattern: RegExp } | null {
  const aliases: Array<[TimeWindow, RegExp]> = [
    ["morning", /(?:^|\s)(?:morning|上午|早上)(?=\s|$)/i],
    ["afternoon", /(?:^|\s)(?:afternoon|下午|中午)(?=\s|$)/i],
    ["evening", /(?:^|\s)(?:evening|傍晚|晚上)(?=\s|$)/i],
    ["night", /(?:^|\s)(?:night|深夜|夜晚)(?=\s|$)/i],
  ];
  for (const [timeWindow, pattern] of aliases) if (pattern.test(value)) return { value: timeWindow, pattern };
  return null;
}
