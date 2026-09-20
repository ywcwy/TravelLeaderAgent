import assert from "node:assert/strict";
import test from "node:test";
import { FakeLlmAdapter, guardExtractionDraftPayload, renderExtractionDraft, validateExtractionDraftPayload } from "../src/extraction-draft.ts";
import type { ExtractionDraftPayload } from "../src/domain.ts";
import { TravelDatabase } from "../src/database.ts";
import { ConflictError, PermissionError, TravelService } from "../src/travel-service.ts";

function fixture(sourceExcerpt: string): ExtractionDraftPayload {
  return {
    items: [{
      kind: "lodging",
      kinds: ["lodging"],
      shape: "point",
      shapeSource: "inferred",
      title: "Holiday Inn Express",
      status: "provisional",
      startsAt: "2026-10-01",
      startTimeFlexibility: "flexible",
      endTimeFlexibility: "required",
      timeWindow: "evening",
      location: "Page",
      sourceExcerpt,
    }],
    missing: [{ field: "endsAt", message: "請補充退房時間。", required: false }],
    assumptions: ["以 Trip Timezone 解讀相對日期。"],
    issues: [],
    sourceExcerpt,
  };
}

test("persists one pending Extraction Draft without creating a Proposal", async () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const group = service.createTravelGroup("system-admin", "C-draft", "Draft 群組");
  const trip = service.createActiveTrip("system-admin", group.id, "Draft 旅程", "Asia/Taipei");
  const source = "10/1 晚上入住 Page 的飯店";
  const draft = await service.createExtractionDraft(trip.id, source, {
    idempotencyKey: "draft:one",
    type: "line_text",
    currentDate: "2026-09-17",
  }, new FakeLlmAdapter({ [source]: fixture(source) }));

  assert.match(draft.id, /^X-[0-9A-F]{8}$/);
  assert.equal(draft.status, "pending_confirmation");
  assert.equal(draft.items[0]?.startTimeFlexibility, "flexible");
  assert.equal(draft.items[0]?.endTimeFlexibility, "required");
  assert.equal(draft.items[0]?.timeWindow, "evening");
  assert.equal(draft.missing[0]?.required, false);
  assert.equal(draft.sourceExcerpt, source);
  assert.equal(service.getImportChunks(trip.id, draft.sourceId).length, 1);
  assert.deepEqual(draft.metadata, { provider: "fake", model: "fake", promptVersion: "extraction-draft-v6" });
  assert.equal(service.reviewTrip(trip.id).pending.length, 0);
  assert.match(renderExtractionDraft(draft), new RegExp(`Extraction Draft ${draft.id}`));
  assert.match(renderExtractionDraft(draft), /請確認：確認 X-/);
  db.close();
});

test("quality guard fills rental venue location and independent route timezones", () => {
  const payload = fixture("quality");
  payload.items[0]!.kind = "rental_car";
  payload.items[0]!.kinds = ["rental_car"];
  payload.items[0]!.title = "McCarran Rent-A-Car Center";
  payload.items[0]!.location = undefined;
  payload.items.push({ ...payload.items[0]!, kind: "transport", kinds: ["transport"], shape: "route", title: "Las Vegas → Page", location: undefined, origin: "Las Vegas", destination: "Page", originTimezone: undefined, destinationTimezone: undefined });

  const guarded = guardExtractionDraftPayload(payload, "quality");
  assert.equal(guarded.items[0]?.location, "McCarran Rent-A-Car Center");
  assert.equal(guarded.items[1]?.originTimezone, "America/Los_Angeles");
  assert.equal(guarded.items[1]?.destinationTimezone, "America/Phoenix");

  const usRoadTrip = guardExtractionDraftPayload({ ...payload, items: [{ ...payload.items[0]!, kind: "transport", kinds: ["transport"], title: "開車至洛杉磯", location: "洛杉磯", timezone: "Asia/Taipei", timezoneSource: "explicit" }] }, "10/4 開車至洛杉磯");
  assert.equal(usRoadTrip.items[0]?.timezone, "America/Los_Angeles");
  assert.equal(usRoadTrip.items[0]?.timezoneSource, "inferred");

  payload.items.push({ ...payload.items[0]!, kind: "activity", kinds: ["activity"], shape: "point", title: "下羚羊谷報到", location: undefined });
  const activityGuarded = guardExtractionDraftPayload(payload, "quality");
  assert.equal(activityGuarded.items.at(-1)?.location, "下羚羊谷");
});

