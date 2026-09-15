import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";
import { TravelDatabase } from "../src/database.ts";
import { ConflictError, InvalidSourceError, InvalidTimezoneError, PermissionError, TravelService, TripNotActiveError } from "../src/travel-service.ts";

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
  assert.equal(service.reviewTrip(trip.id).issues.some((issue) => issue.code === "source_unparsed" && issue.sourceId === imported.sourceId), false);
  db.close();
});

test("resets one Active Trip into a fresh Trip while preserving history and roster", () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const group = service.createTravelGroup("system-admin", "C-reset", "Reset 群組");
  const oldTrip = service.createActiveTrip("system-admin", group.id, "舊旅程", "Asia/Taipei");
  service.addMember("system-admin", oldTrip.id, "U-owner", "Owner", "owner");
  service.addMember("system-admin", oldTrip.id, "U-member", "Member", "member");
  service.addMember("system-admin", oldTrip.id, "U-revoked", "Revoked", "member");
  service.revokeGroupMember(oldTrip.id, "U-revoked");
  service.updateTripAccessPolicy("system-admin", oldTrip.id, { memberCanViewSourceContent: true, memberCanViewCancelledHistory: true });
  const oldImport = service.importMarkdown(oldTrip.id, "- [provisional] 舊住宿 | 2026-10-16 | 台北", { idempotencyKey: "reset:old" });

  const result = service.resetActiveTrip("system-admin", oldTrip.id, { title: "新旅程", timezone: "Asia/Tokyo" });

  assert.equal(result.archivedTrip.id, oldTrip.id);
  assert.equal(result.archivedTrip.status, "archived");
  assert.notEqual(result.activeTrip.id, oldTrip.id);
  assert.equal(result.activeTrip.title, "新旅程");
  assert.equal(result.activeTrip.timezone, "Asia/Tokyo");
  assert.equal(result.copiedMemberCount, 2);
  assert.equal(service.getActiveTripForLineGroup(group.lineGroupId)?.id, result.activeTrip.id);
  assert.equal(service.isActiveTripMember(result.activeTrip.id, "U-owner"), true);
  assert.equal(service.isActiveTripMember(result.activeTrip.id, "U-member"), true);
  assert.equal(service.isActiveTripMember(result.activeTrip.id, "U-revoked"), false);
  assert.deepEqual(service.getTripAccessPolicy(result.activeTrip.id), {
    tripId: result.activeTrip.id,
    memberCanViewPending: true,
    memberCanViewReviewIssues: true,
    memberCanViewCancelledHistory: false,
    memberCanViewSourceContent: false,
    updatedBy: null,
    updatedAt: null,
  });
  assert.equal(service.reviewTrip(oldTrip.id).provisional[0]?.sourceId, oldImport.sourceId);
  assert.throws(() => service.importMarkdown(oldTrip.id, "- [provisional] 不應寫入 | 2026-10-17 | 台北", { idempotencyKey: "reset:archived" }), TripNotActiveError);
  db.close();
});

test("isolates Trip Access Policy defaults and administrator updates per Trip", () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const firstTripId = bootstrapActiveTrip(service, "C-policy-first");
  const secondTripId = bootstrapActiveTrip(service, "C-policy-second");

  assert.deepEqual(service.getTripAccessPolicy(firstTripId), {
    tripId: firstTripId,
    memberCanViewPending: true,
    memberCanViewReviewIssues: true,
    memberCanViewCancelledHistory: false,
    memberCanViewSourceContent: false,
    updatedBy: null,
    updatedAt: null,
  });
  assert.throws(
    () => service.updateTripAccessPolicy("U-member", firstTripId, { memberCanViewPending: false }),
    PermissionError,
  );

  const updated = service.updateTripAccessPolicy("system-admin", firstTripId, {
    memberCanViewPending: false,
    memberCanViewReviewIssues: true,
    memberCanViewCancelledHistory: true,
    memberCanViewSourceContent: true,
  });
  assert.equal(updated.tripId, firstTripId);
  assert.equal(updated.memberCanViewPending, false);
  assert.equal(updated.memberCanViewCancelledHistory, true);
  assert.equal(updated.memberCanViewSourceContent, true);
  assert.equal(updated.updatedBy, "system-admin");
  assert.ok(updated.updatedAt);
  assert.equal(service.getTripAccessPolicy(secondTripId).memberCanViewPending, true);

  service.archiveTrip("system-admin", firstTripId);
  assert.throws(
    () => service.updateTripAccessPolicy("system-admin", firstTripId, { memberCanViewPending: true }),
    TripNotActiveError,
  );
  db.close();
});

