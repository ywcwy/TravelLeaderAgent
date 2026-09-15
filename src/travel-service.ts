import { randomUUID } from "node:crypto";
import { TravelDatabase } from "./database.ts";
import type { Decision, ExtractedTripItem, MemberRole, Proposal, ProposalContext, ProposalShape, ProposalShapeSource, ReviewIssue, Source, SourceImportOptions, TravelGroup, Trip, TripItem, TripItemKind, TripItemStatus, TripReview } from "./domain.ts";

const now = () => new Date().toISOString();

export class PermissionError extends Error {}
export class NotFoundError extends Error {}
export class ConflictError extends Error {}
export class TripNotActiveError extends Error {}
export class InvalidTimezoneError extends Error {}
export class InvalidSourceError extends Error {}

export interface TripResetOptions {
  title?: string;
  timezone?: string;
}

export interface TripResetResult {
  archivedTrip: Trip;
  activeTrip: Trip;
  copiedMemberCount: number;
}

export interface MarkdownImportResult {
  sourceId: string;
  proposalIds: string[];
  outcome: "created" | "reused";
}

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

  resetActiveTrip(administratorId: string, tripId: string, options: TripResetOptions = {}): TripResetResult {
    this.requireSystemAdministrator(administratorId);
    const current = this.requireActiveTrip(tripId);
    const title = options.title?.trim() || current.title;
    const timezone = options.timezone?.trim() || current.timezone;
    if (!title) throw new ConflictError("A Trip title is required.");
    if (!isIanaTimezone(timezone)) throw new InvalidTimezoneError(`Trip Timezone ${timezone} is not a valid IANA timezone.`);

    const archivedTrip: Trip = { ...toTrip(current), status: "archived" };
    const activeTrip: Trip = { id: randomUUID(), travelGroupId: current.travel_group_id, title, timezone, status: "active" };
    this.db.connection.exec("BEGIN IMMEDIATE");
    try {
      const members = this.db.connection.prepare(`SELECT line_user_id, display_name, role FROM members WHERE trip_id = ? AND revoked_at IS NULL`).all(tripId) as Array<{ line_user_id: string; display_name: string; role: MemberRole }>;
      const archived = this.db.connection.prepare(`UPDATE trips SET status = 'archived', archived_at = ? WHERE id = ? AND status = 'active'`).run(now(), tripId);
      if (archived.changes !== 1) throw new TripNotActiveError(`Trip ${tripId} is not active.`);
      this.db.connection.prepare(`INSERT INTO trips (id, travel_group_id, title, timezone, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)`).run(activeTrip.id, activeTrip.travelGroupId, activeTrip.title, activeTrip.timezone, now());
      const insertMember = this.db.connection.prepare(`INSERT INTO members (trip_id, line_user_id, display_name, role, revoked_at) VALUES (?, ?, ?, ?, NULL)`);
      for (const member of members) insertMember.run(activeTrip.id, member.line_user_id, member.display_name, member.role);
      this.db.connection.exec("COMMIT");
      return { archivedTrip, activeTrip, copiedMemberCount: members.length };
    } catch (error) {
      this.db.connection.exec("ROLLBACK");
      throw error;
    }
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

  getTrip(tripId: string): Trip | null {
    const row = this.db.connection.prepare(`SELECT * FROM trips WHERE id = ?`).get(tripId) as TripRow | undefined;
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
      const provenance = options.provenance;
      const insert = this.db.connection.prepare(`INSERT OR IGNORE INTO sources (id, trip_id, type, idempotency_key, content, source_time, provider, provider_message_id, provider_group_id, provider_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(sourceId, tripId, options.type ?? "markdown", options.idempotencyKey, markdown, options.sourceTime ?? now(), provenance?.provider ?? null, provenance?.messageId ?? null, provenance?.groupId ?? null, provenance?.userId ?? null, now());
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

  importMarkdownBatch(tripId: string, markdown: string, importBatchId: string): MarkdownImportResult {
    this.requireActiveTrip(tripId);
    const batchId = importBatchId.trim();
    if (!batchId) throw new InvalidSourceError("An Import Batch ID is required.");
    if (containsSensitiveTravelData(markdown)) throw new InvalidSourceError("Sensitive Travel Data must be removed before importing this Source.");
    const existing = this.db.connection.prepare(`SELECT id, content FROM sources WHERE trip_id = ? AND idempotency_key = ?`).get(tripId, batchId) as { id: string; content: string } | undefined;
    if (existing) {
      if (existing.content !== markdown) throw new ConflictError(`Import Batch ${batchId} already contains different content.`);
      const replay = this.getSourceImportResult(existing.id);
      return { ...replay, outcome: "reused" };
    }
    const created = this.importMarkdown(tripId, markdown, { idempotencyKey: batchId, type: "markdown" });
    return { ...created, outcome: "created" };
  }

  getSource(sourceId: string): Source | null {
    const row = this.db.connection.prepare(`SELECT * FROM sources WHERE id = ?`).get(sourceId) as SourceRow | undefined;
    if (!row) return null;
    return { id: row.id, tripId: row.trip_id, type: row.type, idempotencyKey: row.idempotency_key, content: row.content, sourceTime: row.source_time,
      provenance: row.provider ? { provider: row.provider, messageId: row.provider_message_id ?? "", ...(row.provider_group_id ? { groupId: row.provider_group_id } : {}), ...(row.provider_user_id ? { userId: row.provider_user_id } : {}) } : null };
  }

  createProposal(tripId: string, sourceId: string, item: ExtractedTripItem): string {
    this.requireActiveTrip(tripId);
    const kinds = canonicalizeKinds(item.kind, item.kinds);
    const id = `P-${randomUUID().slice(0, 8).toUpperCase()}`;
    this.db.connection.prepare(`
      INSERT INTO proposals (id, trip_id, source_id, kind, shape, shape_source, origin, destination, title, item_status, proposal_status, starts_at, ends_at, timezone, location, notes, deadline_at, source_line, source_excerpt, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, tripId, sourceId, item.kind, item.shape, item.shapeSource, item.origin ?? null, item.destination ?? null, item.title, item.status, item.startsAt ?? null, item.endsAt ?? null,
      item.timezone ?? null, item.location ?? null, item.notes ?? null, item.deadlineAt ?? null, item.sourceLine ?? null, item.sourceExcerpt ?? null, now());
    const insertKind = this.db.connection.prepare(`INSERT OR IGNORE INTO proposal_kinds (proposal_id, kind) VALUES (?, ?)`);
    for (const kind of kinds) insertKind.run(id, kind);
    return id;
  }

  getProposal(tripId: string, proposalId: string): Proposal | null {
    const row = this.db.connection.prepare(`SELECT * FROM proposals WHERE trip_id = ? AND id = ?`).get(tripId, proposalId) as ProposalRow | undefined;
    return row ? this.hydrateProposal(row) : null;
  }

  getProposalContext(tripId: string, proposalId: string): ProposalContext | null {
    const proposal = this.getProposal(tripId, proposalId);
    if (!proposal) return null;
    const trip = this.requireTrip(tripId);
    const confirmed = (this.db.connection.prepare(`SELECT * FROM trip_items WHERE trip_id = ? AND status = 'confirmed'`).all(tripId) as Array<Record<string, unknown>>)
      .map((row) => this.hydrateTripItem(row))
      .filter((item) => item.kinds.some((kind) => proposal.kinds.includes(kind)))
      .filter((item) => isSameDateOrOverlapping(proposal, item, trip.timezone));
    const overlappingConfirmed = confirmed.filter((item) => hasTimeOverlap(proposal, item));
    const pending = (this.db.connection.prepare(`SELECT * FROM proposals WHERE trip_id = ? AND proposal_status = 'pending' AND id <> ?`).all(tripId, proposalId) as unknown as ProposalRow[])
      .map((row) => this.hydrateProposal(row))
      .filter((item) => item.kinds.some((kind) => proposal.kinds.includes(kind)))
      .filter((item) => isSameDateOrOverlapping(proposal, item, trip.timezone));
    return { proposal, confirmed, overlappingConfirmed, pending };
  }

  createReplacementProposal(tripId: string, sourceId: string, predecessorItemId: string, item: ExtractedTripItem): string {
    this.requireActiveTrip(tripId);
    const kinds = canonicalizeKinds(item.kind, item.kinds);
    const source = this.db.connection.prepare(`SELECT id FROM sources WHERE id = ? AND trip_id = ?`).get(sourceId, tripId);
    const predecessor = this.db.connection.prepare(`SELECT id FROM trip_items WHERE id = ? AND trip_id = ? AND status = 'confirmed'`).get(predecessorItemId, tripId);
    if (!source || !predecessor) throw new ConflictError("A Replacement Proposal must reference a confirmed Trip Item and Source from the same Active Trip.");
    const id = `P-${randomUUID().slice(0, 8).toUpperCase()}`;
    this.db.connection.prepare(`
      INSERT INTO proposals (id, trip_id, source_id, replacement_for_item_id, kind, shape, shape_source, origin, destination, title, item_status, proposal_status, starts_at, ends_at, timezone, location, notes, deadline_at, source_line, source_excerpt, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, tripId, sourceId, predecessorItemId, item.kind, item.shape, item.shapeSource, item.origin ?? null, item.destination ?? null, item.title, item.status, item.startsAt ?? null, item.endsAt ?? null,
      item.timezone ?? null, item.location ?? null, item.notes ?? null, item.deadlineAt ?? null, item.sourceLine ?? null, item.sourceExcerpt ?? null, now());
    const insertKind = this.db.connection.prepare(`INSERT OR IGNORE INTO proposal_kinds (proposal_id, kind) VALUES (?, ?)`);
    for (const kind of kinds) insertKind.run(id, kind);
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
      const kinds = this.getProposalKinds(proposal.id);

      const item: TripItem = {
        id: `T-${randomUUID().slice(0, 8).toUpperCase()}`,
        sourceId: proposal.source_id,
        replacementForItemId: null,
        kind: proposal.kind as TripItem["kind"], kinds, shape: proposal.shape ?? "point", shapeSource: proposal.shape_source ?? "inferred", origin: proposal.origin ?? undefined, destination: proposal.destination ?? undefined, title: proposal.title,
        status: "confirmed", startsAt: proposal.starts_at ?? undefined, endsAt: proposal.ends_at ?? undefined,
        timezone: proposal.timezone ?? undefined, location: proposal.location ?? undefined, notes: proposal.notes ?? undefined,
        confirmedBy: ownerId,
      };
      const resolvedAt = now();
      this.db.connection.prepare(`INSERT INTO trip_items (id, trip_id, source_id, replacement_for_item_id, kind, shape, shape_source, origin, destination, title, status, starts_at, ends_at, timezone, location, notes, confirmed_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(item.id, tripId, item.sourceId, item.replacementForItemId, item.kind, item.shape, item.shapeSource, item.origin ?? null, item.destination ?? null, item.title, item.status, item.startsAt ?? null, item.endsAt ?? null, item.timezone ?? null, item.location ?? null, item.notes ?? null, ownerId, resolvedAt);
      const insertKind = this.db.connection.prepare(`INSERT OR IGNORE INTO trip_item_kinds (trip_item_id, kind) VALUES (?, ?)`);
      for (const kind of item.kinds) insertKind.run(item.id, kind);
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
      const kinds = this.getProposalKinds(proposal.id);
      const item: TripItem = {
        id: `T-${randomUUID().slice(0, 8).toUpperCase()}`,
        sourceId: proposal.source_id,
        replacementForItemId: proposal.replacement_for_item_id,
        kind: proposal.kind as TripItem["kind"], kinds, shape: proposal.shape ?? "point", shapeSource: proposal.shape_source ?? "inferred", origin: proposal.origin ?? undefined, destination: proposal.destination ?? undefined, title: proposal.title,
        status: "confirmed", startsAt: proposal.starts_at ?? undefined, endsAt: proposal.ends_at ?? undefined,
        timezone: proposal.timezone ?? undefined, location: proposal.location ?? undefined, notes: proposal.notes ?? undefined,
        confirmedBy: ownerId,
      };
      if (proposal.replacement_for_item_id) {
        const predecessor = this.db.connection.prepare(`SELECT id FROM trip_items WHERE id = ? AND trip_id = ? AND status = 'confirmed'`).get(proposal.replacement_for_item_id, tripId);
        if (!predecessor) throw new ConflictError("The Replacement Proposal predecessor is no longer confirmed.");
      }
      this.db.connection.prepare(`INSERT INTO trip_items (id, trip_id, source_id, replacement_for_item_id, kind, shape, shape_source, origin, destination, title, status, starts_at, ends_at, timezone, location, notes, confirmed_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(item.id, tripId, item.sourceId, item.replacementForItemId, item.kind, item.shape, item.shapeSource, item.origin ?? null, item.destination ?? null, item.title, item.status, item.startsAt ?? null, item.endsAt ?? null, item.timezone ?? null, item.location ?? null, item.notes ?? null, ownerId, now());
      const insertKind = this.db.connection.prepare(`INSERT OR IGNORE INTO trip_item_kinds (trip_item_id, kind) VALUES (?, ?)`);
      for (const kind of item.kinds) insertKind.run(item.id, kind);
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
    const confirmed = this.db.connection.prepare(`SELECT * FROM trip_items WHERE trip_id = ? AND status = 'confirmed' ORDER BY starts_at, title`).all(tripId).map((row) => this.hydrateTripItem(row)) as TripItem[];
    const cancelled = this.db.connection.prepare(`SELECT * FROM trip_items WHERE trip_id = ? AND status = 'cancelled' ORDER BY starts_at, title`).all(tripId).map((row) => this.hydrateTripItem(row)) as TripItem[];
    const pending = this.db.connection.prepare(`SELECT * FROM proposals WHERE trip_id = ? AND proposal_status = 'pending' ORDER BY deadline_at, title`).all(tripId) as unknown as ProposalRow[];
    const proposals = pending.map((row) => this.hydrateProposal(row));
    const sources = this.db.connection.prepare(`SELECT id, content FROM sources WHERE trip_id = ?`).all(tripId) as Array<{ id: string; content: string }>;
    const sourceIds = sources.map((source) => source.id);
    const proposalSourceIds = new Set(
      (this.db.connection.prepare(`SELECT source_id FROM proposals WHERE trip_id = ?`).all(tripId) as unknown as Array<{ source_id: string }>)
        .map((proposal) => proposal.source_id),
    );
    const issues = buildReviewIssues(proposals, confirmed);
    for (const source of sources) {
      for (const issue of findUnparseableLineIssues(source.id, source.content)) issues.push(issue);
      const sourceId = source.id;
      if (!proposalSourceIds.has(sourceId)) {
        issues.push({ code: "source_unparsed", message: "Source has no parseable itinerary candidates.", sourceId, proposalIds: [] });
      }
    }
    return {
      confirmed,
      cancelled,
      pending: proposals,
      provisional: proposals.filter((proposal) => proposal.status === "pending" && proposal.itemStatus === "provisional"),
      openDecisions: proposals.filter((proposal) => proposal.status === "pending" && proposal.itemStatus === "open_decision"),
      conflicts: proposals.filter((proposal) => proposal.status === "pending" && proposal.itemStatus === "conflicted"),
      issues,
    };
  }

  private getSourceImportResult(sourceId: string): { sourceId: string; proposalIds: string[] } {
    const proposalIds = (this.db.connection.prepare(`SELECT id FROM proposals WHERE source_id = ? ORDER BY source_line, id`).all(sourceId) as unknown as Array<{ id: string }>).map((proposal) => proposal.id);
    return { sourceId, proposalIds };
  }

  private hydrateProposal(row: ProposalRow): Proposal {
    return toProposal(row, this.getProposalKinds(row.id));
  }

  private hydrateTripItem(row: Record<string, unknown>): TripItem {
    return toTripItem(row, this.getTripItemKinds(row.id as string));
  }

  private getProposalKinds(proposalId: string): TripItemKind[] {
    return (this.db.connection.prepare(`SELECT kind FROM proposal_kinds WHERE proposal_id = ? ORDER BY kind`).all(proposalId) as Array<{ kind: TripItemKind }>).map((row) => row.kind);
  }

  private getTripItemKinds(tripItemId: string): TripItemKind[] {
    return (this.db.connection.prepare(`SELECT kind FROM trip_item_kinds WHERE trip_item_id = ? ORDER BY kind`).all(tripItemId) as Array<{ kind: TripItemKind }>).map((row) => row.kind);
  }

  private extractMarkdown(markdown: string): ExtractedTripItem[] {
    return markdown.split(/\r?\n/).flatMap((line, index) => {
      const parsed = parseMarkdownCandidate(line, index + 1);
      return parsed.item ? [parsed.item] : [];
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

interface SourceRow { id: string; trip_id: string; type: string; idempotency_key: string; content: string; source_time: string; provider: string | null; provider_message_id: string | null; provider_group_id: string | null; provider_user_id: string | null; }

interface TripRow {
  id: string; travel_group_id: string; title: string; timezone: string; status: "active" | "archived";
}

function toTrip(row: TripRow): Trip {
  return { id: row.id, travelGroupId: row.travel_group_id, title: row.title, timezone: row.timezone, status: row.status };
}

interface ProposalRow {
  id: string; source_id: string; replacement_for_item_id: string | null; kind: string; shape: ProposalShape | null; shape_source: ProposalShapeSource | null; origin: string | null; destination: string | null; title: string; item_status: TripItemStatus; decision_id: string | null;
  starts_at: string | null; ends_at: string | null; timezone: string | null; location: string | null; notes: string | null; deadline_at: string | null; source_line: number | null; source_excerpt: string | null;
}

interface ProposalMembershipRow {
  id: string; trip_id: string; proposal_status: "pending" | "confirmed" | "rejected"; decision_id: string | null; replacement_for_item_id: string | null;
}

interface DecisionRow {
  id: string; trip_id: string; title: string; status: "open" | "resolved"; selected_proposal_id: string | null;
}

function toProposal(row: ProposalRow, kinds = [row.kind as Proposal["kind"]]): Proposal {
  const shape = row.shape ?? (row.location ? "point" : "point");
  return { id: row.id, sourceId: row.source_id, replacementForItemId: row.replacement_for_item_id, kind: row.kind as Proposal["kind"], kinds, shape, shapeSource: row.shape_source ?? "inferred", origin: row.origin ?? undefined, destination: row.destination ?? undefined, title: row.title, itemStatus: row.item_status, status: "pending", startsAt: row.starts_at ?? undefined, endsAt: row.ends_at ?? undefined, timezone: row.timezone ?? undefined, location: row.location ?? undefined, notes: row.notes ?? undefined, deadlineAt: row.deadline_at, sourceLine: row.source_line ?? undefined, sourceExcerpt: row.source_excerpt ?? undefined };
}

function toTravelGroup(row: TravelGroupRow): TravelGroup {
  return { id: row.id, lineGroupId: row.line_group_id, displayName: row.display_name };
}

function toTripItem(row: Record<string, unknown>, kinds = [row.kind as TripItem["kind"]]): TripItem {
  return { id: row.id as string, sourceId: row.source_id as string, replacementForItemId: (row.replacement_for_item_id as string) ?? null, kind: row.kind as TripItem["kind"], kinds, shape: (row.shape as ProposalShape | null) ?? "point", shapeSource: (row.shape_source as ProposalShapeSource | null) ?? "inferred", origin: (row.origin as string) ?? undefined, destination: (row.destination as string) ?? undefined, title: row.title as string, status: row.status as TripItemStatus, startsAt: (row.starts_at as string) ?? undefined, endsAt: (row.ends_at as string) ?? undefined, timezone: (row.timezone as string) ?? undefined, location: (row.location as string) ?? undefined, notes: (row.notes as string) ?? undefined, confirmedBy: (row.confirmed_by as string) ?? null };
}

const canonicalTripItemKinds = new Set<TripItemKind>(["flight", "lodging", "rental_car", "transport", "meal", "activity", "shopping", "meeting", "other"]);

function canonicalizeKinds(primaryKind: TripItemKind, kinds: TripItemKind[]): TripItemKind[] {
  if (!Array.isArray(kinds) || kinds.length === 0) {
    throw new InvalidSourceError("A Proposal must have at least one Kind.");
  }
  const uniqueKinds = [...new Set(kinds)];
  const unknownKind = uniqueKinds.find((kind) => !canonicalTripItemKinds.has(kind));
  if (unknownKind) throw new InvalidSourceError(`Unsupported Proposal Kind: ${String(unknownKind)}.`);
  if (!canonicalTripItemKinds.has(primaryKind) || !uniqueKinds.includes(primaryKind)) {
    throw new InvalidSourceError("The primary Proposal Kind must be included in its Kinds.");
  }
  return uniqueKinds;
}

function inferKinds(title: string): TripItem["kind"][] {
  const lower = title.toLowerCase();
  const kinds: TripItem["kind"][] = [];
  if (/flight|航班|飛機/.test(lower)) kinds.push("flight");
  if (/hotel|住宿|飯店|住 /.test(lower)) kinds.push("lodging");
  if (/car|租車|還車/.test(lower)) kinds.push("rental_car");
  if (/train|bus|交通|接駁|開車/.test(lower)) kinds.push("transport");
  if (/breakfast|lunch|dinner|meal|早餐|午餐|晚餐|餐/.test(lower)) kinds.push("meal");
  if (/tour|ticket|活動|門票|預約/.test(lower)) kinds.push("activity");
  if (/shopping|supermarket|walmart|safeway|採買|購物|超市/.test(lower)) kinds.push("shopping");
  if (/meet|集合/.test(lower)) kinds.push("meeting");
  return kinds.length > 0 ? [...new Set(kinds)] : ["other"];
}

interface ParsedMarkdownCandidate {
  item?: ExtractedTripItem;
  issue?: Pick<ReviewIssue, "code" | "message">;
  issues?: Array<Pick<ReviewIssue, "code" | "message">>;
}

function parseMarkdownCandidate(line: string, sourceLine: number): ParsedMarkdownCandidate {
  const match = line.match(/^\s*(?:@[^-]*?\s+)?-\s*\[(confirmed|provisional|open_decision|conflicted)\]\s*(.+)$/i);
  if (!match) return {};
  const [, status, body] = match;
  const parts = body.split("|").map((part) => part.trim());
  const [title, startsAt, location, notes, ...metadata] = parts;
  const fields = Object.fromEntries(metadata.flatMap((field) => {
    const separator = field.indexOf("=");
    return separator === -1 ? [] : [[field.slice(0, separator).trim().toLowerCase(), field.slice(separator + 1).trim()]];
  }));
  const explicitShape = fields.shape?.toLowerCase();
  const routeParts = title.split(/\s*(?:→|->)\s*/).map((part) => part.trim()).filter(Boolean);
  const routeLike = routeParts.length > 1 || Boolean(fields.origin) || Boolean(fields.destination);
  if (explicitShape && explicitShape !== "point" && explicitShape !== "route") {
    return { issue: { code: "shape_conflict", message: `第 ${sourceLine} 行的 Proposal Shape 不支援：${explicitShape}。` } };
  }
  if (explicitShape === "point" && routeLike) {
    return { issue: { code: "shape_conflict", message: `第 ${sourceLine} 行的內容是路線，但 Proposal Shape 指定為 point。` } };
  }
  const shape = (explicitShape as ProposalShape | undefined) ?? (routeLike ? "route" : "point");
  const shapeSource: ProposalShapeSource = explicitShape ? "explicit" : "inferred";
  const hasExplicitEndpoint = Boolean(fields.origin || fields.destination);
  const origin = fields.origin || (!hasExplicitEndpoint && shape === "route" && routeParts.length === 2 ? routeParts[0] : undefined);
  const destination = fields.destination || (!hasExplicitEndpoint && shape === "route" && routeParts.length === 2 ? routeParts[1] : undefined);
  if (shape === "route" && (!origin || !destination)) {
    return { issue: { code: "missing_route_endpoint", message: `第 ${sourceLine} 行的 Route Proposal 缺少起點或終點。` } };
  }
  const hasExplicitKinds = Boolean(fields.kinds);
  const parsedKinds = hasExplicitKinds ? fields.kinds.split(",").map((kind) => kind.trim()).filter(Boolean) : inferKinds(title);
  const knownKinds = canonicalTripItemKinds;
  const unknownKinds = parsedKinds.filter((kind) => !knownKinds.has(kind as TripItem["kind"]));
  const kinds = parsedKinds.filter((kind): kind is TripItem["kind"] => knownKinds.has(kind as TripItem["kind"]));
  if (kinds.length === 0) kinds.push("other");
  if (!hasExplicitKinds && shape === "route" && kinds.length === 1 && kinds[0] === "other") kinds[0] = "transport";
  const issues: Array<Pick<ReviewIssue, "code" | "message">> = unknownKinds.length > 0
    ? [{ code: "unknown_kind", message: `第 ${sourceLine} 行包含未知 Proposal Kind：${unknownKinds.join(", ")}。` }]
    : [];
  if (!hasExplicitKinds && kinds.length === 1 && kinds[0] === "other") {
    issues.push({ code: "kind_clarification", message: `第 ${sourceLine} 行無法可靠判斷 Proposal Kind，請補充分類。` });
  }
  return {
    item: {
      kind: kinds[0], kinds, shape, shapeSource, title, status: status as TripItemStatus,
      startsAt: startsAt || undefined, location: location || undefined, origin, destination,
      notes: notes || undefined, timezone: fields.timezone || undefined, deadlineAt: fields.deadline || undefined,
      sourceLine, sourceExcerpt: line.trim(),
    },
    issues,
  };
}

function isIanaTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

function containsSensitiveTravelData(markdown: string): boolean {
  return /(?:護照(?:號碼|号码)?|passport(?:\s*(?:number|no\.?))?)\s*[:：#-]?\s*[A-Z0-9]{6,}/i.test(markdown)
    || /(?:信用卡|credit\s*card|card\s*number|卡號)\s*[:：#-]?\s*\d[\d -]{7,}/i.test(markdown);
}

function findUnparseableLineIssues(sourceId: string, markdown: string): ReviewIssue[] {
  return markdown.split(/\r?\n/).flatMap((line, index) => {
    if (!/^\s*-\s*\[/.test(line)) return [];
    const parsed = parseMarkdownCandidate(line, index + 1);
    if (parsed.issue) return [{ ...parsed.issue, sourceId, sourceLine: index + 1, sourceExcerpt: line.trim(), proposalIds: [] }];
    if (parsed.issues?.length) return parsed.issues.map((issue) => ({ ...issue, sourceId, sourceLine: index + 1, sourceExcerpt: line.trim(), proposalIds: [] }));
    if (parsed.item) return [];
    return [{ code: "unparseable_line" as const, message: `第 ${index + 1} 行無法解析為有效行程候選。`, sourceId, sourceLine: index + 1, sourceExcerpt: line.trim(), proposalIds: [] }];
  });
}

type ScheduledItem = Pick<ExtractedTripItem, "startsAt" | "endsAt">;

function isSameDateOrOverlapping(left: ScheduledItem, right: ScheduledItem, tripTimezone: string): boolean {
  if (dateKey(left.startsAt, tripTimezone) === dateKey(right.startsAt, tripTimezone)) return true;
  return hasTimeOverlap(left, right);
}

function hasTimeOverlap(left: ScheduledItem, right: ScheduledItem): boolean {
  if (!left.startsAt || !right.startsAt || isDateOnly(left.startsAt) || isDateOnly(right.startsAt)) return false;
  const leftStart = Date.parse(left.startsAt);
  const rightStart = Date.parse(right.startsAt);
  if (Number.isNaN(leftStart) || Number.isNaN(rightStart)) return false;
  const leftEnd = left.endsAt ? Date.parse(left.endsAt) : leftStart;
  const rightEnd = right.endsAt ? Date.parse(right.endsAt) : rightStart;
  if ([leftEnd, rightEnd].some(Number.isNaN)) return false;
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

function dateKey(value: string | undefined, tripTimezone: string): string | null {
  if (!value) return null;
  if (isDateOnly(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: tripTimezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(parsed);
}

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function buildReviewIssues(proposals: Proposal[], confirmed: TripItem[]): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  for (const proposal of proposals) {
    if (!proposal.startsAt) issues.push({ code: "missing_start_time", message: `「${proposal.title}」缺少開始時間。`, proposalIds: [proposal.id] });
    if (proposal.startsAt && !proposal.timezone) issues.push({ code: "missing_timezone", message: `「${proposal.title}」有時間但缺少 IANA timezone。`, proposalIds: [proposal.id] });
    if (proposal.shape === "point" && !proposal.location) issues.push({ code: "missing_location", message: `「${proposal.title}」缺少地點。`, proposalIds: [proposal.id] });
  }
  const scheduled = [...proposals.filter((proposal) => proposal.startsAt), ...confirmed];
  for (let i = 0; i < scheduled.length; i += 1) {
    for (let j = i + 1; j < scheduled.length; j += 1) {
      const left = scheduled[i];
      const right = scheduled[j];
      if (left.kinds.some((kind) => right.kinds.includes(kind)) && left.startsAt === right.startsAt && left.location !== right.location) {
        issues.push({ code: "schedule_collision", message: `「${left.title}」與「${right.title}」在同一時間有互斥安排。`, proposalIds: [left.id, right.id] });
      }
    }
  }
  return issues;
}