test("quality guard rejects dates and timestamps outside Source evidence", () => {
  const payload = fixture("10/1 行程：Page");
  payload.items[0]!.startsAt = "12:00";
  payload.items[0]!.localDate = "2026-09-20";
  payload.items[0]!.timezone = "Asia/Taipei";
  const guarded = guardExtractionDraftPayload(payload, "10/1 行程：Page");
  assert.equal(guarded.items[0]?.startsAt, undefined);
  assert.equal(guarded.items[0]?.localDate, undefined);
  assert.equal(guarded.items[0]?.timezone, "America/Phoenix");
  assert.ok(guarded.issues.some((issue) => issue.code === "date_outside_source"));
  assert.ok(guarded.issues.some((issue) => issue.code === "timezone_corrected"));
});

test("quality guard deduplicates undated lodging context at the same location", () => {
  const payload = fixture("Grand Canyon lodging");
  payload.items = [
    { ...payload.items[0]!, title: "住宿：大峽谷附近 (Tusayan)", localDate: undefined, startsAt: undefined, endsAt: undefined, timeWindow: undefined, location: "Tusayan" },
    { ...payload.items[0]!, title: "Accommodation in the vicinity of the Grand Canyon", localDate: undefined, startsAt: undefined, endsAt: undefined, timeWindow: undefined, location: "Tusayan" },
  ];
  const guarded = guardExtractionDraftPayload(payload, "Grand Canyon lodging");
  assert.equal(guarded.items.length, 1);
  assert.ok(guarded.issues.some((issue) => issue.code === "duplicate_item"));
});

test("persists Guard Revisions without changing immutable Source content", async () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const group = service.createTravelGroup("system-admin", "C-guard-audit", "Guard Audit 群組");
  const trip = service.createActiveTrip("system-admin", group.id, "Guard Audit 旅程", "Asia/Taipei");
  const source = "2026-10-01 租車";
  const payload = fixture(source);
  payload.items[0]!.kind = "rental_car";
  payload.items[0]!.kinds = ["rental_car"];
  payload.items[0]!.title = "McCarran Rent-A-Car Center";
  payload.items[0]!.location = undefined;
  const draft = await service.createExtractionDraft(trip.id, source, { idempotencyKey: "guard:audit" }, new FakeLlmAdapter({ [source]: payload }));
  const revisions = service.getGuardRevisions(trip.id, draft.sourceId);
  assert.ok(revisions.some((revision) => revision.ruleVersion === "guard-v1" && revision.fieldPath === "items[0].location" && revision.after === "McCarran Rent-A-Car Center"));
  assert.equal(service.getSource(draft.sourceId)?.content, source);
  db.close();
});

test("renders long Drafts in bounded pages with a continuation command", () => {
  const draft = { id: "X-PAGE0001", status: "pending_confirmation" as const, items: Array.from({ length: 10 }, (_, index) => ({ ...fixture("source"), items: undefined, kind: "other" as const, kinds: ["other" as const], shape: "point" as const, shapeSource: "inferred" as const, title: `行程 ${index + 1}`, status: "provisional" as const, startTimeFlexibility: "flexible" as const, endTimeFlexibility: "flexible" as const, location: "Page" })).map(({ items: _items, ...item }) => item), missing: [], assumptions: [], issues: [] };
  const page = renderExtractionDraft(draft, { pageSize: 2, maxLength: 500 });
  assert.match(page, /第 1\/5 頁/);
  assert.match(page, /下一頁：查看 Draft X-PAGE0001 2/);
  assert.ok(page.length <= 500);
});

test("renders missing fields, assumptions, and ignored candidates as distinct sections", () => {
  const text = renderExtractionDraft({
    id: "X-UX000001",
    status: "pending_confirmation",
    items: [],
    missing: [{ field: "location", message: "請補充住宿城市。", required: true }],
    assumptions: ["以旅程時區解讀日期。"],
    issues: [{ code: "low_information_item", message: "排除低資訊行程「Arrival」。" }],
  });
  assert.match(text, /必要資訊待補：location（必要）｜請補充住宿城市/);
  assert.match(text, /模型假設：以旅程時區解讀日期/);
  assert.match(text, /已忽略：排除低資訊行程/);
});

