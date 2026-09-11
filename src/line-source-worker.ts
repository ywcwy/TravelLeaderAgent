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
      console.error("LINE source worker failed to claim an Inbox event", error);
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
        this.importSource(event);
        if (replyToken) await this.reply(replyToken, "已收到，等待 Decision Owner 確認。");
        this.inbox.complete(event.eventId, leaseToken);
        return "processed" as const;
      } catch (error) {
        this.inbox.fail(event.eventId, leaseToken, error);
        return "failed" as const;
      }
    })();
  }

  private importSource(event: WebhookInboxEvent): void {
    this.travel.importMarkdown(event.tripId, event.text, {
      idempotencyKey: event.eventId,
      sourceTime: event.receivedAt,
      type: "line_text",
      provenance: { provider: "line", messageId: event.messageId, groupId: event.groupId, userId: event.userId },
    });
  }

}
