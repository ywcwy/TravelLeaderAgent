import assert from "node:assert/strict";
import test from "node:test";
import { TravelDatabase } from "../src/database.ts";
import type { AcceptedLineEvent } from "../src/line-webhook-handler.ts";
import { WebhookInbox } from "../src/webhook-inbox.ts";

const event: AcceptedLineEvent = {
  eventId: "01JINBOX000000000000000000",
  messageId: "message-1",
  groupId: "C-group",
  userId: "U-user",
  tripId: "trip-1",
  text: "@leaderAgent - [provisional] 住宿 | 2026-10-16 | Monterey",
  receivedAt: "2026-09-09T00:00:00.000Z",
  rawBody: "{\"events\":[]}",
  replyToken: "reply-token",
};

test("persists an accepted event once and identifies duplicate delivery", () => {
  const db = new TravelDatabase();
  const inbox = new WebhookInbox(db, { clock: () => "2026-09-09T00:00:01.000Z" });

  assert.equal(inbox.enqueue(event), "enqueued");
  assert.equal(inbox.enqueue(event), "duplicate");
  assert.deepEqual(inbox.get(event.eventId), {
    ...event,
    status: "pending",
    outcome: "accepted",
    attempts: 0,
    lastError: null,
    leaseUntil: null,
    completedAt: null,
  });
  db.close();
});

test("retries failed processing three times before dead-lettering", async () => {
  const db = new TravelDatabase();
  const inbox = new WebhookInbox(db, { clock: () => "2026-09-09T00:00:01.000Z", leaseMs: 1 });
  inbox.enqueue(event);

  await inbox.processNext(() => { throw new Error("temporary failure"); });
  await inbox.processNext(() => { throw new Error("temporary failure"); });
  await inbox.processNext(() => { throw new Error("permanent failure"); });

  const stored = inbox.get(event.eventId);
  assert.equal(stored?.status, "failed");
  assert.equal(stored?.outcome, "dead_letter");
  assert.equal(stored?.attempts, 3);
  assert.equal(stored?.lastError, "permanent failure");
  assert.equal(await inbox.processNext(() => undefined), "idle");
  db.close();
});

test("reclaims a processing event after its lease expires", () => {
  let currentTime = "2026-09-09T00:00:01.000Z";
  const db = new TravelDatabase();
  const inbox = new WebhookInbox(db, { clock: () => currentTime, leaseMs: 1000 });
  inbox.enqueue(event);

  const firstClaim = inbox.claimNext();
  assert.equal(firstClaim?.attempts, 1);
  assert.equal(inbox.claimNext(), null);
  currentTime = "2026-09-09T00:00:02.001Z";
  const recovered = inbox.claimNext();

  assert.equal(recovered?.eventId, event.eventId);
  assert.equal(recovered?.attempts, 2);
  db.close();
});

test("dead-letters an expired third-attempt lease instead of retrying a fourth time", () => {
  let currentTime = "2026-09-09T00:00:01.000Z";
  const db = new TravelDatabase();
  const inbox = new WebhookInbox(db, { clock: () => currentTime, leaseMs: 1000 });
  inbox.enqueue(event);
  assert.ok(inbox.claimNext());
  inbox.fail(event.eventId, "failure 1");
  assert.ok(inbox.claimNext());
  inbox.fail(event.eventId, "failure 2");
  assert.ok(inbox.claimNext());
  currentTime = "2026-09-09T00:00:02.001Z";

  assert.equal(inbox.claimNext(), null);
  assert.equal(inbox.get(event.eventId)?.outcome, "dead_letter");
  assert.equal(inbox.get(event.eventId)?.attempts, 3);
  db.close();
});

test("completing an event removes its reply token and purges old raw payload", async () => {
  const db = new TravelDatabase();
  const inbox = new WebhookInbox(db, { clock: () => "2026-09-16T00:00:00.000Z" });
  inbox.enqueue({ ...event, receivedAt: "2026-09-08T00:00:00.000Z" });
  assert.equal(await inbox.processNext(() => undefined), "processed");

  const stored = inbox.get(event.eventId);
  assert.equal(stored?.status, "completed");
  assert.equal(stored?.replyToken, "");
  assert.equal(inbox.purgeRawPayloads(), 1);
  assert.equal(inbox.get(event.eventId)?.rawBody, "");
  db.close();
});
