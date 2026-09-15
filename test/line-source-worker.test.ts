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
  const proposal = review.provisional[0];
  assert.equal(replies.length, 1);
  assert.equal(replies[0]?.token, "reply-e2e");
  assert.equal(replies[0]?.text, `已收到 Proposal ${proposal.id}：住宿｜2026-10-16｜台北\n目前沒有同日期、同類型的 confirmed 行程。\n狀態：provisional / pending。\nDecision Owner 後續可確認此 Proposal。`);
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

test("parses LINE free-form lodging and multi-leg route statements with shared Sources", async () => {
  const db = new TravelDatabase();
  const travel = new TravelService(db, "system-admin");
  const group = travel.createTravelGroup("system-admin", "C-freeform", "自由格式群組");
  const trip = travel.createActiveTrip("system-admin", group.id, "自由格式旅程", "Asia/Taipei");
  const inbox = new WebhookInbox(db, { clock: () => "2026-09-11T00:00:01.000Z", retryBackoffMs: 0 });
  inbox.enqueue({ eventId: "01JLINEFREEFORM000000000000", messageId: "message-freeform-lodging", groupId: group.lineGroupId, userId: "U-member", tripId: trip.id, text: "2026-10-01 入住 Holiday Inn Express", receivedAt: "2026-09-11T00:00:00.000Z", rawBody: "raw", replyToken: "reply-freeform-lodging" });
  inbox.enqueue({ eventId: "01JLINEFREEFORM000000000001", messageId: "message-freeform-route", groupId: group.lineGroupId, userId: "U-member", tripId: trip.id, text: "2026-10-01 Las Vegas → St. George → Kanab → Page", receivedAt: "2026-09-11T00:00:00.000Z", rawBody: "raw", replyToken: "reply-freeform-route" });
  const replies: string[] = [];
  const worker = new LineSourceWorker(inbox, travel, async (_token, text) => { replies.push(text); });

  assert.equal(await worker.processNext(), "processed");
  assert.equal(await worker.processNext(), "processed");
  const review = travel.reviewTrip(trip.id);
  assert.equal(review.provisional.length, 4);
  const lodging = review.provisional.find((proposal) => proposal.title === "住宿：Holiday Inn Express");
  assert.equal(lodging?.shape, "point");
  assert.deepEqual(lodging?.kinds, ["lodging"]);
  assert.equal(lodging?.location, "Holiday Inn Express");
  assert.deepEqual(review.provisional.filter((proposal) => proposal.shape === "route").map((proposal) => [proposal.origin, proposal.destination]).sort((left, right) => `${left[0]}${left[1]}`.localeCompare(`${right[0]}${right[1]}`)), [
    ["Kanab", "Page"], ["Las Vegas", "St. George"], ["St. George", "Kanab"],
  ]);
  assert.equal(new Set(review.provisional.map((proposal) => proposal.sourceId)).size, 2);
  assert.equal(replies.length, 2);
  db.close();
});

test("keeps an incomplete or date-less free-form route traceable", async () => {
  const db = new TravelDatabase();
  const travel = new TravelService(db, "system-admin");
  const group = travel.createTravelGroup("system-admin", "C-freeform-review", "自由格式 review 群組");
  const trip = travel.createActiveTrip("system-admin", group.id, "自由格式 review 旅程", "Asia/Taipei");
  const inbox = new WebhookInbox(db, { clock: () => "2026-09-11T00:00:01.000Z", retryBackoffMs: 0 });
  inbox.enqueue({ eventId: "01JLINEFREEFORMREVIEW000000", messageId: "message-freeform-review-1", groupId: group.lineGroupId, userId: "U-member", tripId: trip.id, text: "從 Las Vegas 前往", receivedAt: "2026-09-11T00:00:00.000Z", rawBody: "raw", replyToken: "reply-freeform-review-1" });
  inbox.enqueue({ eventId: "01JLINEFREEFORMREVIEW000001", messageId: "message-freeform-review-2", groupId: group.lineGroupId, userId: "U-member", tripId: trip.id, text: "Las Vegas → Page", receivedAt: "2026-09-11T00:00:00.000Z", rawBody: "raw", replyToken: "reply-freeform-review-2" });
  const replies: string[] = [];
  const worker = new LineSourceWorker(inbox, travel, async (_token, text) => { replies.push(text); });

  assert.equal(await worker.processNext(), "processed");
  assert.equal(await worker.processNext(), "processed");
  const review = travel.reviewTrip(trip.id);
  assert.equal(review.provisional.length, 1);
  assert.equal(review.provisional[0]?.startsAt, undefined);
  assert.equal(review.issues.some((issue) => issue.code === "missing_route_endpoint"), true);
  assert.equal(review.issues.some((issue) => issue.code === "source_unparsed"), false);
  assert.equal(review.issues.some((issue) => issue.code === "missing_start_time" && issue.proposalIds.includes(review.provisional[0]?.id ?? "")), true);
  assert.equal(replies.length, 2);
  db.close();
});

