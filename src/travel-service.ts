import { randomUUID } from "node:crypto";
import { TravelDatabase } from "./database.ts";
import type { Decision, ExtractedTripItem, MemberRole, Proposal, ReviewIssue, SourceImportOptions, TravelGroup, Trip, TripItem, TripItemStatus, TripReview } from "./domain.ts";

const now = () => new Date().toISOString();

export class PermissionError extends Error {}
export class NotFoundError extends Error {}
export class ConflictError extends Error {}
export class TripNotActiveError extends Error {}
export class InvalidTimezoneError extends Error {}
export class InvalidSourceError extends Error {}

export class TravelService {
  private readonly db: TravelDatabase;
  private readonly systemAdministratorId: string;

  constructor(db: TravelDatabase, systemAdministratorId: string) {
    this.db = db;
    this.systemAdministratorId = systemAdministratorId;
  }

  createTravelGroup(administratorId: string, lineGroupId: string, displayName: string): TravelGroup {
    this.requireSystemAdministrator(administratorId);
    const existing = this.db.connection.prepare(`SELECT * FROM travel_groups WHERE line_group_id = ?`).get(lineGroupId) as TravelGroupRow | undefined;
    if (existing) return toTravelGroup(existing);

    const travelGroup: TravelGroup = { id: randomUUID(), lineGroupId, displayName };
    this.db.connection.prepare(`INSERT INTO travel_groups (id, line_group_id, display_name, created_at) VALUES (?, ?, ?, ?)`)
      .run(travelGroup.id, travelGroup.lineGroupId, travelGroup.displayName, now());
    return travelGroup;
  }

  createActiveTrip(administratorId: string, travelGroupId: string, title: string, timezone: string): Trip {
    this.requireSystemAdministrator(administratorId);
    if (!isIanaTimezone(timezone)) throw new InvalidTimezoneError(`Trip Timezone ${timezone} is not a valid IANA timezone.`);
    const travelGroup = this.db.connection.prepare(`SELECT id FROM travel_groups WHERE id = ?`).get(travelGroupId);
    if (!travelGroup) throw new NotFoundError(`Travel Group ${travelGroupId} was not found.`);
    const activeTrip = this.db.connection.prepare(`SELECT id FROM trips WHERE travel_group_id = ? AND status = 'active'`).get(travelGroupId);
    if (activeTrip) throw new ConflictError("A Travel Group can have only one Active Trip.");

    const trip: Trip = { id: randomUUID(), travelGroupId, title, timezone, status: "active" };
    this.db.connection.prepare(`INSERT INTO trips (id, travel_group_id, title, timezone, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)`)
      .run(trip.id, trip.travelGroupId, trip.title, trip.timezone, now());
    return trip;
  }

  archiveTrip(administratorId: string, tripId: string): void {
    this.requireSystemAdministrator(administratorId);
    const updated = this.db.connection.prepare(`UPDATE trips SET status = 'archived', archived_at = ? WHERE id = ? AND status = 'active'`)
      .run(now(), tripId);
    if (updated.changes === 0) this.requireTrip(tripId);
  }

  reactivateTrip(administratorId: string, tripId: string): void {
    this.requireSystemAdministrator(administratorId);
    const trip = this.requireTrip(tripId);
    if (trip.status === "active") return;
    const activeTrip = this.db.connection.prepare(`SELECT id FROM trips WHERE travel_group_id = ? AND status = 'active'`).get(trip.travel_group_id);
    if (activeTrip) throw new ConflictError("A Travel Group can have only one Active Trip.");
    this.db.connection.prepare(`UPDATE trips SET status = 'active', archived_at = NULL WHERE id = ?`).run(tripId);
  }

  addMember(administratorId: string, tripId: string, lineUserId: string, displayName: string, role: MemberRole): void {
    this.requireSystemAdministrator(administratorId);
    this.requireTrip(tripId);
    this.db.connection.prepare(`INSERT OR REPLACE INTO members (trip_id, line_user_id, display_name, role, revoked_at) VALUES (?, ?, ?, ?, NULL)`)
      .run(tripId, lineUserId, displayName, role);
  }

  getActiveTripForLineGroup(lineGroupId: string): Trip | null {
    const row = this.db.connection.prepare(`SELECT trips.* FROM trips JOIN travel_groups ON travel_groups.id = trips.travel_group_id WHERE travel_groups.line_group_id = ? AND trips.status = 'active'`).get(lineGroupId) as TripRow | undefined;
    return row ? toTrip(row) : null;
  }

