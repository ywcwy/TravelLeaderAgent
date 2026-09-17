import assert from "node:assert/strict";
import test from "node:test";
import { FakeLlmAdapter, renderExtractionDraft } from "../src/extraction-draft.ts";
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
  assert.equal(service.reviewTrip(trip.id).pending.length, 0);
  assert.match(renderExtractionDraft(draft), new RegExp(`Extraction Draft ${draft.id}`));
  assert.match(renderExtractionDraft(draft), /確認 Draft/);
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