test("rejects Sensitive Travel Data before invoking the provider", async () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const group = service.createTravelGroup("system-admin", "C-draft-sensitive", "敏感資料群組");
  const trip = service.createActiveTrip("system-admin", group.id, "敏感資料旅程", "Asia/Taipei");
  let calls = 0;
  await assert.rejects(service.createExtractionDraft(trip.id, "信用卡號 4111 1111 1111 1111", { idempotencyKey: "draft:sensitive" }, { extract: () => { calls += 1; return fixture("safe"); } }), /Sensitive Travel Data/);
  assert.equal(calls, 0);
  assert.equal((db.connection.prepare(`SELECT COUNT(*) AS count FROM sources WHERE trip_id = ?`).get(trip.id) as { count: number }).count, 0);
  db.close();
});

test("replaying a Source Idempotency Key reuses the same Source and Draft", async () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const group = service.createTravelGroup("system-admin", "C-draft-idempotency", "Draft 群組");
  const trip = service.createActiveTrip("system-admin", group.id, "Draft 旅程", "Asia/Taipei");
  const source = "2026-10-01 前往 Page";
  const adapter = new FakeLlmAdapter({ [source]: fixture(source) });
  const first = await service.createExtractionDraft(trip.id, source, { idempotencyKey: "draft:replay" }, adapter);
  const second = await service.createExtractionDraft(trip.id, source, { idempotencyKey: "draft:replay" }, adapter);

  assert.equal(second.id, first.id);
  assert.equal(second.sourceId, first.sourceId);
  assert.equal(service.getSource(first.sourceId)?.id, first.sourceId);
  assert.equal(service.getExtractionDraft(trip.id, first.id)?.id, first.id);
  await assert.rejects(
    () => service.createExtractionDraft(trip.id, "changed content", { idempotencyKey: "draft:replay" }, adapter),
    ConflictError,
  );
  db.close();
});

test("invalid Fake Adapter output is retained as a failed Draft and keeps the Source", async () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const group = service.createTravelGroup("system-admin", "C-draft-failure", "Draft 群組");
  const trip = service.createActiveTrip("system-admin", group.id, "Draft 旅程", "Asia/Taipei");
  const draft = await service.createExtractionDraft(trip.id, "unparseable source", { idempotencyKey: "draft:failure" }, {
    extract: () => ({ items: [{ kind: "lodging", kinds: ["lodging"], shape: "point", shapeSource: "inferred", title: "bad", status: "provisional", location: 42, timezone: 42 }], missing: [], assumptions: [], issues: [], sourceExcerpt: "bad" } as never),
  });

  assert.equal(draft.status, "failed");
  assert.equal(draft.issues[0]?.code, "adapter_failure");
  assert.match(renderExtractionDraft(draft), new RegExp(`重試 ${draft.id}`));
  assert.ok(service.getSource(draft.sourceId));
  assert.equal(service.reviewTrip(trip.id).pending.length, 0);
  db.close();
});

test("unsupported itinerary enum output is retained as a failed Draft", async () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const group = service.createTravelGroup("system-admin", "C-draft-invalid-enum", "Draft 群組");
  const trip = service.createActiveTrip("system-admin", group.id, "Draft 旅程", "Asia/Taipei");
  const draft = await service.createExtractionDraft(trip.id, "invalid kind", { idempotencyKey: "draft:invalid-enum" }, {
    extract: () => ({
      items: [{ kind: "not-a-kind", kinds: ["not-a-kind"], shape: "invalid", shapeSource: "inferred", title: "bad", status: "provisional", startTimeFlexibility: "estimated", endTimeFlexibility: "flexible" }],
      missing: [], assumptions: [], issues: [], sourceExcerpt: "invalid kind",
    } as never),
  });

  assert.equal(draft.status, "failed");
  assert.equal(draft.issues[0]?.code, "adapter_failure");
  assert.ok(service.getSource(draft.sourceId));
  assert.equal(service.reviewTrip(trip.id).pending.length, 0);
  db.close();
});

