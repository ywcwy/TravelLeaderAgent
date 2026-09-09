import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { TravelDatabase } from "../src/database.ts";
import { TravelService } from "../src/travel-service.ts";
import { LineWebhookHandler } from "../src/line-webhook-handler.ts";

test("rejects a LINE webhook with an invalid signature", () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const handler = new LineWebhookHandler(service, {
    channelSecret: "test-secret",
    officialAccountUserId: "U-bot",
  });

  const response = handler.handle({
    rawBody: JSON.stringify({ destination: "U-bot", events: [] }),
    signature: "not-valid",
  });

  assert.equal(response.status, 401);
  assert.equal(response.acceptedEvents.length, 0);
  db.close();
});

test("routes a mentioned group text event to its Active Trip", () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const group = service.createTravelGroup("system-admin", "C-line-group", "測試群組");
  const trip = service.createActiveTrip("system-admin", group.id, "測試旅程", "Asia/Taipei");
  const handler = new LineWebhookHandler(service, {
    channelSecret: "test-secret",
    officialAccountUserId: "U-bot",
    clock: () => "2026-09-09T00:00:00.000Z",
  });
  const rawBody = JSON.stringify({
    destination: "U-bot",
    events: [{
      type: "message",
      webhookEventId: "01JTESTEVENT0000000000000000",
      replyToken: "reply-token",
      source: { type: "group", groupId: "C-line-group", userId: "U-member" },
      message: {
        type: "text",
        id: "message-1",
        text: "@leaderAgent - [provisional] 住宿 | 2026-10-16 | Monterey",
        mention: { mentionees: [{ type: "user", userId: "U-bot" }] },
      },
    }],
  });
  const signature = createHmac("sha256", "test-secret").update(rawBody).digest("base64");

  const response = handler.handle({ rawBody, signature });

  assert.equal(response.status, 200);
  assert.deepEqual(response.acceptedEvents, [{
    eventId: "01JTESTEVENT0000000000000000",
    messageId: "message-1",
    groupId: "C-line-group",
    userId: "U-member",
    tripId: trip.id,
    text: "@leaderAgent - [provisional] 住宿 | 2026-10-16 | Monterey",
    receivedAt: "2026-09-09T00:00:00.000Z",
    rawBody,
    replyToken: "reply-token",
  }]);
  assert.deepEqual(response.replies, [{ replyToken: "reply-token", text: "已收到，等待 Decision Owner 確認。" }]);
  db.close();
});

test("ignores plain-text mentions without native LINE metadata", () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const group = service.createTravelGroup("system-admin", "C-line-group-plain", "測試群組");
  service.createActiveTrip("system-admin", group.id, "測試旅程", "Asia/Taipei");
  const handler = new LineWebhookHandler(service, { channelSecret: "test-secret", officialAccountUserId: "U-bot" });
  const rawBody = JSON.stringify({ events: [{ type: "message", source: { type: "group", groupId: "C-line-group-plain", userId: "U-member" }, message: { type: "text", id: "message-plain", text: "@leaderAgent hello" }, replyToken: "reply-token" }] });
  const signature = createHmac("sha256", "test-secret").update(rawBody).digest("base64");

  const response = handler.handle({ rawBody, signature });

  assert.equal(response.status, 200);
  assert.equal(response.acceptedEvents.length, 0);
  assert.equal(response.replies.length, 0);
  db.close();
});

test("revokes future Source access when a group member leaves", () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const group = service.createTravelGroup("system-admin", "C-line-group-leave", "測試群組");
  const trip = service.createActiveTrip("system-admin", group.id, "測試旅程", "Asia/Taipei");
  service.ensureGroupMember(trip.id, "U-member", "U-member");
  const handler = new LineWebhookHandler(service, { channelSecret: "test-secret", officialAccountUserId: "U-bot" });
  const rawBody = JSON.stringify({ events: [{ type: "memberLeft", webhookEventId: "01JLEAVE000000000000000000", source: { type: "group", groupId: "C-line-group-leave" }, left: { members: [{ userId: "U-member" }] }, replyToken: "reply-token" }] });
  const signature = createHmac("sha256", "test-secret").update(rawBody).digest("base64");

  const response = handler.handle({ rawBody, signature });

  assert.equal(response.status, 200);
  assert.equal(service.isActiveTripMember(trip.id, "U-member"), false);
  assert.deepEqual(response.replies, [{ replyToken: "reply-token", text: "已更新群組成員狀態。" }]);
  db.close();
});

test("does not re-enroll a revoked member on a later message", () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const group = service.createTravelGroup("system-admin", "C-line-group-revoked", "測試群組");
  const trip = service.createActiveTrip("system-admin", group.id, "測試旅程", "Asia/Taipei");
  service.ensureGroupMember(trip.id, "U-member", "U-member");
  service.revokeGroupMember(trip.id, "U-member");
  const handler = new LineWebhookHandler(service, { channelSecret: "test-secret", officialAccountUserId: "U-bot" });
  const rawBody = JSON.stringify({ events: [{ type: "message", webhookEventId: "01JREVOKED00000000000000000", replyToken: "reply-token", source: { type: "group", groupId: "C-line-group-revoked", userId: "U-member" }, message: { type: "text", id: "message-revoked", text: "@leaderAgent 新資料", mention: { mentionees: [{ type: "user", userId: "U-bot" }] } } }] });
  const signature = createHmac("sha256", "test-secret").update(rawBody).digest("base64");

  const response = handler.handle({ rawBody, signature });

  assert.equal(response.acceptedEvents.length, 0);
  assert.equal(response.replies[0].text, "你目前無法提交此旅程資料。");
  assert.equal(service.isActiveTripMember(trip.id, "U-member"), false);
  db.close();
});