test("backfills one default Trip Access Policy for legacy Trips", () => {
  const directory = mkdtempSync(join(tmpdir(), "travel-leader-agent-policy-migration-"));
  const databasePath = join(directory, "legacy.sqlite");
  const initial = new TravelDatabase(databasePath);
  const service = new TravelService(initial, "system-admin");
  const firstTripId = bootstrapActiveTrip(service, "C-policy-legacy-first");
  const secondTripId = bootstrapActiveTrip(service, "C-policy-legacy-second");
  initial.connection.exec(`DROP TABLE trip_access_policies`);
  initial.close();

  const upgraded = new TravelDatabase(databasePath);
  const upgradedService = new TravelService(upgraded, "system-admin");
  assert.deepEqual(upgradedService.getTripAccessPolicy(firstTripId), {
    tripId: firstTripId,
    memberCanViewPending: true,
    memberCanViewReviewIssues: true,
    memberCanViewCancelledHistory: false,
    memberCanViewSourceContent: false,
    updatedBy: null,
    updatedAt: null,
  });
  assert.equal(upgradedService.getTripAccessPolicy(secondTripId).tripId, secondTripId);
  assert.equal(upgraded.connection.prepare(`SELECT COUNT(*) AS count FROM trip_access_policies`).get()?.count, 2);
  upgraded.close();

  const reopened = new TravelDatabase(databasePath);
  assert.equal(reopened.connection.prepare(`SELECT COUNT(*) AS count FROM trip_access_policies`).get()?.count, 2);
  reopened.close();
  rmSync(directory, { recursive: true, force: true });
});

test("queries policy-permitted Active Trip records with stable filters", () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const tripId = bootstrapActiveTrip(service, "C-query-service");
  service.ensureGroupMember(tripId, "U-member", "Member");
  service.addMember("system-admin", tripId, "U-owner", "Owner", "owner");
  const confirmed = service.importMarkdown(tripId, "- [provisional] 住宿 | 2026-10-01T18:00:00+08:00 | Page | | timezone=Asia/Taipei", { idempotencyKey: "query:confirmed" });
  const pending = service.importMarkdown(tripId, "- [provisional] 晚餐 | 2026-10-02T19:00:00+08:00 | Page | | timezone=Asia/Taipei", { idempotencyKey: "query:pending" });
  service.importMarkdown(tripId, "- [provisional] 早點 | 2026-10-02T03:00:00-07:00 | Page | | timezone=America/Los_Angeles", { idempotencyKey: "query:early" });
  service.confirmProposal(tripId, "U-owner", confirmed.proposalIds[0]);

  const result = service.queryActiveTrip(tripId, "U-member", { date: "2026-10-01", location: "page" });
  assert.deepEqual(result.confirmed.map((item) => item.title), ["住宿"]);
  assert.deepEqual(result.pending, []);
  assert.equal(result.issues.length, 0);
  const pendingResult = service.queryActiveTrip(tripId, "U-member", { pendingOnly: true });
  assert.equal(pendingResult.pending[0]?.title, "早點");
  assert.equal(pendingResult.pending[1]?.id, pending.proposalIds[0]);
  service.updateTripAccessPolicy("system-admin", tripId, { memberCanViewPending: false, memberCanViewReviewIssues: false });
  const hidden = service.queryActiveTrip(tripId, "U-member", {});
  assert.deepEqual(hidden.pending, []);
  assert.deepEqual(hidden.issues, []);
  db.close();
});

test("parses a native LINE mention display name before a Markdown candidate", () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const group = service.createTravelGroup("system-admin", "C-native-mention", "Native mention");
  const trip = service.createActiveTrip("system-admin", group.id, "Native mention trip", "Asia/Taipei");
  service.importMarkdown(trip.id, "@TravelLeaderAgent - [provisional] 住宿 | 2026-10-16 | 台北", { idempotencyKey: "line:native-mention" });
  assert.equal(service.reviewTrip(trip.id).provisional.length, 1);
  db.close();
});