  ensureGroupMember(tripId: string, lineUserId: string, displayName: string): boolean {
    this.requireActiveTrip(tripId);
    const existing = this.db.connection.prepare(`SELECT revoked_at FROM members WHERE trip_id = ? AND line_user_id = ?`).get(tripId, lineUserId) as { revoked_at: string | null } | undefined;
    if (existing?.revoked_at) return false;
    this.db.connection.prepare(`INSERT INTO members (trip_id, line_user_id, display_name, role, revoked_at) VALUES (?, ?, ?, 'member', NULL) ON CONFLICT(trip_id, line_user_id) DO UPDATE SET display_name = excluded.display_name`)
      .run(tripId, lineUserId, displayName);
    return true;
  }

  revokeGroupMember(tripId: string, lineUserId: string): void {
    this.requireTrip(tripId);
    this.db.connection.prepare(`UPDATE members SET revoked_at = ? WHERE trip_id = ? AND line_user_id = ?`).run(now(), tripId, lineUserId);
  }

  isActiveTripMember(tripId: string, lineUserId: string): boolean {
    return Boolean(this.db.connection.prepare(`SELECT 1 FROM members WHERE trip_id = ? AND line_user_id = ? AND revoked_at IS NULL`).get(tripId, lineUserId));
  }

  importMarkdown(tripId: string, markdown: string, options: SourceImportOptions): { sourceId: string; proposalIds: string[] } {
    this.requireActiveTrip(tripId);
    if (!options.idempotencyKey.trim()) throw new InvalidSourceError("A Source Idempotency Key is required.");

    const sourceId = randomUUID();
    this.db.connection.exec("BEGIN");
    try {
      const insert = this.db.connection.prepare(`INSERT OR IGNORE INTO sources (id, trip_id, type, idempotency_key, content, source_time, created_at) VALUES (?, ?, 'markdown', ?, ?, ?, ?)`)
        .run(sourceId, tripId, options.idempotencyKey, markdown, options.sourceTime ?? now(), now());
      const persistedSource = insert.changes === 1
        ? { id: sourceId }
        : this.db.connection.prepare(`SELECT id FROM sources WHERE trip_id = ? AND idempotency_key = ?`).get(tripId, options.idempotencyKey) as { id: string } | undefined;
      if (!persistedSource) throw new InvalidSourceError("The Source could not be persisted.");
      if (insert.changes === 0) {
        this.db.connection.exec("COMMIT");
        return this.getSourceImportResult(persistedSource.id);
      }

      const proposalIds = this.extractMarkdown(markdown).map((item) => this.createProposal(tripId, persistedSource.id, item));
      this.db.connection.exec("COMMIT");
      return { sourceId, proposalIds };
    } catch (error) {
      this.db.connection.exec("ROLLBACK");
      throw error;
    }
  }

