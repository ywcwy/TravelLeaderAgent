import type { TravelService } from "./travel-service.ts";
import type { WebhookInbox, WebhookInboxEvent } from "./webhook-inbox.ts";
import { draftCommandHelp, itineraryQueryHelp, parseDraftCommand, parseItineraryMessage, parseProposalCommand, proposalCommandHelp, renderItineraryQuery } from "./itinerary-query.ts";
import { guardExtractionDraftPayload, renderExtractionDraft, validateExtractionDraftPayload, type LlmAdapter } from "./extraction-draft.ts";
import { QueryFilterValidationError, type QueryFilterAdapter, validateQueryFilter } from "./query-filter.ts";
import { QueryRouterValidationError, type QueryRouterAdapter, validateQueryRouterResult } from "./query-router.ts";

export type LineReplySender = (replyToken: string, text: string) => void | Promise<void>;
export interface QueryRouterWorkerOptions { now?: () => number; replyDeadlineMs?: number; maxRequestsPerMemberPerMinute?: number; }

function needsNaturalLanguageFallback(text: string): boolean {
  const normalized = text.trim().replace(/^@[^\s]+\s*/, "");
  return /^(?:查詢|查询|query)\s+/i.test(normalized) && (/[？?]/u.test(normalized) || /\b\d{1,2}\/\d{1,2}\b/u.test(normalized));
}

export class LineSourceWorker {
  private readonly inbox: WebhookInbox;
  private readonly travel: TravelService;
  private readonly reply: LineReplySender;
  private readonly extractionAdapter: LlmAdapter | null;
  private readonly queryFilterAdapter: QueryFilterAdapter | null;
  private readonly queryRouter: QueryRouterAdapter | null;
  private readonly routerNow: () => number;
  private readonly replyDeadlineMs: number;
  private readonly maxRequestsPerMemberPerMinute: number;
  private readonly routerRequests = new Map<string, number[]>();
  private readonly routerInFlight = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private active: Promise<"processed" | "failed" | "idle"> | null = null;
  private processing = false;
  constructor(inbox: WebhookInbox, travel: TravelService, reply: LineReplySender, extractionAdapter: LlmAdapter | null = null, queryFilterAdapter: QueryFilterAdapter | null = null, queryRouter: QueryRouterAdapter | null = null, routerOptions: QueryRouterWorkerOptions = {}) { this.inbox = inbox; this.travel = travel; this.reply = reply; this.extractionAdapter = extractionAdapter; this.queryFilterAdapter = queryFilterAdapter; this.queryRouter = queryRouter; this.routerNow = routerOptions.now ?? Date.now; this.replyDeadlineMs = routerOptions.replyDeadlineMs ?? 20_000; this.maxRequestsPerMemberPerMinute = routerOptions.maxRequestsPerMemberPerMinute ?? 6; }