test("imports explicit Point and Route Proposal structure and infers legacy Points", () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const tripId = bootstrapActiveTrip(service, "C-proposal-shapes");
  const result = service.importMarkdown(tripId, [
    "- [provisional] Page 住宿 | 2026-10-01T18:45:00-07:00 | Page | | timezone=America/Phoenix",
    "- [provisional] Las Vegas → St. George | 2026-10-01T12:00:00-07:00 | | 車程約 2 小時 | timezone=America/Los_Angeles | shape=route | origin=Las Vegas | destination=St. George",
  ].join("\n"), { idempotencyKey: "test:proposal-shapes" });

  const lodging = service.getProposal(tripId, result.proposalIds[0]);
  const route = service.getProposal(tripId, result.proposalIds[1]);
  assert.equal(lodging?.shape, "point");
  assert.equal(lodging?.shapeSource, "inferred");
  assert.equal(route?.shape, "route");
  assert.equal(route?.shapeSource, "explicit");
  assert.equal(route?.origin, "Las Vegas");
  assert.equal(route?.destination, "St. George");
  assert.equal(service.reviewTrip(tripId).issues.length, 0);
  db.close();
});

test("retains a Source and Review Issue when a Route Proposal lacks an endpoint", () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const tripId = bootstrapActiveTrip(service, "C-invalid-route");
  const result = service.importMarkdown(tripId, "- [provisional] Las Vegas → St. George | 2026-10-01T12:00:00-07:00 | | | shape=route | origin=Las Vegas", { idempotencyKey: "test:invalid-route" });

  assert.deepEqual(result.proposalIds, []);
  const issues = service.reviewTrip(tripId).issues;
  const routeIssue = issues.find((issue) => issue.code === "missing_route_endpoint");
  assert.ok(routeIssue);
  assert.equal(routeIssue.sourceId, result.sourceId);
  db.close();
});

test("imports multiple Proposal Kinds and reports unknown kinds", () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const tripId = bootstrapActiveTrip(service, "C-proposal-kinds");
  const result = service.importMarkdown(tripId, "- [provisional] Sleeper train to Page | 2026-10-01T22:00:00-07:00 | | onboard dinner | shape=route | origin=Las Vegas | destination=Page | kinds=transport,lodging,meal,spaceship", { idempotencyKey: "test:proposal-kinds" });

  const proposal = service.getProposal(tripId, result.proposalIds[0]);
  assert.deepEqual(proposal?.kinds, ["lodging", "meal", "transport"]);
  assert.equal(proposal?.kind, "transport");
  const issue = service.reviewTrip(tripId).issues.find((candidate) => candidate.code === "unknown_kind");
  assert.ok(issue);
  assert.match(issue.message, /spaceship/);
  db.close();
});

test("enforces non-empty, known, and primary-consistent Proposal Kinds at the service boundary", () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const tripId = bootstrapActiveTrip(service, "C-proposal-kind-validation");
  const source = service.importMarkdown(tripId, "- [provisional] 來源 | 2026-10-16 | 台北", { idempotencyKey: "test:proposal-kind-validation" });
  const base = { shape: "point" as const, shapeSource: "explicit" as const, title: "手動 Proposal", status: "provisional" as const };

  assert.throws(() => service.createProposal(tripId, source.sourceId, { ...base, kind: "lodging", kinds: [] }), InvalidSourceError);
  assert.throws(() => service.createProposal(tripId, source.sourceId, { ...base, kind: "lodging", kinds: ["spaceship"] as never }), InvalidSourceError);
  assert.throws(() => service.createProposal(tripId, source.sourceId, { ...base, kind: "lodging", kinds: ["transport"] }), InvalidSourceError);

  const id = service.createProposal(tripId, source.sourceId, { ...base, kind: "transport", kinds: ["transport", "transport", "meal"] });
  assert.deepEqual(service.getProposal(tripId, id)?.kinds, ["meal", "transport"]);
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

test("bulk import reuses an Import Batch, rejects changed content, and reports invalid lines", () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const tripId = bootstrapActiveTrip(service, "C-bulk-import");
  const markdown = [
    "- [confirmed] 東京住宿 | 2026-10-16 | 東京",
    "- [provisional] 缺少地點 | 2026-10-17 |",
    "- [provisional 東京住宿 | 2026-10-18 | 東京",
  ].join("\n");

  const first = service.importMarkdownBatch(tripId, markdown, "batch-1");
  const replay = service.importMarkdownBatch(tripId, markdown, "batch-1");
  assert.equal(first.outcome, "created");
  assert.equal(replay.outcome, "reused");
  assert.deepEqual(replay.sourceId, first.sourceId);
  assert.deepEqual(replay.proposalIds, first.proposalIds);
  assert.throws(() => service.importMarkdownBatch(tripId, `${markdown}\n- [provisional] 新增 | 2026-10-19 | 東京`, "batch-1"), ConflictError);
  const review = service.reviewTrip(tripId);
  assert.equal(review.provisional.length, 1);
  assert.equal(review.issues.some((issue) => issue.code === "unparseable_line" && issue.sourceLine === 3), true);
  assert.equal(review.issues.some((issue) => issue.code === "missing_location"), true);
  db.close();
});

