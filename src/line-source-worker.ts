import type { TravelService } from "./travel-service.ts";
import type { WebhookInbox, WebhookInboxEvent } from "./webhook-inbox.ts";

export type LineReplySender = (replyToken: string, text: string) => void | Promise<void>;

export class LineSourceWorker {
  private readonly inbox: WebhookInbox;
  private readonly travel: TravelService;
  private readonly reply: LineReplySender;
  constructor(inbox: WebhookInbox, travel: TravelService, reply: LineReplySender) { this.inbox = inbox; this.travel = travel; this.reply = reply; }

  processNext(): Promise<"processed" | "failed" | "idle"> {
    return this.inbox.processNext(async (event) => {
      this.importSource(event);
      if (event.replyToken) await this.reply(event.replyToken, "已收到，等待 Decision Owner 確認。");
    });
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