test("only the originating user can confirm a Draft into pending Proposals", async () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const group = service.createTravelGroup("system-admin", "C-draft-confirm", "Draft 群組");
  const trip = service.createActiveTrip("system-admin", group.id, "Draft 旅程", "Asia/Taipei");
  const source = "已確認住宿 Page";
  const payload = fixture(source);
  payload.missing = [];
  payload.items[0]!.endTimeFlexibility = "flexible";
  const draft = await service.createExtractionDraft(trip.id, source, {
    idempotencyKey: "draft:confirm",
    provenance: { provider: "line", messageId: "message-confirm", userId: "U-origin", groupId: "C-draft-confirm" },
  }, new FakeLlmAdapter({ [source]: payload }));

  assert.throws(() => service.confirmExtractionDraft(trip.id, "U-other", draft.id), PermissionError);
  const confirmed = service.confirmExtractionDraft(trip.id, "U-origin", draft.id);
  assert.equal(confirmed.draft.status, "confirmed");
  assert.equal(confirmed.proposalIds.length, 1);
  assert.deepEqual(confirmed.draft.proposalIds, confirmed.proposalIds);
  const proposal = service.getProposal(trip.id, confirmed.proposalIds[0]!);
  assert.equal(proposal?.status, "pending");
  assert.equal(proposal?.startTimeFlexibility, "flexible");
  assert.equal(proposal?.endTimeFlexibility, "flexible");
  assert.equal(proposal?.timeWindow, "evening");
  assert.deepEqual(proposal?.assumptions, payload.assumptions);
  assert.equal(service.reviewTrip(trip.id).confirmed.length, 0);
  assert.equal(service.reviewTrip(trip.id).pending.length, 1);

  const replay = service.confirmExtractionDraft(trip.id, "U-origin", draft.id);
  assert.deepEqual(replay.proposalIds, confirmed.proposalIds);
  assert.equal(service.reviewTrip(trip.id).pending.length, 1);
  db.close();
});

test("confirms a flexible date-only Draft and preserves localDate through Proposal and Trip Item", async () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const group = service.createTravelGroup("system-admin", "C-draft-date-only", "Date-only 群組");
  const trip = service.createActiveTrip("system-admin", group.id, "Date-only 旅程", "Asia/Taipei");
  service.addMember("system-admin", trip.id, "U-origin", "Origin", "owner");
  const source = "2026-10-01 晚上入住 Page 的 Holiday Inn";
  const payload = fixture(source);
  payload.items[0]!.startsAt = undefined;
  payload.items[0]!.endsAt = undefined;
  payload.items[0]!.localDate = "2026-10-01";
  payload.items[0]!.startTimeFlexibility = "flexible";
  payload.items[0]!.endTimeFlexibility = "flexible";
  payload.missing = [];
  const draft = await service.createExtractionDraft(trip.id, source, {
    idempotencyKey: "draft:date-only",
    provenance: { provider: "line", messageId: "message-date-only", userId: "U-origin" },
  }, new FakeLlmAdapter({ [source]: payload }));

  const confirmed = service.confirmExtractionDraft(trip.id, "U-origin", draft.id);
  const proposal = service.getProposal(trip.id, confirmed.proposalIds[0]!);
  assert.equal(proposal?.localDate, "2026-10-01");
  assert.equal(proposal?.startsAt, undefined);
  assert.equal(proposal?.timeWindow, "evening");
  const item = service.confirmProposal(trip.id, "U-origin", confirmed.proposalIds[0]!);
  assert.equal(item.localDate, "2026-10-01");
  assert.equal(item.startsAt, undefined);
  const queried = service.queryActiveTrip(trip.id, "U-origin", { date: "2026-10-01" });
  assert.equal(queried.confirmed[0]?.localDate, "2026-10-01");
  const proposalColumns = db.connection.prepare(`PRAGMA table_info(proposals)`).all() as Array<{ name: string }>;
  const tripItemColumns = db.connection.prepare(`PRAGMA table_info(trip_items)`).all() as Array<{ name: string }>;
  assert.ok(proposalColumns.some((column) => column.name === "local_date"));
  assert.ok(tripItemColumns.some((column) => column.name === "local_date"));
  db.close();
});

test("accepts a provider item with a null localDate", async () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const group = service.createTravelGroup("system-admin", "C-draft-null-date", "Null date 群組");
  const trip = service.createActiveTrip("system-admin", group.id, "Null date 旅程", "Asia/Taipei");
  const source = "有待補日期的住宿";
  const payload = fixture(source);
  (payload.items[0] as unknown as { localDate: string | null; startsAt: string | null; endsAt: string | null }).localDate = null;
  (payload.items[0] as unknown as { startsAt: string | null }).startsAt = null;
  (payload.items[0] as unknown as { endsAt: string | null }).endsAt = null;
  const draft = await service.createExtractionDraft(trip.id, source, { idempotencyKey: "draft:null-date" }, new FakeLlmAdapter({ [source]: payload }));
  assert.equal(draft.status, "pending_confirmation");
  assert.equal(draft.items[0]?.localDate, null);
  db.close();
});

