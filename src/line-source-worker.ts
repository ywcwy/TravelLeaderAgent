import type { TravelService } from "./travel-service.ts";
import type { WebhookInbox, WebhookInboxEvent } from "./webhook-inbox.ts";
import { itineraryQueryHelp, parseItineraryMessage, parseProposalCommand, proposalCommandHelp, renderItineraryQuery } from "./itinerary-query.ts";

export type LineReplySender = (replyToken: string, text: string) => void | Promise<void>;

export class LineSourceWorker {
  private readonly inbox: WebhookInbox;
  private readonly travel: TravelService;
  private readonly reply: LineReplySender;
  private timer: ReturnType<typeof setInterval> | null = null;
  private active: Promise<"processed" | "failed" | "idle"> | null = null;
  private processing = false;
  constructor(inbox: WebhookInbox, travel: TravelService, reply: LineReplySender) { this.inbox = inbox; this.travel = travel; this.reply = reply; }

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
        const command = parseProposalCommand(event.text);
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
        if (parsed) {
          if (replyToken) {
            const targetTripId = parsed.type === "query" && parsed.query.tripId ? parsed.query.tripId : event.tripId;
            const text = parsed.type === "help" ? itineraryQueryHelp : renderItineraryQuery(this.travel.queryTrip(targetTripId, event.userId, parsed.query));
            await this.reply(replyToken, text);
          }
          this.inbox.complete(event.eventId, leaseToken);
          return "processed" as const;
        }
        const imported = this.importSource(event);
        if (replyToken) await this.reply(replyToken, this.contextualReply(event.tripId, imported.proposalIds));
        this.inbox.complete(event.eventId, leaseToken);
        return "processed" as const;
      } catch (error) {
        this.inbox.fail(event.eventId, leaseToken, error);
        return "failed" as const;
      }
    })();
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

function commandErrorReply(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/decision owner/i.test(message)) return "你不是此旅程的 Decision Owner，無法執行這個指令。";
  if (/not found/i.test(message)) return "找不到這個 Proposal，請確認 Proposal ID。";
  if (/must be confirmed through that Decision/i.test(message)) return "這個 Proposal 已加入 Decision，請使用 Decision 選擇指令。";
  if (/not pending/i.test(message)) return "這個 Proposal 已經處理過，無法再次變更。";
  return `指令無法執行：${message}`;
}
