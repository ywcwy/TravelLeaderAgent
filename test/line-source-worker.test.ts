import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { TravelDatabase } from "../src/database.ts";
import { LineSourceWorker } from "../src/line-source-worker.ts";
import { LineWebhookHandler } from "../src/line-webhook-handler.ts";
import { LineWebhookIngress } from "../src/line-webhook-ingress.ts";
import { TravelService } from "../src/travel-service.ts";
import { WebhookInbox } from "../src/webhook-inbox.ts";

test("ingests a mentioned LINE group message into one Source with provenance", async () => {
  const db = new TravelDatabase();
  const travel = new TravelService(db, "system-admin");
  const group = travel.createTravelGroup("system-admin", "C-end-to-end", "E2E 群組");
  const trip = travel.createActiveTrip("system-admin", group.id, "E2E 旅程", "Asia/Taipei");
  const handler = new LineWebhookHandler(travel, { channelSecret: "secret", officialAccountUserId: "U-bot", clock: () => "2026-09-11T00:00:00.000Z" });
  const inbox = new WebhookInbox(db, { clock: () => "2026-09-11T00:00:01.000Z", retryBackoffMs: 0 });
  const replies: Array<{ token: string; text: string }> = [];
  const worker = new LineSourceWorker(inbox, travel, async (token, text) => { replies.push({ token, text }); });
  const rawBody = JSON.stringify({ events: [{ type: "message", webhookEventId: "01JLINEE2E000000000000000000", replyToken: "reply-e2e", source: { type: "group", groupId: "C-end-to-end", userId: "U-member" }, message: { type: "text", id: "message-e2e", text: "@leaderAgent - [provisional] 住宿 | 2026-10-16 | 台北", mention: { mentionees: [{ type: "user", userId: "U-bot" }] } } }] });
  const response = new LineWebhookIngress(handler, inbox).handle({ rawBody, signature: createHmac("sha256", "secret").update(rawBody).digest("base64") });
  assert.equal(response.status, 200);
  assert.deepEqual(response.replies, []);
  assert.equal(await worker.processNext(), "processed");
  assert.equal(await worker.processNext(), "idle");

  const storedInbox = inbox.get("01JLINEE2E000000000000000000");
  assert.equal(storedInbox?.status, "completed");
  assert.equal(storedInbox?.replyToken, "");
  const review = travel.reviewTrip(trip.id);
  assert.equal(review.provisional.length, 1);
  const source = travel.getSource(review.provisional[0].sourceId);
  assert.deepEqual(source, { id: source?.id, tripId: trip.id, type: "line_text", idempotencyKey: "01JLINEE2E000000000000000000", content: "@leaderAgent - [provisional] 住宿 | 2026-10-16 | 台北", sourceTime: "2026-09-11T00:00:00.000Z", provenance: { provider: "line", messageId: "message-e2e", groupId: "C-end-to-end", userId: "U-member" } });
  assert.deepEqual(replies, [{ token: "reply-e2e", text: "已收到，等待 Decision Owner 確認。" }]);
  assert.equal(travel.isActiveTripMember(trip.id, "U-member"), true);
  db.close();
});

test("keeps non-Markdown LINE text as a Source with a review issue", async () => {
  const db = new TravelDatabase();
  const travel = new TravelService(db, "system-admin");
  const group = travel.createTravelGroup("system-admin", "C-unparsed", "未解析群組");
  const trip = travel.createActiveTrip("system-admin", group.id, "未解析旅程", "Asia/Taipei");
  const inbox = new WebhookInbox(db, { clock: () => "2026-09-11T00:00:01.000Z", retryBackoffMs: 0 });
  inbox.enqueue({ eventId: "01JLINEUNPARSED000000000000", messageId: "message-unparsed", groupId: "C-unparsed", userId: "U-member", tripId: trip.id, text: "大家週五晚上吃飯", receivedAt: "2026-09-11T00:00:00.000Z", rawBody: "raw", replyToken: "" });
  const worker = new LineSourceWorker(inbox, travel, () => undefined);
  assert.equal(await worker.processNext(), "processed");
  assert.equal(travel.reviewTrip(trip.id).issues.some((issue) => issue.code === "source_unparsed"), true);
  db.close();
});