  createProposal(tripId: string, sourceId: string, item: ExtractedTripItem): string {
    this.requireActiveTrip(tripId);
    const id = `P-${randomUUID().slice(0, 8).toUpperCase()}`;
    this.db.connection.prepare(`
      INSERT INTO proposals (id, trip_id, source_id, kind, title, item_status, proposal_status, starts_at, ends_at, timezone, location, notes, deadline_at, source_line, source_excerpt, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, tripId, sourceId, item.kind, item.title, item.status, item.startsAt ?? null, item.endsAt ?? null,
      item.timezone ?? null, item.location ?? null, item.notes ?? null, item.deadlineAt ?? null, item.sourceLine ?? null, item.sourceExcerpt ?? null, now());
    return id;
  }

  createReplacementProposal(tripId: string, sourceId: string, predecessorItemId: string, item: ExtractedTripItem): string {
    this.requireActiveTrip(tripId);
    const source = this.db.connection.prepare(`SELECT id FROM sources WHERE id = ? AND trip_id = ?`).get(sourceId, tripId);
    const predecessor = this.db.connection.prepare(`SELECT id FROM trip_items WHERE id = ? AND trip_id = ? AND status = 'confirmed'`).get(predecessorItemId, tripId);
    if (!source || !predecessor) throw new ConflictError("A Replacement Proposal must reference a confirmed Trip Item and Source from the same Active Trip.");
    const id = `P-${randomUUID().slice(0, 8).toUpperCase()}`;
    this.db.connection.prepare(`
      INSERT INTO proposals (id, trip_id, source_id, replacement_for_item_id, kind, title, item_status, proposal_status, starts_at, ends_at, timezone, location, notes, deadline_at, source_line, source_excerpt, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, tripId, sourceId, predecessorItemId, item.kind, item.title, item.status, item.startsAt ?? null, item.endsAt ?? null,
      item.timezone ?? null, item.location ?? null, item.notes ?? null, item.deadlineAt ?? null, item.sourceLine ?? null, item.sourceExcerpt ?? null, now());
    return id;
  }

  createDecision(tripId: string, ownerId: string, title: string, proposalIds: string[]): Decision {
    this.requireActiveTrip(tripId);
    this.requireDecisionOwner(tripId, ownerId);
    const uniqueProposalIds = [...new Set(proposalIds)];
    if (!title.trim() || uniqueProposalIds.length < 2) throw new ConflictError("A Decision requires a title and at least two distinct Proposals.");

    const placeholders = uniqueProposalIds.map(() => "?").join(", ");
    const decision: Decision = { id: `D-${randomUUID().slice(0, 8).toUpperCase()}`, tripId, title, status: "open", selectedProposalId: null, resolvedBy: null, resolvedAt: null };
    this.db.connection.exec("BEGIN IMMEDIATE");
    try {
      const proposals = this.db.connection.prepare(`SELECT id, trip_id, proposal_status, decision_id, replacement_for_item_id FROM proposals WHERE id IN (${placeholders})`).all(...uniqueProposalIds) as unknown as ProposalMembershipRow[];
      if (proposals.length !== uniqueProposalIds.length || proposals.some((proposal) => proposal.trip_id !== tripId || proposal.proposal_status !== "pending" || proposal.decision_id !== null || proposal.replacement_for_item_id !== null)) {
        throw new ConflictError("A Decision can group only unassigned pending Proposals from the same Active Trip.");
      }
      this.db.connection.prepare(`INSERT INTO decisions (id, trip_id, title, status, selected_proposal_id, created_at) VALUES (?, ?, ?, 'open', NULL, ?)`)
        .run(decision.id, tripId, title, now());
      const assigned = this.db.connection.prepare(`UPDATE proposals SET decision_id = ? WHERE id IN (${placeholders}) AND decision_id IS NULL`).run(decision.id, ...uniqueProposalIds);
      if (assigned.changes !== uniqueProposalIds.length) throw new ConflictError("Some Proposals are already assigned to a Decision.");
      this.db.connection.exec("COMMIT");
      return decision;
    } catch (error) {
      this.db.connection.exec("ROLLBACK");
      throw error;
    }
  }

  resolveDecision(tripId: string, ownerId: string, decisionId: string, selectedProposalId: string): { decision: Decision; item: TripItem } {
    this.requireActiveTrip(tripId);
    this.requireDecisionOwner(tripId, ownerId);
    this.db.connection.exec("BEGIN IMMEDIATE");
    try {
      const decision = this.db.connection.prepare(`SELECT * FROM decisions WHERE id = ? AND trip_id = ? AND status = 'open'`).get(decisionId, tripId) as DecisionRow | undefined;
      if (!decision) throw new NotFoundError(`Open Decision ${decisionId} was not found.`);
      const proposal = this.db.connection.prepare(`SELECT * FROM proposals WHERE id = ? AND trip_id = ? AND decision_id = ? AND proposal_status = 'pending'`).get(selectedProposalId, tripId, decisionId) as ProposalRow | undefined;
      if (!proposal) throw new ConflictError("The selected Proposal is not an open option for this Decision.");

      const item: TripItem = {
        id: `T-${randomUUID().slice(0, 8).toUpperCase()}`,
        sourceId: proposal.source_id,
        replacementForItemId: null,
        kind: proposal.kind as TripItem["kind"], title: proposal.title,
        status: "confirmed", startsAt: proposal.starts_at ?? undefined, endsAt: proposal.ends_at ?? undefined,
        timezone: proposal.timezone ?? undefined, location: proposal.location ?? undefined, notes: proposal.notes ?? undefined,
        confirmedBy: ownerId,
      };
      const resolvedAt = now();
      this.db.connection.prepare(`INSERT INTO trip_items (id, trip_id, source_id, replacement_for_item_id, kind, title, status, starts_at, ends_at, timezone, location, notes, confirmed_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(item.id, tripId, item.sourceId, item.replacementForItemId, item.kind, item.title, item.status, item.startsAt ?? null, item.endsAt ?? null, item.timezone ?? null, item.location ?? null, item.notes ?? null, ownerId, resolvedAt);
      this.db.connection.prepare(`UPDATE proposals SET proposal_status = CASE WHEN id = ? THEN 'confirmed' ELSE 'rejected' END WHERE decision_id = ? AND proposal_status = 'pending'`)
        .run(selectedProposalId, decisionId);
      this.db.connection.prepare(`UPDATE decisions SET status = 'resolved', selected_proposal_id = ?, resolved_by = ?, resolved_at = ? WHERE id = ?`)
        .run(selectedProposalId, ownerId, resolvedAt, decisionId);
      this.db.connection.exec("COMMIT");
      return { decision: { id: decision.id, tripId: decision.trip_id, title: decision.title, status: "resolved", selectedProposalId, resolvedBy: ownerId, resolvedAt }, item };
    } catch (error) {
      this.db.connection.exec("ROLLBACK");
      throw error;
    }
  }

  confirmProposal(tripId: string, ownerId: string, proposalId: string): TripItem {
    this.requireActiveTrip(tripId);
    const member = this.db.connection.prepare(`SELECT role, revoked_at FROM members WHERE trip_id = ? AND line_user_id = ?`).get(tripId, ownerId) as { role: MemberRole; revoked_at: string | null } | undefined;
    if (member?.role !== "owner") throw new PermissionError("Only a decision owner can confirm a proposal.");

    this.db.connection.exec("BEGIN IMMEDIATE");
    try {
      const proposal = this.db.connection.prepare(`SELECT * FROM proposals WHERE id = ? AND trip_id = ? AND proposal_status = 'pending'`).get(proposalId, tripId) as ProposalRow | undefined;
      if (!proposal) throw new NotFoundError(`Pending proposal ${proposalId} was not found.`);
      if (proposal.decision_id) throw new ConflictError("A Proposal assigned to a Decision must be confirmed through that Decision.");
      if (proposal.item_status === "conflicted") {
        throw new ConflictError("A conflicted proposal must be resolved before it can be confirmed.");
      }
      const item: TripItem = {
        id: `T-${randomUUID().slice(0, 8).toUpperCase()}`,
        sourceId: proposal.source_id,
        replacementForItemId: proposal.replacement_for_item_id,
        kind: proposal.kind as TripItem["kind"], title: proposal.title,
        status: "confirmed", startsAt: proposal.starts_at ?? undefined, endsAt: proposal.ends_at ?? undefined,
        timezone: proposal.timezone ?? undefined, location: proposal.location ?? undefined, notes: proposal.notes ?? undefined,
        confirmedBy: ownerId,
      };
      if (proposal.replacement_for_item_id) {
        const predecessor = this.db.connection.prepare(`SELECT id FROM trip_items WHERE id = ? AND trip_id = ? AND status = 'confirmed'`).get(proposal.replacement_for_item_id, tripId);
        if (!predecessor) throw new ConflictError("The Replacement Proposal predecessor is no longer confirmed.");
      }
      this.db.connection.prepare(`INSERT INTO trip_items (id, trip_id, source_id, replacement_for_item_id, kind, title, status, starts_at, ends_at, timezone, location, notes, confirmed_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(item.id, tripId, item.sourceId, item.replacementForItemId, item.kind, item.title, item.status, item.startsAt ?? null, item.endsAt ?? null, item.timezone ?? null, item.location ?? null, item.notes ?? null, ownerId, now());
      if (proposal.replacement_for_item_id) {
        this.db.connection.prepare(`UPDATE trip_items SET status = 'cancelled' WHERE id = ? AND trip_id = ? AND status = 'confirmed'`).run(proposal.replacement_for_item_id, tripId);
      }
      this.db.connection.prepare(`UPDATE proposals SET proposal_status = 'confirmed' WHERE id = ?`).run(proposalId);
      this.db.connection.exec("COMMIT");
      return item;
    } catch (error) {
      this.db.connection.exec("ROLLBACK");
      throw error;
    }
  }

  reviewTrip(tripId: string): TripReview {
    const confirmed = this.db.connection.prepare(`SELECT * FROM trip_items WHERE trip_id = ? AND status = 'confirmed' ORDER BY starts_at, title`).all(tripId).map(toTripItem) as TripItem[];
    const cancelled = this.db.connection.prepare(`SELECT * FROM trip_items WHERE trip_id = ? AND status = 'cancelled' ORDER BY starts_at, title`).all(tripId).map(toTripItem) as TripItem[];
    const pending = this.db.connection.prepare(`SELECT * FROM proposals WHERE trip_id = ? AND proposal_status = 'pending' ORDER BY deadline_at, title`).all(tripId) as unknown as ProposalRow[];
    const proposals = pending.map(toProposal);
    const sourceIds = (this.db.connection.prepare(`SELECT id FROM sources WHERE trip_id = ?`).all(tripId) as unknown as Array<{ id: string }>).map((source) => source.id);
    const proposalSourceIds = new Set(
      (this.db.connection.prepare(`SELECT source_id FROM proposals WHERE trip_id = ?`).all(tripId) as unknown as Array<{ source_id: string }>)
        .map((proposal) => proposal.source_id),
    );
    const issues = buildReviewIssues(proposals, confirmed);
    for (const sourceId of sourceIds) {
      if (!proposalSourceIds.has(sourceId)) {
        issues.push({ code: "source_unparsed", message: "Source has no parseable itinerary candidates.", sourceId, proposalIds: [] });
      }
    }
    return {
      confirmed,
      cancelled,
      provisional: proposals.filter((proposal) => proposal.status === "pending" && proposal.itemStatus === "provisional"),
      openDecisions: proposals.filter((proposal) => proposal.status === "pending" && proposal.itemStatus === "open_decision"),
      conflicts: proposals.filter((proposal) => proposal.status === "pending" && proposal.itemStatus === "conflicted"),
      issues,
    };
  }

  private getSourceImportResult(sourceId: string): { sourceId: string; proposalIds: string[] } {
    const proposalIds = (this.db.connection.prepare(`SELECT id FROM proposals WHERE source_id = ? ORDER BY created_at, id`).all(sourceId) as unknown as Array<{ id: string }>).map((proposal) => proposal.id);
    return { sourceId, proposalIds };
  }

  private extractMarkdown(markdown: string): ExtractedTripItem[] {
    return markdown.split(/\r?\n/).flatMap((line, index) => {
      const match = line.match(/^\s*-\s*\[(confirmed|provisional|open_decision|conflicted)\]\s*(.+)$/i);
      if (!match) return [];
      const [, status, body] = match;
      const parts = body.split("|").map((part) => part.trim());
      const [title, startsAt, location, notes, ...metadata] = parts;
      const fields = Object.fromEntries(metadata.flatMap((field) => {
        const separator = field.indexOf("=");
        return separator === -1 ? [] : [[field.slice(0, separator).trim().toLowerCase(), field.slice(separator + 1).trim()]];
      }));
      return [{
        kind: inferKind(title), title, status: status as TripItemStatus,
        startsAt: startsAt || undefined, location: location || undefined, notes: notes || undefined,
        timezone: fields.timezone || undefined, deadlineAt: fields.deadline || undefined,
        sourceLine: index + 1, sourceExcerpt: line.trim(),
      }];
    });
  }

  private requireTrip(tripId: string): TripRow {
    const trip = this.db.connection.prepare(`SELECT * FROM trips WHERE id = ?`).get(tripId) as TripRow | undefined;
    if (!trip) throw new NotFoundError(`Trip ${tripId} was not found.`);
    return trip;
  }

  private requireActiveTrip(tripId: string): TripRow {
    const trip = this.requireTrip(tripId);
    if (trip.status !== "active") throw new TripNotActiveError(`Trip ${tripId} is not active.`);
    return trip;
  }

  private requireSystemAdministrator(administratorId: string): void {
    if (administratorId !== this.systemAdministratorId) {
      throw new PermissionError("Only the System Administrator can change the Trip lifecycle.");
    }
  }

  private requireDecisionOwner(tripId: string, ownerId: string): void {
    const member = this.db.connection.prepare(`SELECT role, revoked_at FROM members WHERE trip_id = ? AND line_user_id = ?`).get(tripId, ownerId) as { role: MemberRole; revoked_at: string | null } | undefined;
    if (member?.role !== "owner") throw new PermissionError("Only a Decision Owner can manage a Decision.");
  }
}

interface TravelGroupRow {
  id: string; line_group_id: string; display_name: string;
}

interface TripRow {
  id: string; travel_group_id: string; title: string; timezone: string; status: "active" | "archived";
}

function toTrip(row: TripRow): Trip {
  return { id: row.id, travelGroupId: row.travel_group_id, title: row.title, timezone: row.timezone, status: row.status };
}

interface ProposalRow {
  id: string; source_id: string; replacement_for_item_id: string | null; kind: string; title: string; item_status: TripItemStatus; decision_id: string | null;
  starts_at: string | null; ends_at: string | null; timezone: string | null; location: string | null; notes: string | null; deadline_at: string | null; source_line: number | null; source_excerpt: string | null;
}

interface ProposalMembershipRow {
  id: string; trip_id: string; proposal_status: "pending" | "confirmed" | "rejected"; decision_id: string | null; replacement_for_item_id: string | null;
}

interface DecisionRow {
  id: string; trip_id: string; title: string; status: "open" | "resolved"; selected_proposal_id: string | null;
}

function toProposal(row: ProposalRow): Proposal {
  return { id: row.id, sourceId: row.source_id, replacementForItemId: row.replacement_for_item_id, kind: row.kind as Proposal["kind"], title: row.title, itemStatus: row.item_status, status: "pending", startsAt: row.starts_at ?? undefined, endsAt: row.ends_at ?? undefined, timezone: row.timezone ?? undefined, location: row.location ?? undefined, notes: row.notes ?? undefined, deadlineAt: row.deadline_at, sourceLine: row.source_line ?? undefined, sourceExcerpt: row.source_excerpt ?? undefined };
}

function toTravelGroup(row: TravelGroupRow): TravelGroup {
  return { id: row.id, lineGroupId: row.line_group_id, displayName: row.display_name };
}

function toTripItem(row: Record<string, unknown>): TripItem {
  return { id: row.id as string, sourceId: row.source_id as string, replacementForItemId: (row.replacement_for_item_id as string) ?? null, kind: row.kind as TripItem["kind"], title: row.title as string, status: row.status as TripItemStatus, startsAt: (row.starts_at as string) ?? undefined, endsAt: (row.ends_at as string) ?? undefined, timezone: (row.timezone as string) ?? undefined, location: (row.location as string) ?? undefined, notes: (row.notes as string) ?? undefined, confirmedBy: (row.confirmed_by as string) ?? null };
}

function inferKind(title: string): TripItem["kind"] {
  const lower = title.toLowerCase();
  if (/flight|航班|飛機/.test(lower)) return "flight";
  if (/hotel|住宿|飯店|住 /.test(lower)) return "lodging";
  if (/car|租車|還車/.test(lower)) return "rental_car";
  if (/tour|ticket|活動|門票|預約/.test(lower)) return "activity";
  if (/train|bus|交通|接駁/.test(lower)) return "transport";
  if (/meet|集合/.test(lower)) return "meeting";
  return "other";
}

function isIanaTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

function buildReviewIssues(proposals: Proposal[], confirmed: TripItem[]): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  for (const proposal of proposals) {
    if (!proposal.startsAt) issues.push({ code: "missing_start_time", message: `「${proposal.title}」缺少開始時間。`, proposalIds: [proposal.id] });
    if (proposal.startsAt && !proposal.timezone) issues.push({ code: "missing_timezone", message: `「${proposal.title}」有時間但缺少 IANA timezone。`, proposalIds: [proposal.id] });
    if (!proposal.location) issues.push({ code: "missing_location", message: `「${proposal.title}」缺少地點。`, proposalIds: [proposal.id] });
  }
  const scheduled = [...proposals.filter((proposal) => proposal.startsAt), ...confirmed];
  for (let i = 0; i < scheduled.length; i += 1) {
    for (let j = i + 1; j < scheduled.length; j += 1) {
      const left = scheduled[i];
      const right = scheduled[j];
      if (left.kind === right.kind && left.startsAt === right.startsAt && left.location !== right.location) {
        issues.push({ code: "schedule_collision", message: `「${left.title}」與「${right.title}」在同一時間有互斥安排。`, proposalIds: [left.id, right.id] });
      }
    }
  }
  return issues;
}