test("infers multiple kinds from one LINE free-form statement", async () => {
  const db = new TravelDatabase();
  const travel = new TravelService(db, "system-admin");
  const group = travel.createTravelGroup("system-admin", "C-freeform-kinds", "自由格式 kinds 群組");
  const trip = travel.createActiveTrip("system-admin", group.id, "自由格式 kinds 旅程", "Asia/Taipei");
  const inbox = new WebhookInbox(db, { clock: () => "2026-09-11T00:00:01.000Z", retryBackoffMs: 0 });
  inbox.enqueue({ eventId: "01JLINEFREEFORMKINDS00000", messageId: "message-freeform-kinds", groupId: group.lineGroupId, userId: "U-member", tripId: trip.id, text: "2026-10-01 入住夜班火車，提供住宿與晚餐", receivedAt: "2026-09-11T00:00:00.000Z", rawBody: "raw", replyToken: "reply-freeform-kinds" });
  const worker = new LineSourceWorker(inbox, travel, () => undefined);

  assert.equal(await worker.processNext(), "processed");
  const proposal = travel.reviewTrip(trip.id).provisional[0];
  assert.deepEqual(proposal?.kinds, ["lodging", "meal", "transport"]);
  assert.equal(proposal?.kind, "lodging");
  db.close();
});

test("supports English dining and rental-car free-form statements", async () => {
  const db = new TravelDatabase();
  const travel = new TravelService(db, "system-admin");
  const group = travel.createTravelGroup("system-admin", "C-freeform-english", "英文自由格式群組");
  const trip = travel.createActiveTrip("system-admin", group.id, "英文自由格式旅程", "Asia/Taipei");
  const inbox = new WebhookInbox(db, { clock: () => "2026-09-11T00:00:01.000Z", retryBackoffMs: 0 });
  inbox.enqueue({ eventId: "01JLINEFREEFORMENGLISH000", messageId: "message-freeform-dining", groupId: group.lineGroupId, userId: "U-member", tripId: trip.id, text: "2026-10-01 dining at BirdHouse", receivedAt: "2026-09-11T00:00:00.000Z", rawBody: "raw", replyToken: "reply-freeform-dining" });
  inbox.enqueue({ eventId: "01JLINEFREEFORMENGLISH001", messageId: "message-freeform-rental", groupId: group.lineGroupId, userId: "U-member", tripId: trip.id, text: "2026-10-01 rental car pickup at LAS", receivedAt: "2026-09-11T00:00:00.000Z", rawBody: "raw", replyToken: "reply-freeform-rental" });
  const worker = new LineSourceWorker(inbox, travel, () => undefined);

  assert.equal(await worker.processNext(), "processed");
  assert.equal(await worker.processNext(), "processed");
  const proposals = travel.reviewTrip(trip.id).provisional;
  assert.equal(proposals.length, 2);
  assert.deepEqual(proposals.find((proposal) => proposal.location === "BirdHouse")?.kinds, ["meal"]);
  assert.deepEqual(proposals.find((proposal) => proposal.location === "LAS")?.kinds, ["rental_car"]);
  db.close();
});

