import type { AcceptedLineEvent, LineWebhookHandler, LineWebhookRequest, LineWebhookResponse } from "./line-webhook-handler.ts";
export interface WebhookInboxWriter { enqueue(event: AcceptedLineEvent): "enqueued" | "duplicate"; }
export class LineWebhookIngress {
  private readonly handler: LineWebhookHandler;
  private readonly inbox: WebhookInboxWriter;
  constructor(handler: LineWebhookHandler, inbox: WebhookInboxWriter) { this.handler = handler; this.inbox = inbox; }
  handle(request: LineWebhookRequest): LineWebhookResponse {
    const response = this.handler.handle(request);
    if (response.status !== 200) return response;
    try {
      for (const event of response.acceptedEvents) this.inbox.enqueue(event);
      return response.acceptedEvents.length > 0 ? { ...response, replies: [] } : response;
    }
    catch { return { status: 503, acceptedEvents: [], replies: [] }; }
  }
}