  start(intervalMs = 1_000): void {
    if (this.timer) return;
    void this.processNext();
    this.timer = setInterval(() => { void this.processNext(); }, intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    await this.active;
  }

  processNext(): Promise<"processed" | "failed" | "idle"> {
    if (this.processing) return this.active ?? Promise.resolve("idle");
    this.processing = true;
    let run: Promise<"processed" | "failed" | "idle">;
    try {
      run = this.processClaimedEvent();
    } catch (error) {
      this.processing = false;
      process.stderr.write(`line_source_worker_claim_failed errorType=${error instanceof Error ? error.constructor.name : "UnknownError"}\n`);
      return Promise.resolve("failed");
    }
    const tracked = run.finally(() => { this.processing = false; this.active = null; });
    this.active = tracked;
    return tracked;
  }

  private processClaimedEvent(): Promise<"processed" | "failed" | "idle"> {
    const event = this.inbox.claimNext();
    if (!event) return Promise.resolve("idle");
    const leaseToken = event.leaseToken ?? "";
    const replyToken = this.inbox.consumeReplyToken(event.eventId, leaseToken);
    return (async () => {
      try {
        const parsed = parseItineraryMessage(event.text);
        const draftCommand = parseDraftCommand(event.text);
        const command = parseProposalCommand(event.text);
        if (draftCommand) {
          if (replyToken) await this.reply(replyToken, await this.draftReply(event, draftCommand));
          this.inbox.complete(event.eventId, leaseToken);
          return "processed" as const;
        }
        if (command) {
          if (replyToken) {
            const text = command.type === "invalid" ? proposalCommandHelp
              : command.type === "confirm" ? this.confirmReply(event.tripId, event.userId, command.proposalId)
              : command.type === "reject" ? this.rejectReply(event.tripId, event.userId, command.proposalId, command.reason)
              : command.type === "select" ? this.selectReply(event.tripId, event.userId, command.decisionId, command.proposalId)
              : this.cancelReply(event.tripId, event.userId, command.decisionId);
            await this.reply(replyToken, text);
          }
          this.inbox.complete(event.eventId, leaseToken);
          return "processed" as const;
        }
        if (this.queryRouter) {
          const routed = await this.routerReply(event);
          if (routed !== null) {
            if (replyToken) await this.reply(replyToken, routed);
            this.inbox.complete(event.eventId, leaseToken);
            return "processed" as const;
          }
        }
        if (parsed) {
          if (replyToken) {
            const targetTripId = parsed.type === "query" && parsed.query.tripId ? parsed.query.tripId : event.tripId;
            const text = parsed.type === "help" ? itineraryQueryHelp : await this.queryReply(event, targetTripId, parsed.query);
            await this.reply(replyToken, text);
          }
          this.inbox.complete(event.eventId, leaseToken);
          return "processed" as const;
        }
        if (isQuestion(event.text)) {
          if (replyToken) await this.reply(replyToken, "這看起來是問題，未建立行程 Draft。請改用「查詢行程」或補充要寫入行程的內容。");
          this.inbox.complete(event.eventId, leaseToken);
          return "processed" as const;
        }
        if (isStructuredMarkdown(event.text) || !this.extractionAdapter) {
          const imported = this.importSource(event);
          if (replyToken) await this.reply(replyToken, this.contextualReply(event.tripId, imported.proposalIds));
          this.inbox.complete(event.eventId, leaseToken);
          return "processed" as const;
        }
        const draft = await this.travel.createExtractionDraft(event.tripId, event.text, {
          idempotencyKey: event.eventId,
          sourceTime: event.receivedAt,
          type: "line_text",
          currentDate: event.receivedAt.slice(0, 10),
          provenance: { provider: "line", messageId: event.messageId, groupId: event.groupId, userId: event.userId },
        }, this.extractionAdapter!);
        if (replyToken) await this.reply(replyToken, renderExtractionDraft(draft, { chunks: this.travel.getImportChunks(event.tripId, draft.sourceId) }));
        this.inbox.complete(event.eventId, leaseToken);
        return "processed" as const;
      } catch (error) {
        this.inbox.fail(event.eventId, leaseToken, error);
        return "failed" as const;
      }
    })();
  }

  private async routerReply(event: WebhookInboxEvent): Promise<string | null> {
    const startedAt = this.routerNow();
    const metadata = this.queryRouter!.metadata;
    const telemetry = (outcome: Omit<import("./webhook-inbox.ts").QueryRouterTelemetry, "latencyMs" | "provider" | "model" | "promptVersion">): void => this.inbox.recordQueryRouterEvent(event.eventId, { ...outcome, latencyMs: this.routerNow() - startedAt, provider: metadata?.provider, model: metadata?.model, promptVersion: metadata?.promptVersion });
    if (startedAt - Date.parse(event.receivedAt) > this.replyDeadlineMs) {
      telemetry({ outcome: "deadline_exceeded", reason: "reply_deadline" });
      return "目前回覆時間已超過限制，請再傳一次訊息。";
    }
    const recent = (this.routerRequests.get(event.userId) ?? []).filter((at) => startedAt - at < 60_000);
    if (recent.length >= this.maxRequestsPerMemberPerMinute || this.routerInFlight.has(event.userId)) {
      telemetry({ outcome: "rate_limited", reason: recent.length >= this.maxRequestsPerMemberPerMinute ? "per_member_rate" : "per_member_in_flight" });
      return "查詢太頻繁，請稍後再試。";
    }
    recent.push(startedAt);
    this.routerRequests.set(event.userId, recent);
    this.routerInFlight.add(event.userId);
    try {
      const trip = this.travel.getTrip(event.tripId);
      if (!trip) throw new Error("Trip not found.");
      const routed = validateQueryRouterResult(await this.queryRouter!.route({ text: event.text, tripTimezone: trip.timezone, currentDate: event.receivedAt.slice(0, 10) }));
      if (routed.intent === "itinerary_query") {
        telemetry({ intent: routed.intent, selectedTool: "search_itinerary", outcome: "completed" });
        const query = routed.overview ? {} : routed.filter!;
        return renderItineraryQuery(this.travel.queryTrip(event.tripId, event.userId, query), { notesRequested: routed.notesRequested, displayAlias: routed.overview ? undefined : routed.filter?.location });
      }
      if (routed.intent === "itinerary_input") { telemetry({ intent: routed.intent, outcome: "completed" }); return null; }
      if (routed.intent === "clarification") { telemetry({ intent: routed.intent, selectedTool: "clarify_query", outcome: "completed" }); return routed.question; }
      telemetry({ intent: routed.intent, outcome: "rejected", reason: "unsupported_action" });
      return routed.message ?? "這個操作目前不支援。若要查詢行程，請直接描述日期、地點或路線。";
    } catch (error) {
      if (error instanceof QueryRouterValidationError || error instanceof QueryFilterValidationError) {
        telemetry({ outcome: "failed", reason: "invalid_router_output" });
        return "目前無法理解這個查詢，請換個方式描述日期、地點或路線。";
      }
      const fallback = await this.fallbackNaturalQuery(event);
      if (fallback) {
        telemetry({ intent: "itinerary_query", selectedTool: "search_itinerary", outcome: "completed", reason: "deterministic_fallback" });
        return fallback;
      }
      telemetry({ outcome: "failed", reason: "router_failure" });
      return "目前無法處理這個訊息，請稍後再試；也可以用日期、地點或路線描述要查的行程。";
    } finally { this.routerInFlight.delete(event.userId); }
  }

  private async fallbackNaturalQuery(event: WebhookInboxEvent): Promise<string | null> {
    if (!this.queryFilterAdapter || !/(?:查詢|行程|安排|美西|Arizona|亞利桑那|Page|Grand Canyon|大峽谷|Vegas|拉斯維加斯)/iu.test(event.text)) return null;
    try {
      const trip = this.travel.getTrip(event.tripId);
      if (!trip) return null;
      const filter = validateQueryFilter(await this.queryFilterAdapter.interpret({ text: event.text, tripTimezone: trip.timezone, currentDate: event.receivedAt.slice(0, 10) }));
      return renderItineraryQuery(this.travel.queryTrip(event.tripId, event.userId, filter), { displayAlias: filter.location });
    } catch {
      return null;
    }
  }

  private async queryReply(event: WebhookInboxEvent, tripId: string, query: import("./domain.ts").ItineraryQuery): Promise<string> {
    if (this.queryFilterAdapter && needsNaturalLanguageFallback(event.text)) {
      try {
        const trip = this.travel.getTrip(tripId);
        if (!trip) throw new Error("Trip not found.");
        const text = event.text.trim().replace(/^@[^\s]+\s*/, "");
        const filter = validateQueryFilter(await this.queryFilterAdapter.interpret({ text, tripTimezone: trip.timezone, currentDate: event.receivedAt.slice(0, 10) }));
        return renderItineraryQuery(this.travel.queryTrip(tripId, event.userId, filter), { displayAlias: filter.location });
      } catch (error) {
        if (error instanceof QueryFilterValidationError) return `無法解析查詢條件，請使用固定格式，例如：${itineraryQueryHelp}`;
        return `目前無法解析自然語言查詢，請使用固定格式，例如：${itineraryQueryHelp}`;
      }
    }
    return renderItineraryQuery(this.travel.queryTrip(tripId, event.userId, query), { displayAlias: query.location });
  }

  private async draftReply(event: WebhookInboxEvent, command: Exclude<ReturnType<typeof parseDraftCommand>, null>): Promise<string> {
    if (!this.extractionAdapter) return draftCommandHelp;
    try {
      if (command.type === "invalid_draft") return draftCommandHelp;
      if (command.type === "view_draft") {
        const draft = this.travel.getExtractionDraft(event.tripId, command.draftId);
        if (!draft) throw new Error(`Extraction Draft ${command.draftId} was not found.`);
        return renderExtractionDraft(draft, { page: command.page, chunks: this.travel.getImportChunks(event.tripId, draft.sourceId) });
      }
      if (command.type === "confirm_draft") {
        const result = this.travel.confirmExtractionDraft(event.tripId, event.userId, command.draftId, command.itemIndexes);
        if (result.draft.status !== "confirmed") return `Draft ${command.draftId} 已部分確認，建立 Proposal：${result.proposalIds.join("、")}；其餘項目仍待處理。`;
        return result.proposalIds.length > 0 ? `已確認 Draft ${command.draftId}，建立 Proposal：${result.proposalIds.join("、")}。` : `Draft ${command.draftId} 已確認。`;
      }
      if (command.type === "cancel_draft") {
        this.travel.cancelExtractionDraft(event.tripId, event.userId, command.draftId);
        return `已取消 Draft ${command.draftId}。`;
      }
      if (command.type === "retry_draft") {
        const draft = await this.travel.retryExtractionDraft(event.tripId, event.userId, command.draftId, this.extractionAdapter);
        return renderExtractionDraft(draft, { chunks: this.travel.getImportChunks(event.tripId, draft.sourceId) });
      }
      if (command.type === "retry_chunk") {
        const chunk = await this.travel.retryImportChunk(event.tripId, event.userId, command.chunkId, this.extractionAdapter);
        const draft = this.travel.getLatestExtractionDrafts(event.tripId).find((entry) => entry.draft.sourceId === chunk.sourceId)?.draft;
        return draft
          ? renderExtractionDraft(draft, { chunks: this.travel.getImportChunks(event.tripId, chunk.sourceId) })
          : `Chunk ${chunk.id} 已重試：${chunk.status}。`;
      }
      const trip = this.travel.getTrip(event.tripId);
      if (!trip) throw new Error(`Trip ${event.tripId} was not found.`);
      const currentDraft = this.travel.getExtractionDraft(event.tripId, command.draftId);
      if (!currentDraft) throw new Error(`Extraction Draft ${command.draftId} was not found.`);
      this.travel.assertSafeExtractionContent(command.content);
      const payload = guardExtractionDraftPayload(validateExtractionDraftPayload(await this.extractionAdapter.extract({
        sourceContent: command.content,
        tripTimezone: trip.timezone,
        currentDate: event.receivedAt.slice(0, 10),
        inputType: "line_text",
        existingDraft: { items: currentDraft.items, missing: currentDraft.missing, assumptions: currentDraft.assumptions, issues: currentDraft.issues, sourceExcerpt: currentDraft.sourceExcerpt },
      })), `${currentDraft.sourceExcerpt}\n${command.content}`);
      const draft = this.travel.reviseExtractionDraft(event.tripId, event.userId, command.draftId, payload);
      return renderExtractionDraft(draft, { chunks: this.travel.getImportChunks(event.tripId, draft.sourceId) });
    } catch (error) {
      return commandErrorReply(error);
    }
  }

  private confirmReply(tripId: string, userId: string, proposalId: string): string {
    try {
      const item = this.travel.confirmProposal(tripId, userId, proposalId);
      return `已確認 Proposal ${proposalId}：${item.title}。`;
    } catch (error) {
      return commandErrorReply(error);
    }
  }

  private rejectReply(tripId: string, userId: string, proposalId: string, reason: string | null): string {
    try {
      const proposal = this.travel.rejectProposal(tripId, userId, proposalId, reason);
      return `已拒絕 Proposal ${proposalId}${proposal.rejectionReason ? `：${proposal.rejectionReason}` : "。"}`;
    } catch (error) {
      return commandErrorReply(error);
    }
  }

  private selectReply(tripId: string, userId: string, decisionId: string, proposalId: string): string {
    try {
      const resolved = this.travel.resolveDecision(tripId, userId, decisionId, proposalId);
      return `已在 Decision ${decisionId} 選擇 Proposal ${proposalId}：${resolved.item.title}。`;
    } catch (error) {
      return commandErrorReply(error);
    }
  }

  private cancelReply(tripId: string, userId: string, decisionId: string): string {
    try {
      this.travel.cancelDecision(tripId, userId, decisionId);
      return `已取消 Decision ${decisionId}。`;
    } catch (error) {
      return commandErrorReply(error);
    }
  }

  private importSource(event: WebhookInboxEvent): { proposalIds: string[] } {
    return this.travel.importMarkdown(event.tripId, event.text, {
      idempotencyKey: event.eventId,
      sourceTime: event.receivedAt,
      type: "line_text",
      provenance: { provider: "line", messageId: event.messageId, groupId: event.groupId, userId: event.userId },
    });
  }

  private contextualReply(tripId: string, proposalIds: string[]): string {
    if (proposalIds.length === 0) return "已收到內容，已保存原始 Source；目前無法建立 Proposal，請補充日期、地點或路線。";
    const contexts = proposalIds.map((proposalId) => this.travel.getProposalContext(tripId, proposalId)).filter((context): context is NonNullable<typeof context> => context !== null);
    const proposals = contexts.map((context) => context.proposal);
    const candidates = proposals.map((proposal) => `${proposal.id}：${proposal.title}${proposal.startsAt ? `｜${proposal.startsAt}` : ""}${proposal.location ? `｜${proposal.location}` : ""}`).join("、");
    const confirmed = contexts.flatMap((context) => context.confirmed);
    const pending = contexts.flatMap((context) => context.pending);
    const overlapping = contexts.flatMap((context) => context.overlappingConfirmed);
    const contextLines = confirmed.length > 0
      ? [`目前已有 confirmed 行程：${confirmed.map((item) => `${item.title}${item.startsAt ? `｜${item.startsAt}` : ""}${item.location ? `｜${item.location}` : ""}`).join("、")}`, overlapping.length > 0 ? "與新 Proposal 有時間重疊，請由 Decision Owner 判斷。" : "目前未偵測到時間衝突。"]
      : ["目前沒有同日期、同類型的 confirmed 行程。"];
    if (pending.length > 0) contextLines.push(`同日期、同類型的 pending Proposal：${pending.map((proposal) => proposal.id).join("、")}`);
    return `已收到 Proposal ${candidates}\n${contextLines.join("\n")}\n狀態：${proposals.map((proposal) => `${proposal.itemStatus} / ${proposal.status}`).join("、")}。\nDecision Owner 後續可確認此 Proposal。`;
  }

}

function isQuestion(text: string): boolean {
  const normalized = text.trim().replace(/^@[^\s]+\s*/, "");
  return /[?？]\s*$/.test(normalized) || /^(?:請問|想問|為什麼|為何|怎麼|如何|what|why|how|where|when|can|could|is|are)\b/i.test(normalized);
}

function isStructuredMarkdown(text: string): boolean {
  const normalized = text.trim().replace(/^@[^\s]+\s*/, "");
  return /^-?\s*\[(?:confirmed|provisional|open_decision|conflicted|cancelled)\]\s+/i.test(normalized);
}

function commandErrorReply(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/decision owner/i.test(message)) return "你不是此旅程的 Decision Owner，無法執行這個指令。";
  if (/not found/i.test(message)) return "找不到這個 Proposal，請確認 Proposal ID。";
  if (/must be confirmed through that Decision/i.test(message)) return "這個 Proposal 已加入 Decision，請使用 Decision 選擇指令。";
  if (/not pending/i.test(message)) return "這個 Proposal 已經處理過，無法再次變更。";
  return `指令無法執行：${message}`;
}
