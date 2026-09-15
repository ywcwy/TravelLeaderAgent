import type { ItineraryQuery, ItineraryQueryResult, TripItemKind } from "./domain.ts";

export type ParsedItineraryMessage = { type: "query"; query: ItineraryQuery } | { type: "help" } | null;

export type ParsedProposalCommand = { type: "confirm"; proposalId: string } | { type: "reject"; proposalId: string; reason: string | null } | { type: "select"; decisionId: string; proposalId: string } | { type: "cancel"; decisionId: string } | { type: "invalid" } | null;

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
  if (/^proposal\b/i.test(rest)) return { type: "help" };
  return { type: "query", query: { location: rest } };
}

export function renderItineraryQuery(result: ItineraryQueryResult): string {
  const lines = [`${result.trip.title}｜${result.trip.status === "active" ? "Active" : "Archived"} Trip`];
  if (result.confirmed.length) lines.push(`Confirmed：${result.confirmed.map(formatItem).join("、")}`);
  if (result.pending.length) lines.push(`Pending：${result.pending.map((item) => `${item.id} ${formatItem(item)}`).join("、")}`);
  if (result.openDecisions.length) lines.push(`Open Decision：${result.openDecisions.map((decision) => `${decision.id} ${decision.title}`).join("、")}`);
  if (result.issues.length) lines.push(`Review Issues：${result.issues.length} 筆`);
  if (result.sources.length) lines.push(`Source 原文：${result.sources.map((source) => `${source.id}｜${source.content}`).join("\n")}`);
  if (result.nextPageToken) lines.push(`下一頁：查詢繼續 ${result.nextPageToken}`);
  if (lines.length === 1) return `${lines[0]}\n查無符合條件的行程資料。`;
  return lines.join("\n");
}

export const itineraryQueryHelp = "可用查詢：查詢行程、查詢歷史 <Trip ID>、查詢 2026-10-01、查詢 Page、查詢待確認、查詢 Review Issues、查詢來源、查詢繼續 Q-XXXXXXXX。";

function formatItem(item: { title: string; startsAt?: string; location?: string }): string {
  return `${item.title}${item.startsAt ? `｜${item.startsAt}` : ""}${item.location ? `｜${item.location}` : ""}`;
}

function parseKind(value: string): TripItemKind | undefined {
  const aliases: Record<string, TripItemKind> = {
    flight: "flight", 航班: "flight", lodging: "lodging", 住宿: "lodging", 飯店: "lodging", hotel: "lodging",
    rental_car: "rental_car", 租車: "rental_car", transport: "transport", 交通: "transport", meal: "meal", 餐: "meal",
    activity: "activity", 活動: "activity", shopping: "shopping", 購物: "shopping", meeting: "meeting", 會議: "meeting",
    other: "other",
  };
  return aliases[value.toLocaleLowerCase()];
}