test("bulk import rejects Sensitive Travel Data before creating a Source", () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const tripId = bootstrapActiveTrip(service, "C-sensitive-import");
  assert.throws(() => service.importMarkdownBatch(tripId, "護照號碼: X12345678", "batch-sensitive"), InvalidSourceError);
  assert.equal(service.reviewTrip(tripId).issues.length, 0);
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

test("confirms a multi-kind Route Proposal into one Trip Item with its structure intact", () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const tripId = bootstrapActiveTrip(service, "C-confirm-structured-route");
  service.addMember("system-admin", tripId, "owner", "Owner", "owner");
  const imported = service.importMarkdown(tripId, "- [provisional] Sleeper train to Page | 2026-10-01T22:00:00-07:00 | | onboard dinner | shape=route | origin=Las Vegas | destination=Page | kinds=transport,lodging,meal", { idempotencyKey: "test:confirm:structured-route" });

  const item = service.confirmProposal(tripId, "owner", imported.proposalIds[0]);

  assert.equal(item.shape, "route");
  assert.equal(item.shapeSource, "explicit");
  assert.equal(item.origin, "Las Vegas");
  assert.equal(item.destination, "Page");
  assert.deepEqual(item.kinds, ["lodging", "meal", "transport"]);
  assert.equal((db.connection.prepare(`SELECT COUNT(*) AS count FROM trip_items WHERE trip_id = ?`).get(tripId) as { count: number }).count, 1);
  assert.equal((db.connection.prepare(`SELECT COUNT(*) AS count FROM trip_item_kinds WHERE trip_item_id = ?`).get(item.id) as { count: number }).count, 3);
  assert.deepEqual(service.reviewTrip(tripId).confirmed.map((confirmed) => confirmed.id), [item.id]);
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

test("an owner resolves mutually exclusive proposals through a Decision", () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const tripId = bootstrapActiveTrip(service, "C-decision-1");
  service.addMember("system-admin", tripId, "owner", "Owner", "owner");
  service.addMember("system-admin", tripId, "member", "Member", "member");
  const imported = service.importMarkdown(tripId, `
- [provisional] Carmel 住宿 | 2026-10-16T15:00:00-07:00 | Carmel
- [provisional] Monterey 住宿 | 2026-10-16T15:00:00-07:00 | Monterey
`, { idempotencyKey: "test:decision:1" });
  const otherTripId = bootstrapActiveTrip(service, "C-decision-2");
  const otherTripProposal = service.importMarkdown(otherTripId, "- [conflicted] 其他旅程住宿 | 2026-10-16T15:00:00-07:00 | Oakland", { idempotencyKey: "test:decision:other-trip" });
  assert.throws(
    () => service.createDecision(tripId, "owner", "跨旅程決策", [imported.proposalIds[0], otherTripProposal.proposalIds[0]]),
    ConflictError,
  );

  const decision = service.createDecision(tripId, "owner", "10/16 住宿地點", imported.proposalIds);
  assert.equal(decision.status, "open");
  assert.throws(() => service.createDecision(tripId, "owner", "重複決策", imported.proposalIds), ConflictError);
  assert.throws(
    () => service.resolveDecision(tripId, "member", decision.id, imported.proposalIds[0]),
    PermissionError,
  );
  assert.throws(() => service.confirmProposal(tripId, "owner", imported.proposalIds[0]), ConflictError);

  const resolved = service.resolveDecision(tripId, "owner", decision.id, imported.proposalIds[0]);
  assert.equal(resolved.decision.status, "resolved");
  assert.equal(resolved.decision.selectedProposalId, imported.proposalIds[0]);
  assert.equal(resolved.decision.resolvedBy, "owner");
  assert.ok(resolved.decision.resolvedAt);
  assert.equal(resolved.item.title, "Carmel 住宿");

  const review = service.reviewTrip(tripId);
  assert.deepEqual(review.confirmed.map((item) => item.title), ["Carmel 住宿"]);
  assert.equal(review.conflicts.length, 0);
  db.close();
});

test("resolves a multi-kind Point Proposal through a Decision into one Trip Item", () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const tripId = bootstrapActiveTrip(service, "C-resolve-multi-kind");
  service.addMember("system-admin", tripId, "owner", "Owner", "owner");
  const imported = service.importMarkdown(tripId, [
    "- [provisional] 車上住宿與晚餐 | 2026-10-16T22:00:00-07:00 | 夜班火車 | | kinds=transport,lodging,meal",
    "- [provisional] 備選住宿 | 2026-10-16T22:00:00-07:00 | Page | | kinds=lodging",
  ].join("\n"), { idempotencyKey: "test:resolve:multi-kind" });
  const decision = service.createDecision(tripId, "owner", "夜班安排", imported.proposalIds);

  const resolved = service.resolveDecision(tripId, "owner", decision.id, imported.proposalIds[0]);

  assert.equal(resolved.item.shape, "point");
  assert.deepEqual(resolved.item.kinds, ["lodging", "meal", "transport"]);
  assert.equal(resolved.item.location, "夜班火車");
  assert.equal((db.connection.prepare(`SELECT COUNT(*) AS count FROM trip_items WHERE trip_id = ?`).get(tripId) as { count: number }).count, 1);
  assert.equal((db.connection.prepare(`SELECT COUNT(*) AS count FROM trip_item_kinds WHERE trip_item_id = ?`).get(resolved.item.id) as { count: number }).count, 3);
  assert.deepEqual(service.reviewTrip(tripId).confirmed.map((item) => item.id), [resolved.item.id]);
  db.close();
});

