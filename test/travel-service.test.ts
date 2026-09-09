import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";
import { TravelDatabase } from "../src/database.ts";
import { ConflictError, InvalidTimezoneError, PermissionError, TravelService, TripNotActiveError } from "../src/travel-service.ts";

function bootstrapActiveTrip(service: TravelService, lineGroupId: string): string {
  const travelGroup = service.createTravelGroup("system-admin", lineGroupId, "測試旅遊群");
  return service.createActiveTrip("system-admin", travelGroup.id, "測試旅程", "America/Los_Angeles").id;
}

test("a System Administrator bootstraps one Active Trip and archives its mutations", () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  assert.throws(
    () => service.createTravelGroup("U-member", "C-line-group", "美西自駕群"),
    PermissionError,
  );
  const travelGroup = service.createTravelGroup("system-admin", "C-line-group", "美西自駕群");
  assert.throws(
    () => service.createActiveTrip("system-admin", travelGroup.id, "錯誤時區旅程", "not-a-timezone"),
    InvalidTimezoneError,
  );
  assert.throws(
    () => service.createActiveTrip("U-member", travelGroup.id, "未授權旅程", "America/Los_Angeles"),
    PermissionError,
  );
  const trip = service.createActiveTrip("system-admin", travelGroup.id, "2026 美西自駕", "America/Los_Angeles");

  assert.throws(() => service.addMember("U-member", trip.id, "U-owner", "Aster", "owner"), PermissionError);
  service.addMember("system-admin", trip.id, "U-owner", "Aster", "owner");
  assert.throws(
    () => service.createActiveTrip("system-admin", travelGroup.id, "第二趟旅程", "America/Los_Angeles"),
    ConflictError,
  );

  const imported = service.importMarkdown(trip.id, "- [provisional] 住宿 | 2026-10-16 | Monterey", { idempotencyKey: "test:archive:1" });
  assert.throws(() => service.archiveTrip("U-member", trip.id), PermissionError);
  service.archiveTrip("system-admin", trip.id);
  assert.throws(
    () => service.importMarkdown(trip.id, "- [provisional] 住宿 | 2026-10-16 | Monterey", { idempotencyKey: "test:archive:2" }),
    TripNotActiveError,
  );
  assert.throws(() => service.confirmProposal(trip.id, "U-owner", imported.proposalIds[0]), TripNotActiveError);

  assert.throws(() => service.reactivateTrip("U-member", trip.id), PermissionError);
  service.reactivateTrip("system-admin", trip.id);
  assert.equal(service.confirmProposal(trip.id, "U-owner", imported.proposalIds[0]).title, "住宿");
  db.close();
});

test("importing the same Source Idempotency Key reuses its Source and Proposals", () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const tripId = bootstrapActiveTrip(service, "C-idempotency");
  const markdown = "- [provisional] 住宿 |  | Monterey";

  const first = service.importMarkdown(tripId, markdown, {
    idempotencyKey: "line:event:abc123",
    sourceTime: "2026-09-09T10:00:00.000Z",
  });
  const replay = service.importMarkdown(tripId, markdown, {
    idempotencyKey: "line:event:abc123",
    sourceTime: "2026-09-09T10:05:00.000Z",
  });
  const independent = service.importMarkdown(tripId, markdown, {
    idempotencyKey: "line:event:def456",
  });
  const unparseable = service.importMarkdown(tripId, "This source has no itinerary candidate line.", {
    idempotencyKey: "line:event:unparseable",
  });

  assert.deepEqual(replay, first);
  assert.notEqual(independent.sourceId, first.sourceId);
  assert.notDeepEqual(independent.proposalIds, first.proposalIds);
  const review = service.reviewTrip(tripId);
  assert.equal(review.issues.filter((issue) => issue.code === "missing_start_time").length, 2);
  assert.deepEqual(review.issues.find((issue) => issue.code === "source_unparsed"), {
    code: "source_unparsed",
    message: "Source has no parseable itinerary candidates.",
    sourceId: unparseable.sourceId,
    proposalIds: [],
  });
  db.close();
});

