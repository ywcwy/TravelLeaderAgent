import type { TravelService } from "./travel-service.ts";
import type { WebhookInbox, WebhookInboxEvent } from "./webhook-inbox.ts";

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
    const proposals = proposalIds.map((proposalId) => this.travel.getProposal(tripId, proposalId)).filter((proposal): proposal is NonNullable<typeof proposal> => proposal !== null);
    const candidates = proposals.map((proposal) => `${proposal.id}：${proposal.title}${proposal.startsAt ? `｜${proposal.startsAt}` : ""}${proposal.location ? `｜${proposal.location}` : ""}`).join("、");
    return `已收到 Proposal ${candidates}\n目前沒有同日期、同類型的 confirmed 行程。\n狀態：${proposals.map((proposal) => `${proposal.itemStatus} / ${proposal.status}`).join("、")}。\nDecision Owner 後續可確認此 Proposal。`;
  }

}