test("an owner confirms a Replacement Proposal without losing itinerary history", () => {
  const db = new TravelDatabase();
  const service = new TravelService(db, "system-admin");
  const tripId = bootstrapActiveTrip(service, "C-replacement-1");
  service.addMember("system-admin", tripId, "owner", "Owner", "owner");
  const source = service.importMarkdown(tripId, "- [provisional] Carmel 住宿 | 2026-10-16T15:00:00-07:00 | Carmel", { idempotencyKey: "test:replacement:source" });
  const predecessor = service.confirmProposal(tripId, "owner", source.proposalIds[0]);
  const otherTripId = bootstrapActiveTrip(service, "C-replacement-2");
  service.addMember("system-admin", otherTripId, "owner", "Owner", "owner");
  const otherSource = service.importMarkdown(otherTripId, "- [provisional] 其他旅程住宿 | 2026-10-16T15:00:00-07:00 | Oakland", { idempotencyKey: "test:replacement:other-source" });
  const otherPredecessor = service.confirmProposal(otherTripId, "owner", otherSource.proposalIds[0]);
  assert.throws(
    () => service.createReplacementProposal(tripId, otherSource.sourceId, predecessor.id, { kind: "lodging", kinds: ["lodging"], shape: "point", shapeSource: "explicit", title: "跨旅程替代", status: "provisional" }),
    ConflictError,
  );
  assert.throws(
    () => service.createReplacementProposal(tripId, source.sourceId, otherPredecessor.id, { kind: "lodging", kinds: ["lodging"], shape: "point", shapeSource: "explicit", title: "跨旅程替代", status: "provisional" }),
    ConflictError,
  );

  const replacement = service.createReplacementProposal(tripId, source.sourceId, predecessor.id, {
    kind: "lodging",
    kinds: ["lodging"],
    shape: "point",
    shapeSource: "explicit",
    title: "Monterey 住宿",
    status: "provisional",
    startsAt: "2026-10-16T15:00:00-07:00",
    location: "Monterey",
  });
  const successor = service.confirmProposal(tripId, "owner", replacement);

  assert.notEqual(successor.id, predecessor.id);
  assert.equal(successor.title, "Monterey 住宿");
  assert.equal(successor.replacementForItemId, predecessor.id);
  const review = service.reviewTrip(tripId);
  assert.deepEqual(review.confirmed.map((item) => item.title), ["Monterey 住宿"]);
  assert.deepEqual(review.cancelled.map((item) => item.title), ["Carmel 住宿"]);
  assert.equal(review.cancelled[0].status, "cancelled");
  db.close();
});