test("the Source Idempotency Key is stable across database connections", () => {
  const directory = mkdtempSync(join(tmpdir(), "travel-leader-agent-"));
  const databasePath = join(directory, "travel.sqlite");
  const firstDatabase = new TravelDatabase(databasePath);
  const firstService = new TravelService(firstDatabase, "system-admin");
  const travelGroup = firstService.createTravelGroup("system-admin", "C-cross-connection", "測試旅遊群");
  const trip = firstService.createActiveTrip("system-admin", travelGroup.id, "測試旅程", "America/Los_Angeles");
  const first = firstService.importMarkdown(trip.id, "- [provisional] 住宿 | 2026-10-16 | Monterey", { idempotencyKey: "line:event:cross-connection" });

  const secondDatabase = new TravelDatabase(databasePath);
  const secondService = new TravelService(secondDatabase, "system-admin");
  const replay = secondService.importMarkdown(trip.id, "- [provisional] 住宿 | 2026-10-16 | Monterey", { idempotencyKey: "line:event:cross-connection" });

  assert.deepEqual(replay, first);
  secondDatabase.close();
  firstDatabase.close();
  rmSync(directory, { recursive: true, force: true });
});

test("markdown creates proposals and only an owner can confirm one", () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const tripId = bootstrapActiveTrip(service, "C-trip-1");
  service.addMember("system-admin", tripId, "owner", "Owner", "owner");
  service.addMember("system-admin", tripId, "member", "Member", "member");
  const result = service.importMarkdown(tripId, `
- [confirmed] UA 123 航班 | 2026-10-15T09:30:00-07:00 | SFO
- [open_decision] 10/16 住宿：Carmel 或 Monterey | 2026-10-16T15:00:00-07:00 | Monterey
- [conflicted] 租車取車時間不一致 | 2026-10-15T10:30:00-07:00 | SFO
`, { idempotencyKey: "test:review:1" });

  assert.equal(result.proposalIds.length, 3);
  assert.throws(() => service.confirmProposal(tripId, "member", result.proposalIds[0]), PermissionError);
  service.confirmProposal(tripId, "owner", result.proposalIds[0]);

  const review = service.reviewTrip(tripId);
  assert.equal(review.confirmed.length, 1);
  assert.equal(review.confirmed[0].title, "UA 123 航班");
  assert.equal(review.openDecisions.length, 1);
  assert.equal(review.conflicts.length, 1);
  db.close();
});

test("review preserves source evidence, identifies missing fields and blocks unresolved conflicts", () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const tripId = bootstrapActiveTrip(service, "C-trip-2");
  service.addMember("system-admin", tripId, "owner", "Owner", "owner");
  const result = service.importMarkdown(tripId, `
- [provisional] 10/16 住宿：Carmel | 2026-10-16T15:00:00-07:00 | Carmel | 可取消 | timezone=America/Los_Angeles | deadline=2026-10-01T17:00:00-07:00
- [provisional] 10/16 住宿：Monterey | 2026-10-16T15:00:00-07:00 | Monterey | 可取消 | timezone=America/Los_Angeles
- [conflicted] 租車取車時間不一致 |  | SFO
`, { idempotencyKey: "test:review:2" });

  const review = service.reviewTrip(tripId);
  const carmel = review.provisional.find((proposal) => proposal.title.includes("Carmel"));
  assert.equal(carmel?.sourceLine, 2);
  assert.match(carmel?.sourceExcerpt ?? "", /Carmel/);
  assert.equal(carmel?.deadlineAt, "2026-10-01T17:00:00-07:00");
  assert.equal(review.issues.filter((issue) => issue.code === "schedule_collision").length, 1);
  assert.equal(review.issues.filter((issue) => issue.code === "missing_start_time").length, 1);
  assert.throws(() => service.confirmProposal(tripId, "owner", result.proposalIds[2]), ConflictError);
  db.close();
});