test("accepts a date-only provider item with null clock timestamps", () => {
  const payload = fixture("date-only provider output");
  payload.items[0]!.localDate = "2026-10-01";
  (payload.items[0] as unknown as { startsAt: string | null; endsAt: string | null }).startsAt = null;
  (payload.items[0] as unknown as { endsAt: string | null }).endsAt = null;
  const validated = validateExtractionDraftPayload(payload);
  assert.equal(validated.items[0]?.localDate, "2026-10-01");
  assert.equal(validated.items[0]?.startsAt, null);
  assert.equal(validated.items[0]?.endsAt, null);
});

test("rejects an invalid calendar date in an extraction item", () => {
  const payload = fixture("invalid calendar date");
  payload.items[0]!.localDate = "2026-02-30";
  assert.throws(() => validateExtractionDraftPayload(payload), /ISO calendar date/);
});

test("groups lodging context without creating a duplicate Arrival item", async () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const group = service.createTravelGroup("system-admin", "C-draft-grouping", "Grouping 群組");
  const trip = service.createActiveTrip("system-admin", group.id, "Grouping 旅程", "Asia/Taipei");
  const source = "10/1 晚上到 Page，想住 Holiday Inn";
  const lodging = { ...fixture(source).items[0]!, title: "Holiday Inn", localDate: "2026-10-01", startsAt: undefined, endsAt: undefined, location: "Page", kind: "lodging" as const, kinds: ["lodging" as const] };
  const arrival = { ...lodging, title: "Arriving in Page", kind: "other" as const, kinds: ["other" as const], startsAt: "2026-10-01" };
  const draft = await service.createExtractionDraft(trip.id, source, { idempotencyKey: "draft:grouping" }, new FakeLlmAdapter({ [source]: { items: [lodging, arrival], missing: [], assumptions: [], issues: [], sourceExcerpt: source } }));
  assert.deepEqual(draft.items.map((item) => item.title), ["Holiday Inn"]);
  db.close();
});

test("groups Chinese 到地點 wording as lodging context", async () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const group = service.createTravelGroup("system-admin", "C-draft-arrive-context", "到達上下文群組");
  const trip = service.createActiveTrip("system-admin", group.id, "到達上下文旅程", "Asia/Taipei");
  const source = "10/2晚上到Page, 想著另一間飯店";
  const lodging = { ...fixture(source).items[0]!, title: "另一間飯店", localDate: "2026-10-02", startsAt: undefined, endsAt: undefined, location: "Page", kind: "lodging" as const, kinds: ["lodging" as const] };
  const arrival = { ...lodging, title: "到Page", kind: "other" as const, kinds: ["other" as const] };
  const draft = await service.createExtractionDraft(trip.id, source, { idempotencyKey: "draft:arrive-context" }, new FakeLlmAdapter({ [source]: { items: [lodging, arrival], missing: [], assumptions: [], issues: [], sourceExcerpt: source } }));
  assert.deepEqual(draft.items.map((item) => item.title), ["另一間飯店"]);
  db.close();
});

test("groups 到地點 context when the lodging candidate lacks a location", async () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const group = service.createTravelGroup("system-admin", "C-draft-arrive-missing-location", "缺少地點上下文群組");
  const trip = service.createActiveTrip("system-admin", group.id, "缺少地點上下文旅程", "Asia/Taipei");
  const source = "10/2晚上到Page, 想著另一間飯店";
  const lodging = { ...fixture(source).items[0]!, title: "另一間飯店", localDate: "2026-10-02", startsAt: undefined, endsAt: undefined, location: undefined, kind: "other" as const, kinds: ["other" as const] };
  const arrival = { ...lodging, title: "到Page", location: "Page" };
  const draft = await service.createExtractionDraft(trip.id, source, { idempotencyKey: "draft:arrive-missing-location" }, new FakeLlmAdapter({ [source]: { items: [lodging, arrival], missing: [], assumptions: [], issues: [{ code: "arbitrary_provider_code", message: "Retain transportation to Page, but remove lodging context." }], sourceExcerpt: source } }));
  assert.deepEqual(draft.items.map((item) => item.title), ["另一間飯店"]);
  assert.deepEqual(draft.issues.map((issue) => issue.code), ["contextual_phrase"]);
  db.close();
});