test("produces equivalent structured records for equivalent Markdown and LINE inputs", async () => {
  const db = new TravelDatabase();
  const travel = new TravelService(db, "system-admin");
  const markdownGroup = travel.createTravelGroup("system-admin", "C-equivalent-markdown", "Markdown 等價群組");
  const markdownTrip = travel.createActiveTrip("system-admin", markdownGroup.id, "Markdown 等價旅程", "Asia/Taipei");
  const markdown = travel.importMarkdown(markdownTrip.id, [
    "- [provisional] Page 住宿 | 2026-10-01 | Page",
    "- [provisional] Las Vegas → Page | 2026-10-01 | | | shape=route | origin=Las Vegas | destination=Page",
  ].join("\n"), { idempotencyKey: "equivalent:markdown" });
  const markdownReview = travel.reviewTrip(markdownTrip.id).provisional;

  const lineGroup = travel.createTravelGroup("system-admin", "C-equivalent-line", "LINE 等價群組");
  const lineTrip = travel.createActiveTrip("system-admin", lineGroup.id, "LINE 等價旅程", "Asia/Taipei");
  const inbox = new WebhookInbox(db, { clock: () => "2026-09-11T00:00:01.000Z", retryBackoffMs: 0 });
  inbox.enqueue({ eventId: "01JLINEEQUIVALENT0000000000", messageId: "message-equivalent", groupId: lineGroup.lineGroupId, userId: "U-member", tripId: lineTrip.id, text: "2026-10-01 staying at Page\n2026-10-01 Las Vegas → Page", receivedAt: "2026-09-11T00:00:00.000Z", rawBody: "raw", replyToken: "" });
  const worker = new LineSourceWorker(inbox, travel, () => undefined);
  assert.equal(await worker.processNext(), "processed");
  const lineReview = travel.reviewTrip(lineTrip.id).provisional;

  const comparable = (proposal: (typeof markdownReview)[number]) => ({
    kind: proposal.kind, kinds: proposal.kinds, shape: proposal.shape,
    startsAt: proposal.startsAt, location: proposal.location, origin: proposal.origin, destination: proposal.destination,
  });
  assert.deepEqual(lineReview.map(comparable).sort((left, right) => `${left.shape}${left.location ?? left.origin}`.localeCompare(`${right.shape}${right.location ?? right.origin}`)), markdownReview.map(comparable).sort((left, right) => `${left.shape}${left.location ?? left.origin}`.localeCompare(`${right.shape}${right.location ?? right.origin}`)));
  assert.equal(lineReview.find((proposal) => proposal.shape === "route")?.shapeSource, "inferred");
  assert.equal(markdownReview.find((proposal) => proposal.shape === "route")?.shapeSource, "explicit");
  db.close();
});

test("does not turn a LINE question into a Proposal and acknowledges its Source", async () => {
  const db = new TravelDatabase();
  const travel = new TravelService(db, "system-admin");
  const group = travel.createTravelGroup("system-admin", "C-freeform-question", "自由格式問題群組");
  const trip = travel.createActiveTrip("system-admin", group.id, "自由格式問題旅程", "Asia/Taipei");
  const inbox = new WebhookInbox(db, { clock: () => "2026-09-11T00:00:01.000Z", retryBackoffMs: 0 });
  inbox.enqueue({ eventId: "01JLINEFREEFORMQUESTION000", messageId: "message-freeform-question", groupId: group.lineGroupId, userId: "U-member", tripId: trip.id, text: "推薦 Page 的住宿？", receivedAt: "2026-09-11T00:00:00.000Z", rawBody: "raw", replyToken: "reply-freeform-question" });
  const replies: string[] = [];
  const worker = new LineSourceWorker(inbox, travel, async (_token, text) => { replies.push(text); });

  assert.equal(await worker.processNext(), "processed");
  assert.equal(travel.reviewTrip(trip.id).provisional.length, 0);
  assert.equal(travel.reviewTrip(trip.id).issues.some((issue) => issue.code === "source_unparsed"), true);
  assert.deepEqual(replies, ["已收到內容，已保存原始 Source；目前無法建立 Proposal，請補充日期、地點或路線。"]);
  db.close();
});

