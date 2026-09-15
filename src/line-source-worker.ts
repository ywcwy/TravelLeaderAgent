import type { TravelService } from "./travel-service.ts";
import type { WebhookInbox, WebhookInboxEvent } from "./webhook-inbox.ts";
import { itineraryQueryHelp, parseItineraryMessage, renderItineraryQuery } from "./itinerary-query.ts";

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
        if (parsed) {
          if (replyToken) {
            const text = parsed.type === "help" ? itineraryQueryHelp : renderItineraryQuery(this.travel.queryActiveTrip(event.tripId, event.userId, parsed.query));
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