test("an existing SQLite database gains the replacement relationship column", () => {
  const directory = mkdtempSync(join(tmpdir(), "travel-leader-agent-migration-"));
  const databasePath = join(directory, "travel.sqlite");
  const initial = new TravelDatabase(databasePath);
  initial.connection.exec(`ALTER TABLE trip_items DROP COLUMN replacement_for_item_id`);
  initial.close();

  const upgraded = new TravelDatabase(databasePath);
  const columns = upgraded.connection.prepare(`PRAGMA table_info(trip_items)`).all() as Array<{ name: string }>;
  assert.equal(columns.some((column) => column.name === "replacement_for_item_id"), true);
  upgraded.close();
  rmSync(directory, { recursive: true, force: true });
});

test("an existing SQLite database backfills legacy location Proposals as inferred Points", () => {
  const directory = mkdtempSync(join(tmpdir(), "travel-leader-agent-shape-migration-"));
  const databasePath = join(directory, "travel.sqlite");
  const initial = new TravelDatabase(databasePath);
  const service = new TravelService(initial, "system-admin");
  const tripId = bootstrapActiveTrip(service, "C-shape-migration");
  const imported = service.importMarkdown(tripId, "- [provisional] 舊住宿 | 2026-10-16 | 台北", { idempotencyKey: "migration:shape" });
  initial.connection.prepare(`UPDATE proposals SET shape = NULL, shape_source = NULL WHERE id = ?`).run(imported.proposalIds[0]);
  initial.close();

  const upgraded = new TravelDatabase(databasePath);
  const migrated = new TravelService(upgraded, "system-admin").getProposal(tripId, imported.proposalIds[0]);
  assert.equal(migrated?.shape, "point");
  assert.equal(migrated?.shapeSource, "inferred");
  upgraded.close();
  rmSync(directory, { recursive: true, force: true });
});

test("an existing SQLite database backfills legacy scalar Kinds into normalized associations", () => {
  const directory = mkdtempSync(join(tmpdir(), "travel-leader-agent-kind-migration-"));
  const databasePath = join(directory, "travel.sqlite");
  const initial = new TravelDatabase(databasePath);
  const service = new TravelService(initial, "system-admin");
  const tripId = bootstrapActiveTrip(service, "C-kind-migration");
  service.addMember("system-admin", tripId, "owner", "Owner", "owner");
  const imported = service.importMarkdown(tripId, "- [provisional] 舊住宿 | 2026-10-16 | 台北", { idempotencyKey: "migration:kinds" });
  const confirmed = service.confirmProposal(tripId, "owner", imported.proposalIds[0]);
  initial.connection.exec(`DROP TABLE proposal_kinds; DROP TABLE trip_item_kinds;`);
  initial.close();

  const upgraded = new TravelDatabase(databasePath);
  const migratedService = new TravelService(upgraded, "system-admin");
  assert.deepEqual(migratedService.getProposal(tripId, imported.proposalIds[0])?.kinds, ["lodging"]);
  assert.deepEqual(migratedService.reviewTrip(tripId).confirmed.find((item) => item.id === confirmed.id)?.kinds, ["lodging"]);
  assert.equal(migratedService.getSource(imported.sourceId)?.content, "- [provisional] 舊住宿 | 2026-10-16 | 台北");
  upgraded.close();
  rmSync(directory, { recursive: true, force: true });
});
