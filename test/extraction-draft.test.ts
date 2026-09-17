import assert from "node:assert/strict";
import test from "node:test";
import { FakeLlmAdapter, renderExtractionDraft } from "../src/extraction-draft.ts";
import type { ExtractionDraftPayload } from "../src/domain.ts";
import { TravelDatabase } from "../src/database.ts";
import { TravelService } from "../src/travel-service.ts";

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
  db.close();
});

test("invalid Fake Adapter output is retained as a failed Draft and keeps the Source", async () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const group = service.createTravelGroup("system-admin", "C-draft-failure", "Draft 群組");
  const trip = service.createActiveTrip("system-admin", group.id, "Draft 旅程", "Asia/Taipei");
  const draft = await service.createExtractionDraft(trip.id, "unparseable source", { idempotencyKey: "draft:failure" }, {
    extract: () => ({ items: [], missing: [], assumptions: [], issues: [], sourceExcerpt: 42 } as never),
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