test("retains an explicitly timed Arrival as a separate item", async () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const group = service.createTravelGroup("system-admin", "C-draft-arrival", "Arrival 群組");
  const trip = service.createActiveTrip("system-admin", group.id, "Arrival 旅程", "Asia/Taipei");
  const source = "10/1 18:00 抵達 Page，另外安排住宿 Holiday Inn";
  const lodging = { ...fixture(source).items[0]!, title: "Holiday Inn", startsAt: "2026-10-01T19:00:00+08:00", location: "Page", kind: "lodging" as const, kinds: ["lodging" as const] };
  const arrival = { ...lodging, title: "抵達 Page", kind: "other" as const, kinds: ["other" as const], startsAt: "2026-10-01T18:00:00+08:00" };
  const draft = await service.createExtractionDraft(trip.id, source, { idempotencyKey: "draft:arrival" }, new FakeLlmAdapter({ [source]: { items: [lodging, arrival], missing: [], assumptions: [], issues: [], sourceExcerpt: source } }));
  assert.deepEqual(draft.items.map((item) => item.title), ["Holiday Inn", "抵達 Page"]);
  db.close();
});

test("excludes low-information Arrival candidates and records a review issue", async () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const group = service.createTravelGroup("system-admin", "C-draft-low-info", "Low info 群組");
  const trip = service.createActiveTrip("system-admin", group.id, "Low info 旅程", "Asia/Taipei");
  const source = "之後會抵達";
  const arrival = { ...fixture(source).items[0]!, title: "Arrival", kind: "other" as const, kinds: ["other" as const], startsAt: undefined, localDate: undefined, timeWindow: undefined, location: undefined };
  const draft = await service.createExtractionDraft(trip.id, source, { idempotencyKey: "draft:low-info" }, new FakeLlmAdapter({ [source]: { items: [arrival], missing: [], assumptions: [], issues: [], sourceExcerpt: source } }));
  assert.equal(draft.items.length, 0);
  assert.equal(draft.issues[0]?.code, "low_information_item");
  db.close();
});

test("deduplicates identical model candidates without changing the Source", async () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const group = service.createTravelGroup("system-admin", "C-draft-duplicate", "Duplicate 群組");
  const trip = service.createActiveTrip("system-admin", group.id, "Duplicate 旅程", "Asia/Taipei");
  const source = "10/1 住宿 Page";
  const item = { ...fixture(source).items[0]!, localDate: "2026-10-01", startsAt: undefined, endsAt: undefined, location: "Page" };
  const draft = await service.createExtractionDraft(trip.id, source, { idempotencyKey: "draft:duplicate" }, new FakeLlmAdapter({ [source]: { items: [item, { ...item }], missing: [], assumptions: [], issues: [], sourceExcerpt: source } }));
  assert.equal(draft.items.length, 1);
  assert.equal(draft.issues[0]?.code, "duplicate_item");
  assert.ok(service.getSource(draft.sourceId));
  db.close();
});

test("guards contradictory candidates for the same itinerary identity", async () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const group = service.createTravelGroup("system-admin", "C-draft-contradiction", "Contradiction 群組");
  const trip = service.createActiveTrip("system-admin", group.id, "Contradiction 旅程", "Asia/Taipei");
  const source = "住宿日期待確認";
  const item = { ...fixture(source).items[0]!, title: "Holiday Inn", localDate: "2026-10-01", startsAt: undefined, endsAt: undefined, location: "Page" };
  const conflicting = { ...item, localDate: "2026-10-02" };
  const draft = await service.createExtractionDraft(trip.id, source, { idempotencyKey: "draft:contradiction" }, new FakeLlmAdapter({ [source]: { items: [item, conflicting], missing: [], assumptions: [], issues: [], sourceExcerpt: source } }));
  assert.equal(draft.items.length, 1);
  assert.equal(draft.issues[0]?.code, "contradictory_item");
  db.close();
});

