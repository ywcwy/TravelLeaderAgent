import { createHmac, timingSafeEqual } from "node:crypto";
import type { TravelService } from "./travel-service.ts";

export interface LineWebhookRequest {
  rawBody: string;
  signature: string;
  receivedAt?: string;
}

export interface LineReplyIntent {
  replyToken: string;
  text: string;
}

export interface AcceptedLineEvent {
  eventId: string;
  messageId: string;
  groupId: string;
  userId: string;
  tripId: string;
  text: string;
  receivedAt: string;
  rawBody: string;
  replyToken: string;
}

export interface LineWebhookResponse {
  status: 200 | 400 | 401 | 503;
  acceptedEvents: AcceptedLineEvent[];
  replies: LineReplyIntent[];
}

export interface LineWebhookOptions {
  channelSecret: string;
  officialAccountUserId: string;
  clock?: () => string;
}

export class LineWebhookHandler {
  private readonly service: TravelService;
  private readonly options: LineWebhookOptions;

  constructor(service: TravelService, options: LineWebhookOptions) {
    this.service = service;
    this.options = options;
  }

  handle(request: LineWebhookRequest): LineWebhookResponse {
    if (!this.verifySignature(request.rawBody, request.signature)) {
      return { status: 401, acceptedEvents: [], replies: [] };
    }

    let payload: LineWebhookPayload;
    try {
      payload = JSON.parse(request.rawBody) as LineWebhookPayload;
    } catch {
      return { status: 400, acceptedEvents: [], replies: [] };
    }

    const acceptedEvents: AcceptedLineEvent[] = [];
    const replies: LineReplyIntent[] = [];
    for (const event of payload.events ?? []) {
      const result = this.processEvent(event, request.rawBody, request.receivedAt ?? this.now());
      if (result.accepted) acceptedEvents.push(result.accepted);
      if (result.reply) replies.push(result.reply);
    }
    return { status: 200, acceptedEvents, replies };
  }

  private processEvent(event: LineEvent, rawBody: string, receivedAt: string): { accepted?: AcceptedLineEvent; reply?: LineReplyIntent } {
    if (event.type === "memberLeft") {
      const groupId = event.source?.type === "group" ? event.source.groupId : undefined;
      if (groupId) {
        const trip = this.service.getActiveTripForLineGroup(groupId);
        for (const member of event.left?.members ?? []) {
          if (trip) this.service.revokeGroupMember(trip.id, member.userId);
        }
      }
      return event.replyToken ? { reply: { replyToken: event.replyToken, text: "已更新群組成員狀態。" } } : {};
    }

    if (event.type !== "message" || event.message?.type !== "text" || event.source?.type !== "group") return {};
    const groupId = event.source.groupId;
    if (!groupId) return {};
    const trip = this.service.getActiveTripForLineGroup(groupId);
    if (!trip) return this.policyReply(event, "此群組目前尚未設定 Active Trip。");
    if (!this.isMentioned(event.message)) return {};
    const userId = event.source.userId;
    if (!event.webhookEventId || !event.message.id || !userId) return {};

    if (!this.service.ensureGroupMember(trip.id, userId, userId)) {
      return this.policyReply(event, "你目前無法提交此旅程資料。");
    }
    const accepted: AcceptedLineEvent = {
      eventId: event.webhookEventId,
      messageId: event.message.id,
      groupId,
      userId,
      tripId: trip.id,
      text: event.message.text,
      receivedAt,
      rawBody,
      replyToken: event.replyToken ?? "",
    };
    return {
      accepted,
      ...(event.replyToken ? { reply: { replyToken: event.replyToken, text: "已收到，等待 Decision Owner 確認。" } } : {}),
    };
  }

  private policyReply(event: LineEvent, text: string): { reply?: LineReplyIntent } {
    return event.replyToken ? { reply: { replyToken: event.replyToken, text } } : {};
  }

  private isMentioned(message: LineTextMessage): boolean {
    return message.mention?.mentionees?.some((mention) => mention.type === "user" && mention.userId === this.options.officialAccountUserId) ?? false;
  }

  private verifySignature(rawBody: string, signature: string): boolean {
    const expected = createHmac("sha256", this.options.channelSecret).update(rawBody).digest("base64");
    const provided = Buffer.from(signature);
    const calculated = Buffer.from(expected);
    return provided.length === calculated.length && timingSafeEqual(provided, calculated);
  }

  private now(): string {
    return (this.options.clock ?? (() => new Date().toISOString()))();
  }
}

interface LineWebhookPayload { events?: LineEvent[]; }
interface LineEvent {
  type?: string;
  webhookEventId?: string;
  replyToken?: string;
  source?: { type?: string; groupId?: string; userId?: string };
  message?: LineTextMessage;
  left?: { members?: Array<{ userId: string }> };
}
interface LineTextMessage {
  type?: string;
  id: string;
  text: string;
  mention?: { mentionees?: Array<{ type?: string; userId?: string }> };
}
