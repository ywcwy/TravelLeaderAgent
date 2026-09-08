import assert from "node:assert/strict";
import test from "node:test";
import { TravelDatabase } from "../src/database.ts";
import { ConflictError, PermissionError, TravelService } from "../src/travel-service.ts";

test("markdown creates proposals and only an owner can confirm one", () => {
  const db = new TravelDatabase();
  const service = new TravelService(db);
  const tripId = "trip-1";
  service.addMember(tripId, "owner", "Owner", "owner");
  service.addMember(tripId, "member", "Member", "member");
  const result = service.importMarkdown(tripId, `
- [confirmed] UA 123 航班 | 2026-10-15T09:30:00-07:00 | SFO
- [open_decision] 10/16 住宿：Carmel 或 Monterey | 2026-10-16T15:00:00-07:00 | Monterey
- [conflicted] 租車取車時間不一致 | 2026-10-15T10:30:00-07:00 | SFO
`);

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
  const service = new TravelService(db);
  const tripId = "trip-2";
  service.addMember(tripId, "owner", "Owner", "owner");
  const result = service.importMarkdown(tripId, `
- [provisional] 10/16 住宿：Carmel | 2026-10-16T15:00:00-07:00 | Carmel | 可取消 | timezone=America/Los_Angeles | deadline=2026-10-01T17:00:00-07:00
- [provisional] 10/16 住宿：Monterey | 2026-10-16T15:00:00-07:00 | Monterey | 可取消 | timezone=America/Los_Angeles
- [conflicted] 租車取車時間不一致 |  | SFO
`);

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