test("required missing Draft information blocks confirmation", async () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const group = service.createTravelGroup("system-admin", "C-draft-blocked", "Draft 群組");
  const trip = service.createActiveTrip("system-admin", group.id, "Draft 旅程", "Asia/Taipei");
  const source = "需要時間的 tour";
  const payload = fixture(source);
  payload.items[0]!.startsAt = undefined;
  payload.items[0]!.startTimeFlexibility = "required";
  payload.missing = [];
  const draft = await service.createExtractionDraft(trip.id, source, {
    idempotencyKey: "draft:blocked",
    provenance: { provider: "line", messageId: "message-blocked", userId: "U-origin" },
  }, new FakeLlmAdapter({ [source]: payload }));

  assert.throws(() => service.confirmExtractionDraft(trip.id, "U-origin", draft.id), ConflictError);
  assert.equal(service.getExtractionDraft(trip.id, draft.id)?.status, "pending_confirmation");
  assert.equal(service.reviewTrip(trip.id).pending.length, 0);
  db.close();
});

test("a date-less Draft remains unconfirmed even when time-of-day is flexible", async () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const group = service.createTravelGroup("system-admin", "C-draft-date", "Draft 群組");
  const trip = service.createActiveTrip("system-admin", group.id, "Draft 旅程", "Asia/Taipei");
  const source = "晚上去 Page";
  const payload = fixture(source);
  payload.items[0]!.startsAt = undefined;
  payload.items[0]!.startTimeFlexibility = "flexible";
  payload.items[0]!.endTimeFlexibility = "flexible";
  payload.missing = [];
  const draft = await service.createExtractionDraft(trip.id, source, {
    idempotencyKey: "draft:date-required",
    provenance: { provider: "line", messageId: "message-date", userId: "U-origin" },
  }, new FakeLlmAdapter({ [source]: payload }));

  assert.throws(() => service.confirmExtractionDraft(trip.id, "U-origin", draft.id), ConflictError);
  assert.equal(service.getExtractionDraft(trip.id, draft.id)?.status, "pending_confirmation");
  db.close();
});

test("confirms valid items from a mixed Draft and leaves unresolved items reviewable", async () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const group = service.createTravelGroup("system-admin", "C-draft-partial", "Partial Draft 群組");
  const trip = service.createActiveTrip("system-admin", group.id, "Partial Draft 旅程", "Asia/Taipei");
  const source = "多日行程";
  const payload = fixture(source);
  payload.items[0]!.endTimeFlexibility = "flexible";
  payload.items.push({ ...payload.items[0]!, title: "缺日期行程", startsAt: undefined, endsAt: undefined, localDate: undefined });
  payload.missing = [{ field: "localDate", message: "缺日期行程需要日期。", required: true }];
  const draft = await service.createExtractionDraft(trip.id, source, { idempotencyKey: "draft:partial", provenance: { provider: "line", messageId: "partial", userId: "U-origin" } }, new FakeLlmAdapter({ [source]: payload }));

  const confirmed = service.confirmExtractionDraft(trip.id, "U-origin", draft.id);
  assert.equal(confirmed.proposalIds.length, 1);
  assert.equal(confirmed.draft.status, "pending_confirmation");
  assert.equal(confirmed.draft.missing.length, 1);
  assert.equal(service.reviewTrip(trip.id).pending.length, 1);
  db.close();
});

test("records a Review Issue when a required clock time is unresolved", async () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const group = service.createTravelGroup("system-admin", "C-draft-required-time", "Required time 群組");
  const trip = service.createActiveTrip("system-admin", group.id, "Required time 旅程", "Asia/Taipei");
  const source = "有日期但缺開始時間";
  const payload = fixture(source);
  payload.items[0]!.endTimeFlexibility = "flexible";
  payload.items[0]!.localDate = "2026-10-02";
  payload.items[0]!.startsAt = undefined;
  payload.items[0]!.startTimeFlexibility = "required";
  payload.missing = [];
  payload.items.push({ ...payload.items[0]!, title: "Valid item", startsAt: "2026-10-02T09:00:00+08:00", localDate: undefined, startTimeFlexibility: "required" });
  const draft = await service.createExtractionDraft(trip.id, source, { idempotencyKey: "draft:required-time", provenance: { provider: "line", messageId: "required-time", userId: "U-origin" } }, new FakeLlmAdapter({ [source]: payload }));

  const confirmed = service.confirmExtractionDraft(trip.id, "U-origin", draft.id);
  assert.equal(confirmed.proposalIds.length, 1);
  assert.equal(confirmed.draft.status, "pending_confirmation");
  assert.ok(confirmed.draft.issues.some((issue) => /必要的開始時間/.test(issue.message)));
  db.close();
});