test("includes same-date confirmed and pending itinerary context in the reply", async () => {
  const db = new TravelDatabase();
  const travel = new TravelService(db, "system-admin");
  const group = travel.createTravelGroup("system-admin", "C-context", "Context 群組");
  const trip = travel.createActiveTrip("system-admin", group.id, "Context 旅程", "Asia/Taipei");
  travel.addMember("system-admin", trip.id, "U-owner", "Owner", "owner");
  const confirmedSource = travel.importMarkdown(trip.id, "- [provisional] 已確認住宿 | 2026-10-16T15:00:00+08:00 | 台北", { idempotencyKey: "context:confirmed" });
  travel.confirmProposal(trip.id, "U-owner", confirmedSource.proposalIds[0]);
  const pending = travel.importMarkdown(trip.id, "- [provisional] 另一住宿 | 2026-10-16T18:00:00+08:00 | 新北", { idempotencyKey: "context:pending" });
  const inbox = new WebhookInbox(db, { clock: () => "2026-09-11T00:00:01.000Z", retryBackoffMs: 0 });
  inbox.enqueue({ eventId: "01JLINECONTEXT00000000000000", messageId: "message-context", groupId: group.lineGroupId, userId: "U-member", tripId: trip.id, text: "- [provisional] 新住宿 | 2026-10-16T20:00:00+08:00 | 桃園", receivedAt: "2026-09-11T00:00:00.000Z", rawBody: "raw", replyToken: "reply-context" });
  const replies: string[] = [];
  const worker = new LineSourceWorker(inbox, travel, async (_token, text) => { replies.push(text); });

  assert.equal(await worker.processNext(), "processed");
  assert.equal(replies.length, 1);
  assert.match(replies[0] ?? "", /目前已有 confirmed 行程：已確認住宿｜2026-10-16T15:00:00\+08:00｜台北/);
  assert.match(replies[0] ?? "", /目前未偵測到時間衝突。/);
  assert.match(replies[0] ?? "", new RegExp(`同日期、同類型的 pending Proposal：${pending.proposalIds[0]}`));
  db.close();
});

test("does not send a consumed reply token again after worker failure", async () => {
  const db = new TravelDatabase();
  const travel = new TravelService(db, "system-admin");
  const group = travel.createTravelGroup("system-admin", "C-retry", "Retry 群組");
  const trip = travel.createActiveTrip("system-admin", group.id, "Retry 旅程", "Asia/Taipei");
  const inbox = new WebhookInbox(db, { clock: () => "2026-09-11T00:00:01.000Z", leaseMs: 0, retryBackoffMs: 0 });
  inbox.enqueue({ eventId: "01JLINERETRY000000000000000", messageId: "message-retry", groupId: "C-retry", userId: "U-member", tripId: trip.id, text: "- [provisional] 住宿 | 2026-10-16 | 台北", receivedAt: "2026-09-11T00:00:00.000Z", rawBody: "raw", replyToken: "reply-retry" });
  let attempts = 0;
  const replies: string[] = [];
  const worker = new LineSourceWorker(inbox, travel, async (token) => { replies.push(token); attempts += 1; if (attempts === 1) throw new Error("reply failed"); });
  assert.equal(await worker.processNext(), "failed");
  assert.equal(travel.reviewTrip(trip.id).provisional.length, 1);
  assert.equal(await worker.processNext(), "processed");
  assert.deepEqual(replies, ["reply-retry"]);
  assert.equal(travel.reviewTrip(trip.id).provisional.length, 1);
  db.close();
});

