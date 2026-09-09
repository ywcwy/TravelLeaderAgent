import type { TravelDatabase } from "./database.ts";
import type { AcceptedLineEvent } from "./line-webhook-handler.ts";

export type WebhookInboxStatus = "pending" | "processing" | "completed" | "failed";
export type WebhookInboxOutcome = "accepted" | "processed" | "retryable_failure" | "dead_letter";

export interface WebhookInboxEvent extends AcceptedLineEvent {
  status: WebhookInboxStatus;
  outcome: WebhookInboxOutcome;
  attempts: number;
  lastError: string | null;
  leaseUntil: string | null;
  completedAt: string | null;
}

export interface WebhookInboxOptions {
  clock?: () => string;
  leaseMs?: number;
  maxAttempts?: number;
}

export type InboxProcessor = (event: WebhookInboxEvent) => void | Promise<void>;

export class WebhookInbox {
  private readonly db: TravelDatabase;
  private readonly clock: () => string;
  private readonly leaseMs: number;
  private readonly maxAttempts: number;

  constructor(db: TravelDatabase, options: WebhookInboxOptions = {}) {
    this.db = db;
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.leaseMs = options.leaseMs ?? 60_000;
    this.maxAttempts = options.maxAttempts ?? 3;
  }

  enqueue(event: AcceptedLineEvent): "enqueued" | "duplicate" {
    const result = this.db.connection.prepare(`
      INSERT OR IGNORE INTO webhook_inbox_events
      (event_id, message_id, group_id, user_id, trip_id, text, received_at, raw_payload, reply_token, status, outcome, attempts, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'accepted', 0, ?)
    `).run(event.eventId, event.messageId, event.groupId, event.userId, event.tripId, event.text, event.receivedAt, event.rawBody, event.replyToken || null, this.clock());
    if (result.changes === 1) return "enqueued";
    this.db.connection.prepare(`UPDATE webhook_inbox_events SET duplicate_count = duplicate_count + 1 WHERE event_id = ?`).run(event.eventId);
    return "duplicate";
  }

  get(eventId: string): WebhookInboxEvent | null {
    const row = this.db.connection.prepare(`SELECT * FROM webhook_inbox_events WHERE event_id = ?`).get(eventId) as WebhookInboxRow | undefined;
    return row ? toInboxEvent(row) : null;
  }

  claimNext(): WebhookInboxEvent | null {
    const nowValue = this.clock();
    const leaseUntil = new Date(Date.parse(nowValue) + this.leaseMs).toISOString();
    this.db.connection.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.connection.prepare(`
        SELECT * FROM webhook_inbox_events
        WHERE (status = 'pending' OR (status = 'failed' AND attempts < ?)
          OR (status = 'processing' AND lease_until IS NOT NULL AND lease_until <= ?))
        ORDER BY created_at, event_id
        LIMIT 1
      `).get(this.maxAttempts, nowValue) as WebhookInboxRow | undefined;
      if (!row) {
        this.db.connection.exec("COMMIT");
        return null;
      }
      if (row.status === "processing" && row.attempts >= this.maxAttempts) {
        this.db.connection.prepare(`UPDATE webhook_inbox_events SET status = 'failed', outcome = 'dead_letter', last_error = COALESCE(last_error, 'Processing lease expired after maximum attempts'), lease_until = NULL, completed_at = ? WHERE event_id = ?`).run(nowValue, row.event_id);
        this.db.connection.exec("COMMIT");
        return null;
      }
      this.db.connection.prepare(`UPDATE webhook_inbox_events SET status = 'processing', attempts = attempts + 1, lease_until = ? WHERE event_id = ?`).run(leaseUntil, row.event_id);
      this.db.connection.exec("COMMIT");
      return this.get(row.event_id);
    } catch (error) {
      this.db.connection.exec("ROLLBACK");
      throw error;
    }
  }

  complete(eventId: string): void {
    this.db.connection.prepare(`UPDATE webhook_inbox_events SET status = 'completed', outcome = 'processed', lease_until = NULL, reply_token = NULL, completed_at = ? WHERE event_id = ? AND status = 'processing'`).run(this.clock(), eventId);
  }

  fail(eventId: string, error: unknown): WebhookInboxStatus {
    const row = this.db.connection.prepare(`SELECT attempts FROM webhook_inbox_events WHERE event_id = ? AND status = 'processing'`).get(eventId) as { attempts: number } | undefined;
    if (!row) return "failed";
    const message = error instanceof Error ? error.message : String(error);
    const deadLetter = row.attempts >= this.maxAttempts;
    this.db.connection.prepare(`UPDATE webhook_inbox_events SET status = 'failed', outcome = ?, last_error = ?, lease_until = NULL, completed_at = CASE WHEN ? THEN ? ELSE NULL END WHERE event_id = ?`)
      .run(deadLetter ? "dead_letter" : "retryable_failure", message, deadLetter ? 1 : 0, deadLetter ? this.clock() : null, eventId);
    return "failed";
  }

  async processNext(processor: InboxProcessor): Promise<"processed" | "failed" | "idle"> {
    const event = this.claimNext();
    if (!event) return "idle";
    try {
      await processor(event);
      this.complete(event.eventId);
      return "processed";
    } catch (error) {
      this.fail(event.eventId, error);
      return "failed";
    }
  }

  purgeRawPayloads(retentionMs = 7 * 24 * 60 * 60 * 1000): number {
    const cutoff = new Date(Date.parse(this.clock()) - retentionMs).toISOString();
    return Number(this.db.connection.prepare(`UPDATE webhook_inbox_events SET raw_payload = NULL WHERE raw_payload IS NOT NULL AND received_at <= ? AND status != 'processing'`).run(cutoff).changes);
  }
}

interface WebhookInboxRow {
  event_id: string; message_id: string; group_id: string; user_id: string; trip_id: string; text: string;
  received_at: string; raw_payload: string | null; reply_token: string | null; status: WebhookInboxStatus;
  outcome: WebhookInboxOutcome; attempts: number; last_error: string | null; lease_until: string | null;
  completed_at: string | null;
}

function toInboxEvent(row: WebhookInboxRow): WebhookInboxEvent {
  return {
    eventId: row.event_id, messageId: row.message_id, groupId: row.group_id, userId: row.user_id,
    tripId: row.trip_id, text: row.text, receivedAt: row.received_at, rawBody: row.raw_payload ?? "",
    replyToken: row.reply_token ?? "", status: row.status, outcome: row.outcome, attempts: row.attempts,
    lastError: row.last_error, leaseUntil: row.lease_until, completedAt: row.completed_at,
  };
}