test("concurrent Source redelivery reuses one persisted Draft", async () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const group = service.createTravelGroup("system-admin", "C-draft-concurrent", "Draft 群組");
  const trip = service.createActiveTrip("system-admin", group.id, "Draft 旅程", "Asia/Taipei");
  const source = "2026-10-01 concurrent Page";
  const adapter = {
    extract: async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return fixture(source);
    },
  };

  const drafts = await Promise.all([
    service.createExtractionDraft(trip.id, source, { idempotencyKey: "draft:concurrent" }, adapter),
    service.createExtractionDraft(trip.id, source, { idempotencyKey: "draft:concurrent" }, adapter),
  ]);
  assert.equal(drafts[0]!.id, drafts[1]!.id);
  assert.equal(service.getExtractionDraft(trip.id, drafts[0]!.id)?.id, drafts[0]!.id);
  db.close();
});

test("editing a Draft creates an immutable revision and confirmed revisions are locked", async () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const group = service.createTravelGroup("system-admin", "C-draft-revision", "Draft 群組");
  const trip = service.createActiveTrip("system-admin", group.id, "Draft 旅程", "Asia/Taipei");
  const source = "2026-10-01 Page lodging";
  const payload = fixture(source);
  payload.missing = [];
  payload.items[0]!.endTimeFlexibility = "flexible";
  const original = await service.createExtractionDraft(trip.id, source, {
    idempotencyKey: "draft:revision",
    provenance: { provider: "line", messageId: "message-revision", userId: "U-origin" },
  }, new FakeLlmAdapter({ [source]: payload }));
  const editedPayload = structuredClone(payload);
  editedPayload.items[0]!.title = "Updated Page lodging";
  const revision = service.reviseExtractionDraft(trip.id, "U-origin", original.id, editedPayload);

  assert.equal(revision.revision, 2);
  assert.equal(revision.previousDraftId, original.id);
  assert.equal(service.getExtractionDraft(trip.id, original.id)?.items[0]?.title, "Holiday Inn Express");
  assert.equal(service.getExtractionDraft(trip.id, revision.id)?.items[0]?.title, "Updated Page lodging");
  assert.throws(() => service.confirmExtractionDraft(trip.id, "U-origin", original.id), ConflictError);
  const confirmed = service.confirmExtractionDraft(trip.id, "U-origin", revision.id);
  assert.equal(confirmed.proposalIds.length, 1);
  assert.throws(() => service.reviseExtractionDraft(trip.id, "U-origin", revision.id, editedPayload), ConflictError);
  db.close();
});

test("cancelling a Draft creates no Proposal and retry creates a new revision", async () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const group = service.createTravelGroup("system-admin", "C-draft-cancel-retry", "Draft 群組");
  const trip = service.createActiveTrip("system-admin", group.id, "Draft 旅程", "Asia/Taipei");
  const cancelledSource = "2026-10-01 cancelled";
  const cancelled = await service.createExtractionDraft(trip.id, cancelledSource, {
    idempotencyKey: "draft:cancel",
    provenance: { provider: "line", messageId: "message-cancel", userId: "U-origin" },
  }, new FakeLlmAdapter({ [cancelledSource]: fixture(cancelledSource) }));
  const cancelledResult = service.cancelExtractionDraft(trip.id, "U-origin", cancelled.id);
  assert.equal(cancelledResult.status, "cancelled");
  assert.equal(service.reviewTrip(trip.id).pending.length, 0);

  const failedSource = "2026-10-02 retry me";
  const failed = await service.createExtractionDraft(trip.id, failedSource, {
    idempotencyKey: "draft:retry",
    provenance: { provider: "line", messageId: "message-retry", userId: "U-origin" },
  }, { extract: () => ({ invalid: true } as never) });
  assert.equal(failed.status, "failed");
  const retried = await service.retryExtractionDraft(trip.id, "U-origin", failed.id, new FakeLlmAdapter({ [failedSource]: fixture(failedSource) }));
  assert.equal(retried.status, "pending_confirmation");
  assert.equal(retried.revision, 2);
  assert.equal(retried.previousDraftId, failed.id);
  db.close();
});