test("redelivery of a contextual event does not duplicate its Source or Proposal", async () => {
  const db = new TravelDatabase();
  const travel = new TravelService(db, "system-admin");
  const group = travel.createTravelGroup("system-admin", "C-redelivery-context", "Redelivery context 群組");
  const trip = travel.createActiveTrip("system-admin", group.id, "Redelivery context 旅程", "Asia/Taipei");
  const inbox = new WebhookInbox(db, { clock: () => "2026-09-11T00:00:01.000Z", retryBackoffMs: 0 });
  const event = { eventId: "01JLINEREDeliveryContext00000", messageId: "message-redelivery-context", groupId: group.lineGroupId, userId: "U-member", tripId: trip.id, text: "- [provisional] 住宿 | 2026-10-16 | 台北", receivedAt: "2026-09-11T00:00:00.000Z", rawBody: "raw", replyToken: "reply-redelivery-context" };
  assert.equal(inbox.enqueue(event), "enqueued");
  const worker = new LineSourceWorker(inbox, travel, async () => undefined);
  assert.equal(await worker.processNext(), "processed");
  assert.equal(inbox.enqueue(event), "duplicate");
  assert.equal(await worker.processNext(), "idle");
  assert.equal(inbox.get(event.eventId)?.duplicateCount, 1);
  assert.equal(travel.reviewTrip(trip.id).provisional.length, 1);
  db.close();
});

test("polls the Inbox one event at a time and stops cleanly", async () => {
  const db = new TravelDatabase();
  const travel = new TravelService(db, "system-admin");
  const group = travel.createTravelGroup("system-admin", "C-poll", "Polling 群組");
  const trip = travel.createActiveTrip("system-admin", group.id, "Polling 旅程", "Asia/Taipei");
  const inbox = new WebhookInbox(db, { clock: () => "2026-09-11T00:00:01.000Z", retryBackoffMs: 0 });
  inbox.enqueue({ eventId: "01JLINEPOLL0000000000000000", messageId: "message-poll", groupId: "C-poll", userId: "U-member", tripId: trip.id, text: "- [provisional] 住宿 | 2026-10-16 | 台北", receivedAt: "2026-09-11T00:00:00.000Z", rawBody: "raw", replyToken: "reply-poll" });
  const replies: string[] = [];
  const worker = new LineSourceWorker(inbox, travel, async (token) => { replies.push(token); await new Promise((resolve) => setTimeout(resolve, 2)); });
  worker.start(1);
  for (let attempt = 0; attempt < 100 && inbox.get("01JLINEPOLL0000000000000000")?.status !== "completed"; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 2));
  await worker.stop();
  assert.equal(inbox.get("01JLINEPOLL0000000000000000")?.status, "completed");
  assert.deepEqual(replies, ["reply-poll"]);
  db.close();
});

test("guards concurrent processNext calls to one in-flight event", async () => {
  const db = new TravelDatabase();
  const travel = new TravelService(db, "system-admin");
  const group = travel.createTravelGroup("system-admin", "C-concurrent", "Concurrent 群組");
  const trip = travel.createActiveTrip("system-admin", group.id, "Concurrent 旅程", "Asia/Taipei");
  const inbox = new WebhookInbox(db, { clock: () => "2026-09-11T00:00:01.000Z", retryBackoffMs: 0 });
  const first = { eventId: "01JLINECONCURRENT000000000", messageId: "message-concurrent-1", groupId: group.lineGroupId, userId: "U-member", tripId: trip.id, text: "- [provisional] 第一筆 | 2026-10-16 | 台北", receivedAt: "2026-09-11T00:00:00.000Z", rawBody: "raw", replyToken: "reply-1" };
  const second = { ...first, eventId: "01JLINECONCURRENT000000001", messageId: "message-concurrent-2", text: "- [provisional] 第二筆 | 2026-10-17 | 台北", replyToken: "reply-2" };
  inbox.enqueue(first);
  inbox.enqueue(second);
  let release!: () => void;
  let replyCalls = 0;
  const worker = new LineSourceWorker(inbox, travel, async () => { replyCalls += 1; if (replyCalls === 1) await new Promise<void>((resolve) => { release = resolve; }); });
  const firstRun = worker.processNext();
  const secondRun = worker.processNext();
  assert.equal(inbox.get(first.eventId)?.status, "processing");
  assert.equal(inbox.get(second.eventId)?.status, "pending");
  for (let attempt = 0; attempt < 100 && !release; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(inbox.get(first.eventId)?.status, "processing");
  assert.ok(release);
  release();
  assert.equal(await firstRun, "processed");
  assert.equal(await secondRun, "processed");
  assert.equal(inbox.get(second.eventId)?.status, "pending");
  assert.equal(await worker.processNext(), "processed");
  db.close();
});
