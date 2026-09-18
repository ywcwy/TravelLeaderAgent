import { randomUUID } from "node:crypto";
import { TravelDatabase } from "./database.ts";
import { isDateOnly, localDate } from "./timezone.ts";
import { validateExtractionDraftPayload, type LlmAdapter } from "./extraction-draft.ts";
import type { Decision, ExtractedTripItem, ExtractionDraft, ExtractionDraftPayload, ItineraryQuery, ItineraryQueryResult, MemberRole, Proposal, ProposalContext, ProposalShape, ProposalShapeSource, ReviewIssue, Source, SourceImportOptions, TimezoneSource, TravelGroup, Trip, TripAccessPolicy, TripAccessPolicyUpdate, TripItem, TripItemKind, TripItemStatus, TripReview } from "./domain.ts";

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

export interface ExtractionDraftOptions extends SourceImportOptions {
  currentDate?: string;
  inputType?: string;
}

export class TravelService {
  private readonly db: TravelDatabase;
  private readonly systemAdministratorId: string;
  private readonly queryTokens = new Map<string, { tripId: string; memberId: string; query: Omit<ItineraryQuery, "continuationToken">; offset: number; expiresAt: number }>();

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
    this.db.connection.exec("BEGIN");
    try {
      this.db.connection.prepare(`INSERT INTO trips (id, travel_group_id, title, timezone, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)`)
        .run(trip.id, trip.travelGroupId, trip.title, trip.timezone, now());
      this.db.connection.prepare(`INSERT INTO trip_access_policies (trip_id) VALUES (?)`).run(trip.id);
      this.db.connection.exec("COMMIT");
    } catch (error) {
      this.db.connection.exec("ROLLBACK");
      throw error;
    }
    return trip;
  }

  getTripAccessPolicy(tripId: string): TripAccessPolicy {
    this.requireTrip(tripId);
    const row = this.db.connection.prepare(`SELECT * FROM trip_access_policies WHERE trip_id = ?`).get(tripId) as TripAccessPolicyRow | undefined;
    if (!row) throw new ConflictError(`Trip Access Policy for ${tripId} is missing.`);
    return toTripAccessPolicy(row);
  }

  updateTripAccessPolicy(administratorId: string, tripId: string, update: TripAccessPolicyUpdate): TripAccessPolicy {
    this.requireSystemAdministrator(administratorId);
    this.requireActiveTrip(tripId);
    for (const value of Object.values(update)) {
      if (value !== undefined && typeof value !== "boolean") throw new ConflictError("Trip Access Policy values must be boolean.");
    }
    const current = this.getTripAccessPolicy(tripId);
    const updatedAt = now();
    this.db.connection.prepare(`
      UPDATE trip_access_policies
      SET member_can_view_pending = ?, member_can_view_review_issues = ?, member_can_view_cancelled_history = ?, member_can_view_source_content = ?, updated_by = ?, updated_at = ?
      WHERE trip_id = ?
    `).run(
      Number(update.memberCanViewPending ?? current.memberCanViewPending),
      Number(update.memberCanViewReviewIssues ?? current.memberCanViewReviewIssues),
      Number(update.memberCanViewCancelledHistory ?? current.memberCanViewCancelledHistory),
      Number(update.memberCanViewSourceContent ?? current.memberCanViewSourceContent),
      administratorId,
      updatedAt,
      tripId,
    );
    return this.getTripAccessPolicy(tripId);
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
      this.db.connection.prepare(`INSERT INTO trip_access_policies (trip_id) VALUES (?)`).run(activeTrip.id);
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

  private isTripMember(tripId: string, lineUserId: string): boolean {
    return Boolean(this.db.connection.prepare(`SELECT 1 FROM members WHERE trip_id = ? AND line_user_id = ? AND revoked_at IS NULL`).get(tripId, lineUserId));
  }

  private isDecisionOwner(tripId: string, lineUserId: string): boolean {
    return Boolean(this.db.connection.prepare(`SELECT 1 FROM members WHERE trip_id = ? AND line_user_id = ? AND role = 'owner' AND revoked_at IS NULL`).get(tripId, lineUserId));
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

  assertSafeExtractionContent(content: string): void {
    if (containsSensitiveTravelData(content)) throw new InvalidSourceError("Sensitive Travel Data must be removed before sending this Source to an LLM.");
  }

  async createExtractionDraft(tripId: string, content: string, options: ExtractionDraftOptions, adapter: LlmAdapter): Promise<ExtractionDraft> {
    const trip = this.requireActiveTrip(tripId);
    const idempotencyKey = options.idempotencyKey.trim();
    if (!idempotencyKey) throw new InvalidSourceError("A Source Idempotency Key is required.");
    this.assertSafeExtractionContent(content);

    let source = this.db.connection.prepare(`SELECT id, provider_user_id, content FROM sources WHERE trip_id = ? AND idempotency_key = ?`).get(tripId, idempotencyKey) as { id: string; provider_user_id: string | null; content: string } | undefined;
    if (!source) {
      const sourceId = randomUUID();
      const provenance = options.provenance;
      this.db.connection.prepare(`INSERT OR IGNORE INTO sources (id, trip_id, type, idempotency_key, content, source_time, provider, provider_message_id, provider_group_id, provider_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        sourceId, tripId, options.type ?? "freeform", idempotencyKey, content, options.sourceTime ?? now(), provenance?.provider ?? null, provenance?.messageId ?? null, provenance?.groupId ?? null, provenance?.userId ?? null, now(),
      );
      source = this.db.connection.prepare(`SELECT id, provider_user_id, content FROM sources WHERE trip_id = ? AND idempotency_key = ?`).get(tripId, idempotencyKey) as { id: string; provider_user_id: string | null; content: string } | undefined;
    }
    if (!source) throw new InvalidSourceError("The Source could not be persisted.");
    if (source.content !== content) throw new ConflictError(`Source Idempotency Key ${idempotencyKey} already contains different content.`);

    const existing = this.db.connection.prepare(`SELECT * FROM extraction_drafts WHERE source_id = ? ORDER BY revision DESC LIMIT 1`).get(source.id) as ExtractionDraftRow | undefined;
    if (existing) return toExtractionDraft(existing);

    const currentDate = options.currentDate ?? currentDateInTimezone(trip.timezone);
    const input = { sourceContent: content, tripTimezone: trip.timezone, currentDate, inputType: options.inputType ?? options.type ?? "freeform" };
    let status: ExtractionDraft["status"] = "pending_confirmation";
    let payload: ExtractionDraftPayload;
    try {
      payload = validateExtractionDraftPayload(await adapter.extract(input));
    } catch (error) {
      status = "failed";
      payload = {
        items: [],
        missing: [],
        assumptions: [],
        issues: [{ code: "adapter_failure", message: error instanceof Error ? error.message : "LLM extraction failed." }],
        sourceExcerpt: content.trim().slice(0, 500),
      };
    }
    const draftId = `X-${randomUUID().slice(0, 8).toUpperCase()}`;
    const timestamp = now();
    this.db.connection.prepare(`INSERT OR IGNORE INTO extraction_drafts (id, trip_id, source_id, originating_user_id, revision, previous_draft_id, status, payload_json, proposal_ids_json, confirmed_at, cancelled_at, cancelled_by, created_at, updated_at) VALUES (?, ?, ?, ?, 1, NULL, ?, ?, '[]', NULL, NULL, NULL, ?, ?)`).run(
      draftId, tripId, source.id, source.provider_user_id, status, JSON.stringify(payload), timestamp, timestamp,
    );
    const persisted = this.db.connection.prepare(`SELECT * FROM extraction_drafts WHERE source_id = ? ORDER BY revision DESC LIMIT 1`).get(source.id) as ExtractionDraftRow | undefined;
    if (!persisted) throw new InvalidSourceError("The Extraction Draft could not be persisted.");
    return toExtractionDraft(persisted);
  }

  getExtractionDraft(tripId: string, draftId: string): ExtractionDraft | null {
    const row = this.db.connection.prepare(`SELECT * FROM extraction_drafts WHERE trip_id = ? AND id = ?`).get(tripId, draftId) as ExtractionDraftRow | undefined;
    return row ? toExtractionDraft(row) : null;
  }

  reviseExtractionDraft(tripId: string, userId: string, draftId: string, payload: ExtractionDraftPayload): ExtractionDraft {
    this.requireActiveTrip(tripId);
    const current = this.db.connection.prepare(`SELECT * FROM extraction_drafts WHERE trip_id = ? AND id = ?`).get(tripId, draftId) as ExtractionDraftRow | undefined;
    if (!current) throw new NotFoundError(`Extraction Draft ${draftId} was not found.`);
    if (current.originating_user_id !== userId) throw new PermissionError("Only the originating user can edit an Extraction Draft.");
    const draft = toExtractionDraft(current);
    if (draft.status === "confirmed" || draft.status === "cancelled") throw new ConflictError(`Extraction Draft ${draftId} is locked.`);
    const validated = validateExtractionDraftPayload(payload);
    return this.insertDraftRevision(tripId, current, "pending_confirmation", validated);
  }

  cancelExtractionDraft(tripId: string, userId: string, draftId: string): ExtractionDraft {
    this.requireActiveTrip(tripId);
    const current = this.db.connection.prepare(`SELECT * FROM extraction_drafts WHERE trip_id = ? AND id = ?`).get(tripId, draftId) as ExtractionDraftRow | undefined;
    if (!current) throw new NotFoundError(`Extraction Draft ${draftId} was not found.`);
    if (current.originating_user_id !== userId) throw new PermissionError("Only the originating user can cancel an Extraction Draft.");
    if (current.status === "confirmed") throw new ConflictError(`Extraction Draft ${draftId} is locked.`);
    if (current.status === "cancelled") return toExtractionDraft(current);
    const cancelledAt = now();
    this.db.connection.prepare(`UPDATE extraction_drafts SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, updated_at = ? WHERE id = ? AND status IN ('pending_confirmation', 'failed')`).run(cancelledAt, userId, cancelledAt, draftId);
    const cancelled = this.getExtractionDraft(tripId, draftId);
    if (!cancelled) throw new InvalidSourceError(`Extraction Draft ${draftId} disappeared after cancellation.`);
    return cancelled;
  }

  async retryExtractionDraft(tripId: string, userId: string, draftId: string, adapter: LlmAdapter): Promise<ExtractionDraft> {
    this.requireActiveTrip(tripId);
    const current = this.db.connection.prepare(`SELECT * FROM extraction_drafts WHERE trip_id = ? AND id = ?`).get(tripId, draftId) as ExtractionDraftRow | undefined;
    if (!current) throw new NotFoundError(`Extraction Draft ${draftId} was not found.`);
    if (current.originating_user_id !== userId) throw new PermissionError("Only the originating user can retry an Extraction Draft.");
    if (current.status !== "failed") throw new ConflictError(`Extraction Draft ${draftId} is not failed and cannot be retried.`);
    const source = this.getSource(current.source_id);
    if (!source) throw new InvalidSourceError(`Source ${current.source_id} was not found.`);
    const trip = this.requireTrip(tripId);
    let status: ExtractionDraft["status"] = "pending_confirmation";
    let payload: ExtractionDraftPayload;
    try {
      payload = validateExtractionDraftPayload(await adapter.extract({ sourceContent: source.content, tripTimezone: trip.timezone, currentDate: currentDateInTimezone(trip.timezone), inputType: source.type }));
    } catch (error) {
      status = "failed";
      payload = { items: [], missing: [], assumptions: [], issues: [{ code: "adapter_failure", message: error instanceof Error ? error.message : "LLM extraction failed." }], sourceExcerpt: source.content.trim().slice(0, 500) };
    }
    return this.insertDraftRevision(tripId, current, status, payload);
  }

  confirmExtractionDraft(tripId: string, userId: string, draftId: string): { draft: ExtractionDraft; proposalIds: string[] } {
    this.requireActiveTrip(tripId);
    const row = this.db.connection.prepare(`SELECT * FROM extraction_drafts WHERE trip_id = ? AND id = ?`).get(tripId, draftId) as ExtractionDraftRow | undefined;
    if (!row) throw new NotFoundError(`Extraction Draft ${draftId} was not found.`);
    if (!row.originating_user_id || row.originating_user_id !== userId) throw new PermissionError("Only the originating user can confirm an Extraction Draft.");
    const draft = toExtractionDraft(row);
    if (draft.status === "confirmed") return { draft, proposalIds: draft.proposalIds };
    if (draft.status !== "pending_confirmation") throw new ConflictError(`Extraction Draft ${draftId} is not pending confirmation.`);
    const blockingMissing = [
      ...draft.missing.filter((entry) => entry.required),
      ...draft.items.flatMap((item) => !item.startsAt && !item.localDate ? [{ field: "localDate" }] : []),
      ...draft.items.flatMap((item) => [
        item.startTimeFlexibility === "required" && !item.startsAt ? { field: "startsAt" } : null,
        item.endTimeFlexibility === "required" && !item.endsAt ? { field: "endsAt" } : null,
      ].filter((entry): entry is { field: string } => entry !== null)),
    ];
    if (blockingMissing.length > 0) throw new ConflictError(`Extraction Draft ${draftId} is missing required information: ${blockingMissing.map((entry) => entry.field).join(", ")}.`);
    if (draft.items.length === 0) throw new ConflictError(`Extraction Draft ${draftId} contains no itinerary items.`);

    this.db.connection.exec("BEGIN IMMEDIATE");
    try {
      const lockedRow = this.db.connection.prepare(`SELECT * FROM extraction_drafts WHERE trip_id = ? AND id = ?`).get(tripId, draftId) as ExtractionDraftRow | undefined;
      if (!lockedRow) throw new NotFoundError(`Extraction Draft ${draftId} was not found.`);
      const latestRow = this.db.connection.prepare(`SELECT id FROM extraction_drafts WHERE source_id = ? ORDER BY revision DESC LIMIT 1`).get(lockedRow.source_id) as { id: string } | undefined;
      if (latestRow?.id !== draftId) throw new ConflictError(`Extraction Draft ${draftId} is not the latest revision.`);
      const lockedDraft = toExtractionDraft(lockedRow);
      if (lockedDraft.status === "confirmed") {
        this.db.connection.exec("COMMIT");
        return { draft: lockedDraft, proposalIds: lockedDraft.proposalIds };
      }
      if (lockedDraft.status !== "pending_confirmation") throw new ConflictError(`Extraction Draft ${draftId} is not pending confirmation.`);
      const proposalIds = lockedDraft.items.map((item) => this.createProposal(tripId, lockedRow.source_id, { ...item, assumptions: lockedDraft.assumptions }));
      const confirmedAt = now();
      const updated = this.db.connection.prepare(`UPDATE extraction_drafts SET status = 'confirmed', proposal_ids_json = ?, confirmed_at = ?, updated_at = ? WHERE id = ? AND status = 'pending_confirmation'`)
        .run(JSON.stringify(proposalIds), confirmedAt, confirmedAt, draftId);
      if (updated.changes !== 1) throw new ConflictError(`Extraction Draft ${draftId} changed while it was being confirmed.`);
      this.db.connection.exec("COMMIT");
      const confirmed = this.getExtractionDraft(tripId, draftId);
      if (!confirmed) throw new InvalidSourceError(`Extraction Draft ${draftId} disappeared after confirmation.`);
      return { draft: confirmed, proposalIds };
    } catch (error) {
      this.db.connection.exec("ROLLBACK");
      throw error;
    }
  }

  createProposal(tripId: string, sourceId: string, item: ExtractedTripItem): string {
    this.requireActiveTrip(tripId);
    const kinds = canonicalizeKinds(item.kind, item.kinds);
    const trip = this.requireTrip(tripId);
    const timezone = resolveItemTimezone(item, trip.timezone);
    const endpointTimezones = resolveEndpointTimezones(item);
    const id = `P-${randomUUID().slice(0, 8).toUpperCase()}`;
    this.db.connection.prepare(`
      INSERT INTO proposals (id, trip_id, source_id, kind, shape, shape_source, origin, destination, origin_timezone, destination_timezone, title, item_status, proposal_status, local_date, starts_at, ends_at, start_time_flexibility, end_time_flexibility, time_window, assumptions_json, timezone, timezone_source, location, notes, deadline_at, source_line, source_excerpt, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, tripId, sourceId, item.kind, item.shape, item.shapeSource, item.origin ?? null, item.destination ?? null, endpointTimezones.origin ?? null, endpointTimezones.destination ?? null, item.title, item.status, item.localDate ?? null, item.startsAt ?? null, item.endsAt ?? null, item.startTimeFlexibility ?? null, item.endTimeFlexibility ?? null, item.timeWindow ?? null, JSON.stringify(item.assumptions ?? []),
      timezone.value, timezone.source ?? null, item.location ?? null, item.notes ?? null, item.deadlineAt ?? null, item.sourceLine ?? null, item.sourceExcerpt ?? null, now());
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
    const trip = this.requireTrip(tripId);
    const timezone = resolveItemTimezone(item, trip.timezone);
    const endpointTimezones = resolveEndpointTimezones(item);
    const source = this.db.connection.prepare(`SELECT id FROM sources WHERE id = ? AND trip_id = ?`).get(sourceId, tripId);
    const predecessor = this.db.connection.prepare(`SELECT id FROM trip_items WHERE id = ? AND trip_id = ? AND status = 'confirmed'`).get(predecessorItemId, tripId);
    if (!source || !predecessor) throw new ConflictError("A Replacement Proposal must reference a confirmed Trip Item and Source from the same Active Trip.");
    const id = `P-${randomUUID().slice(0, 8).toUpperCase()}`;
    this.db.connection.prepare(`
      INSERT INTO proposals (id, trip_id, source_id, replacement_for_item_id, kind, shape, shape_source, origin, destination, origin_timezone, destination_timezone, title, item_status, proposal_status, local_date, starts_at, ends_at, start_time_flexibility, end_time_flexibility, time_window, assumptions_json, timezone, timezone_source, location, notes, deadline_at, source_line, source_excerpt, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, tripId, sourceId, predecessorItemId, item.kind, item.shape, item.shapeSource, item.origin ?? null, item.destination ?? null, endpointTimezones.origin ?? null, endpointTimezones.destination ?? null, item.title, item.status, item.localDate ?? null, item.startsAt ?? null, item.endsAt ?? null, item.startTimeFlexibility ?? null, item.endTimeFlexibility ?? null, item.timeWindow ?? null, JSON.stringify(item.assumptions ?? []),
      timezone.value, timezone.source ?? null, item.location ?? null, item.notes ?? null, item.deadlineAt ?? null, item.sourceLine ?? null, item.sourceExcerpt ?? null, now());
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
    const decision: Decision = { id: `D-${randomUUID().slice(0, 8).toUpperCase()}`, tripId, title, status: "open", selectedProposalId: null, resolvedBy: null, resolvedAt: null, cancelledBy: null, cancelledAt: null };
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
      const decision = this.db.connection.prepare(`SELECT * FROM decisions WHERE id = ? AND trip_id = ?`).get(decisionId, tripId) as DecisionRow | undefined;
      if (!decision) throw new NotFoundError(`Decision ${decisionId} was not found.`);
      if (decision.status === "resolved" && decision.selected_proposal_id) {
        if (decision.selected_proposal_id !== selectedProposalId) throw new ConflictError(`Decision ${decisionId} is already resolved with another Proposal.`);
        const selected = this.db.connection.prepare(`SELECT confirmed_trip_item_id, source_id, title, starts_at, ends_at, location, origin, destination, origin_timezone, destination_timezone FROM proposals WHERE id = ? AND trip_id = ?`).get(decision.selected_proposal_id, tripId) as { confirmed_trip_item_id: string | null; source_id: string; title: string; starts_at: string | null; ends_at: string | null; location: string | null; origin: string | null; destination: string | null; origin_timezone: string | null; destination_timezone: string | null } | undefined;
        if (selected?.confirmed_trip_item_id) {
          const existing = this.db.connection.prepare(`SELECT * FROM trip_items WHERE id = ? AND trip_id = ?`).get(selected.confirmed_trip_item_id, tripId) as Record<string, unknown> | undefined;
          if (existing) { this.db.connection.exec("COMMIT"); return { decision: toDecision(decision), item: this.hydrateTripItem(existing) }; }
        }
        if (selected) {
          const candidates = (this.db.connection.prepare(`SELECT * FROM trip_items WHERE trip_id = ? AND source_id = ? AND title = ? AND status = 'confirmed'`).all(tripId, selected.source_id, selected.title) as Array<Record<string, unknown>>)
            .filter((item) => item.starts_at === selected.starts_at && item.ends_at === selected.ends_at && item.location === selected.location && item.origin === selected.origin && item.destination === selected.destination && item.origin_timezone === selected.origin_timezone && item.destination_timezone === selected.destination_timezone);
          if (candidates.length === 1) {
            this.db.connection.prepare(`UPDATE proposals SET confirmed_trip_item_id = ? WHERE id = ? AND confirmed_trip_item_id IS NULL`).run(candidates[0].id as string, decision.selected_proposal_id);
            this.db.connection.exec("COMMIT");
            return { decision: toDecision(decision), item: this.hydrateTripItem(candidates[0]) };
          }
        }
      }
      if (decision.status !== "open") throw new ConflictError(`Decision ${decisionId} is not open.`);
      const proposal = this.db.connection.prepare(`SELECT * FROM proposals WHERE id = ? AND trip_id = ? AND decision_id = ? AND proposal_status = 'pending'`).get(selectedProposalId, tripId, decisionId) as ProposalRow | undefined;
      if (!proposal) throw new ConflictError("The selected Proposal is not an open option for this Decision.");
      const kinds = this.getProposalKinds(proposal.id);

      const item: TripItem = {
        id: `T-${randomUUID().slice(0, 8).toUpperCase()}`,
        sourceId: proposal.source_id,
        replacementForItemId: null,
        kind: proposal.kind as TripItem["kind"], kinds, shape: proposal.shape ?? "point", shapeSource: proposal.shape_source ?? "inferred", origin: proposal.origin ?? undefined, destination: proposal.destination ?? undefined, title: proposal.title,
        status: "confirmed", localDate: proposal.local_date ?? undefined, startsAt: proposal.starts_at ?? undefined, endsAt: proposal.ends_at ?? undefined, startTimeFlexibility: proposal.start_time_flexibility ?? undefined, endTimeFlexibility: proposal.end_time_flexibility ?? undefined, timeWindow: proposal.time_window ?? undefined, assumptions: parseAssumptions(proposal.assumptions_json),
        timezone: proposal.timezone ?? undefined, timezoneSource: proposal.timezone_source ?? undefined, originTimezone: proposal.origin_timezone ?? undefined, destinationTimezone: proposal.destination_timezone ?? undefined, location: proposal.location ?? undefined, notes: proposal.notes ?? undefined,
        confirmedBy: ownerId,
      };
      const resolvedAt = now();
      this.db.connection.prepare(`INSERT INTO trip_items (id, trip_id, source_id, replacement_for_item_id, kind, shape, shape_source, origin, destination, origin_timezone, destination_timezone, title, status, local_date, starts_at, ends_at, start_time_flexibility, end_time_flexibility, time_window, assumptions_json, timezone, timezone_source, location, notes, confirmed_by, created_at) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )`) 
        .run(item.id, tripId, item.sourceId, item.replacementForItemId, item.kind, item.shape, item.shapeSource, item.origin ?? null, item.destination ?? null, item.originTimezone ?? null, item.destinationTimezone ?? null, item.title, item.status, item.localDate ?? null, item.startsAt ?? null, item.endsAt ?? null, item.startTimeFlexibility ?? null, item.endTimeFlexibility ?? null, item.timeWindow ?? null, JSON.stringify(item.assumptions ?? []), item.timezone ?? null, item.timezoneSource ?? null, item.location ?? null, item.notes ?? null, ownerId, resolvedAt);
      const insertKind = this.db.connection.prepare(`INSERT OR IGNORE INTO trip_item_kinds (trip_item_id, kind) VALUES (?, ?)`);
      for (const kind of item.kinds) insertKind.run(item.id, kind);
      this.db.connection.prepare(`UPDATE proposals SET proposal_status = CASE WHEN id = ? THEN 'confirmed' ELSE 'rejected' END, rejection_reason = CASE WHEN id = ? THEN rejection_reason ELSE 'Not selected in Decision ' || ? END, rejected_by = CASE WHEN id = ? THEN rejected_by ELSE ? END, rejected_at = CASE WHEN id = ? THEN rejected_at ELSE ? END WHERE decision_id = ? AND proposal_status = 'pending'`)
        .run(selectedProposalId, selectedProposalId, decisionId, selectedProposalId, ownerId, selectedProposalId, resolvedAt, decisionId);
      this.db.connection.prepare(`UPDATE proposals SET confirmed_trip_item_id = ? WHERE id = ?`).run(item.id, selectedProposalId);
      this.db.connection.prepare(`UPDATE decisions SET status = 'resolved', selected_proposal_id = ?, resolved_by = ?, resolved_at = ? WHERE id = ?`)
        .run(selectedProposalId, ownerId, resolvedAt, decisionId);
      this.db.connection.exec("COMMIT");
      return { decision: { id: decision.id, tripId: decision.trip_id, title: decision.title, status: "resolved", selectedProposalId, resolvedBy: ownerId, resolvedAt, cancelledBy: null, cancelledAt: null }, item };
    } catch (error) {
      this.db.connection.exec("ROLLBACK");
      throw error;
    }
  }

  confirmProposal(tripId: string, ownerId: string, proposalId: string): TripItem {
    this.requireActiveTrip(tripId);
    this.requireDecisionOwner(tripId, ownerId);

    this.db.connection.exec("BEGIN IMMEDIATE");
    try {
      const proposal = this.db.connection.prepare(`SELECT * FROM proposals WHERE id = ? AND trip_id = ?`).get(proposalId, tripId) as ProposalRow | undefined;
      if (!proposal) throw new NotFoundError(`Proposal ${proposalId} was not found.`);
      if (proposal.proposal_status === "confirmed" && proposal.confirmed_trip_item_id) {
        const existing = this.db.connection.prepare(`SELECT * FROM trip_items WHERE id = ? AND trip_id = ?`).get(proposal.confirmed_trip_item_id, tripId) as Record<string, unknown> | undefined;
        if (existing) { this.db.connection.exec("COMMIT"); return this.hydrateTripItem(existing); }
      }
      if (proposal.proposal_status === "confirmed") {
        const candidates = (this.db.connection.prepare(`SELECT * FROM trip_items WHERE trip_id = ? AND source_id = ? AND title = ? AND status = 'confirmed'`).all(tripId, proposal.source_id, proposal.title) as Array<Record<string, unknown>>)
          .filter((item) => item.starts_at === proposal.starts_at && item.ends_at === proposal.ends_at && item.location === proposal.location && item.origin === proposal.origin && item.destination === proposal.destination && item.origin_timezone === proposal.origin_timezone && item.destination_timezone === proposal.destination_timezone);
        if (candidates.length === 1) {
          this.db.connection.prepare(`UPDATE proposals SET confirmed_trip_item_id = ? WHERE id = ? AND confirmed_trip_item_id IS NULL`).run(candidates[0].id as string, proposalId);
          this.db.connection.exec("COMMIT");
          return this.hydrateTripItem(candidates[0]);
        }
      }
      if (proposal.proposal_status !== "pending") throw new ConflictError(`Proposal ${proposalId} is not pending.`);
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
        status: "confirmed", localDate: proposal.local_date ?? undefined, startsAt: proposal.starts_at ?? undefined, endsAt: proposal.ends_at ?? undefined, startTimeFlexibility: proposal.start_time_flexibility ?? undefined, endTimeFlexibility: proposal.end_time_flexibility ?? undefined, timeWindow: proposal.time_window ?? undefined, assumptions: parseAssumptions(proposal.assumptions_json),
        timezone: proposal.timezone ?? undefined, timezoneSource: proposal.timezone_source ?? undefined, originTimezone: proposal.origin_timezone ?? undefined, destinationTimezone: proposal.destination_timezone ?? undefined, location: proposal.location ?? undefined, notes: proposal.notes ?? undefined,
        confirmedBy: ownerId,
      };
      if (proposal.replacement_for_item_id) {
        const predecessor = this.db.connection.prepare(`SELECT id FROM trip_items WHERE id = ? AND trip_id = ? AND status = 'confirmed'`).get(proposal.replacement_for_item_id, tripId);
        if (!predecessor) throw new ConflictError("The Replacement Proposal predecessor is no longer confirmed.");
      }
      this.db.connection.prepare(`INSERT INTO trip_items (id, trip_id, source_id, replacement_for_item_id, kind, shape, shape_source, origin, destination, origin_timezone, destination_timezone, title, status, local_date, starts_at, ends_at, start_time_flexibility, end_time_flexibility, time_window, assumptions_json, timezone, timezone_source, location, notes, confirmed_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`) 
        .run(item.id, tripId, item.sourceId, item.replacementForItemId, item.kind, item.shape, item.shapeSource, item.origin ?? null, item.destination ?? null, item.originTimezone ?? null, item.destinationTimezone ?? null, item.title, item.status, item.localDate ?? null, item.startsAt ?? null, item.endsAt ?? null, item.startTimeFlexibility ?? null, item.endTimeFlexibility ?? null, item.timeWindow ?? null, JSON.stringify(item.assumptions ?? []), item.timezone ?? null, item.timezoneSource ?? null, item.location ?? null, item.notes ?? null, ownerId, now());
      const insertKind = this.db.connection.prepare(`INSERT OR IGNORE INTO trip_item_kinds (trip_item_id, kind) VALUES (?, ?)`);
      for (const kind of item.kinds) insertKind.run(item.id, kind);
      if (proposal.replacement_for_item_id) {
        this.db.connection.prepare(`UPDATE trip_items SET status = 'cancelled' WHERE id = ? AND trip_id = ? AND status = 'confirmed'`).run(proposal.replacement_for_item_id, tripId);
      }
      this.db.connection.prepare(`UPDATE proposals SET proposal_status = 'confirmed', confirmed_trip_item_id = ? WHERE id = ?`).run(item.id, proposalId);
      this.db.connection.exec("COMMIT");
      return item;
    } catch (error) {
      this.db.connection.exec("ROLLBACK");
      throw error;
    }
  }

  rejectProposal(tripId: string, ownerId: string, proposalId: string, reason?: string | null): Proposal {
    this.requireActiveTrip(tripId);
    this.requireDecisionOwner(tripId, ownerId);
    this.db.connection.exec("BEGIN IMMEDIATE");
    try {
      const proposal = this.db.connection.prepare(`SELECT * FROM proposals WHERE id = ? AND trip_id = ?`).get(proposalId, tripId) as ProposalRow | undefined;
      if (!proposal) throw new NotFoundError(`Proposal ${proposalId} was not found.`);
      if (proposal.proposal_status === "rejected") { this.db.connection.exec("COMMIT"); return this.hydrateProposal(proposal); }
      if (proposal.proposal_status !== "pending") throw new ConflictError(`Proposal ${proposalId} is not pending.`);
      const rejectedAt = now();
      this.db.connection.prepare(`UPDATE proposals SET proposal_status = 'rejected', rejection_reason = ?, rejected_by = ?, rejected_at = ? WHERE id = ? AND proposal_status = 'pending'`).run(reason?.trim() || null, ownerId, rejectedAt, proposalId);
      if (proposal.decision_id) {
        const remaining = this.db.connection.prepare(`SELECT COUNT(*) AS count FROM proposals WHERE decision_id = ? AND proposal_status = 'pending'`).get(proposal.decision_id) as { count: number };
        if (Number(remaining.count) === 0) this.db.connection.prepare(`UPDATE decisions SET status = 'needs_options' WHERE id = ? AND status = 'open'`).run(proposal.decision_id);
      }
      const updated = this.db.connection.prepare(`SELECT * FROM proposals WHERE id = ? AND trip_id = ?`).get(proposalId, tripId) as unknown as ProposalRow;
      this.db.connection.exec("COMMIT");
      return this.hydrateProposal(updated);
    } catch (error) {
      this.db.connection.exec("ROLLBACK");
      throw error;
    }
  }

  addDecisionOptions(tripId: string, ownerId: string, decisionId: string, proposalIds: string[]): Decision {
    this.requireActiveTrip(tripId);
    this.requireDecisionOwner(tripId, ownerId);
    const uniqueProposalIds = [...new Set(proposalIds)];
    if (uniqueProposalIds.length === 0) throw new ConflictError("At least one Proposal is required.");
    const placeholders = uniqueProposalIds.map(() => "?").join(", ");
    this.db.connection.exec("BEGIN IMMEDIATE");
    try {
      const decision = this.db.connection.prepare(`SELECT * FROM decisions WHERE id = ? AND trip_id = ?`).get(decisionId, tripId) as DecisionRow | undefined;
      if (!decision) throw new NotFoundError(`Decision ${decisionId} was not found.`);
      if (decision.status !== "needs_options") throw new ConflictError(`Decision ${decisionId} does not need new options.`);
      const proposals = this.db.connection.prepare(`SELECT id, trip_id, proposal_status, decision_id, replacement_for_item_id FROM proposals WHERE id IN (${placeholders})`).all(...uniqueProposalIds) as unknown as ProposalMembershipRow[];
      if (proposals.length !== uniqueProposalIds.length || proposals.some((proposal) => proposal.trip_id !== tripId || proposal.proposal_status !== "pending" || proposal.decision_id !== null || proposal.replacement_for_item_id !== null)) throw new ConflictError("Only unassigned pending Proposals from this Trip can be added.");
      this.db.connection.prepare(`UPDATE proposals SET decision_id = ? WHERE id IN (${placeholders})`).run(decisionId, ...uniqueProposalIds);
      this.db.connection.prepare(`UPDATE decisions SET status = 'open' WHERE id = ?`).run(decisionId);
      const reopened = this.db.connection.prepare(`SELECT * FROM decisions WHERE id = ? AND trip_id = ?`).get(decisionId, tripId) as unknown as DecisionRow;
      this.db.connection.exec("COMMIT");
      return toDecision(reopened);
    } catch (error) {
      this.db.connection.exec("ROLLBACK");
      throw error;
    }
  }

  cancelDecision(tripId: string, ownerId: string, decisionId: string): Decision {
    this.requireActiveTrip(tripId);
    this.requireDecisionOwner(tripId, ownerId);
    this.db.connection.exec("BEGIN IMMEDIATE");
    try {
      const decision = this.db.connection.prepare(`SELECT * FROM decisions WHERE id = ? AND trip_id = ?`).get(decisionId, tripId) as DecisionRow | undefined;
      if (!decision) throw new NotFoundError(`Decision ${decisionId} was not found.`);
      if (decision.status === "cancelled") { this.db.connection.exec("COMMIT"); return toDecision(decision); }
      if (decision.status !== "open" && decision.status !== "needs_options") throw new ConflictError(`Decision ${decisionId} cannot be cancelled.`);
      const cancelledAt = now();
      this.db.connection.prepare(`UPDATE decisions SET status = 'cancelled', cancelled_by = ?, cancelled_at = ? WHERE id = ?`).run(ownerId, cancelledAt, decisionId);
      this.db.connection.prepare(`UPDATE proposals SET proposal_status = 'rejected', rejection_reason = COALESCE(rejection_reason, 'Decision cancelled'), rejected_by = COALESCE(rejected_by, ?), rejected_at = COALESCE(rejected_at, ?) WHERE decision_id = ? AND proposal_status = 'pending'`).run(ownerId, cancelledAt, decisionId);
      const cancelled = this.db.connection.prepare(`SELECT * FROM decisions WHERE id = ? AND trip_id = ?`).get(decisionId, tripId) as unknown as DecisionRow;
      this.db.connection.exec("COMMIT");
      return toDecision(cancelled);
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
    const rejected = (this.db.connection.prepare(`SELECT * FROM proposals WHERE trip_id = ? AND proposal_status = 'rejected' ORDER BY rejected_at, title`).all(tripId) as unknown as ProposalRow[]).map((row) => this.hydrateProposal(row));
    const sources = this.db.connection.prepare(`SELECT id, content FROM sources WHERE trip_id = ?`).all(tripId) as Array<{ id: string; content: string }>;
    const sourceIds = sources.map((source) => source.id);
    const proposalSourceIds = new Set(
      (this.db.connection.prepare(`SELECT source_id FROM proposals WHERE trip_id = ?`).all(tripId) as unknown as Array<{ source_id: string }>)
        .map((proposal) => proposal.source_id),
    );
    const issues = buildReviewIssues(proposals, confirmed);
    for (const source of sources) {
      const sourceIssues = findUnparseableLineIssues(source.id, source.content);
      issues.push(...sourceIssues);
      const sourceId = source.id;
      if (!proposalSourceIds.has(sourceId) && sourceIssues.length === 0) {
        issues.push({ code: "source_unparsed", message: "Source has no parseable itinerary candidates.", sourceId, proposalIds: [] });
      }
    }
    const decisions = (this.db.connection.prepare(`SELECT * FROM decisions WHERE trip_id = ? ORDER BY created_at, id`).all(tripId) as unknown as DecisionRow[]).map(toDecision);
    return {
      confirmed,
      cancelled,
      pending: proposals,
      rejected,
      provisional: proposals.filter((proposal) => proposal.status === "pending" && proposal.itemStatus === "provisional"),
      openDecisions: proposals.filter((proposal) => proposal.status === "pending" && proposal.itemStatus === "open_decision"),
      conflicts: proposals.filter((proposal) => proposal.status === "pending" && proposal.itemStatus === "conflicted"),
      issues,
      decisions,
    };
  }

  queryActiveTrip(tripId: string, memberId: string, query: ItineraryQuery): ItineraryQueryResult {
    return this.queryTrip(tripId, memberId, { ...query, includeArchived: false });
  }

  queryTrip(tripId: string, memberId: string, query: ItineraryQuery): ItineraryQueryResult {
    const tripRow = this.requireTrip(tripId);
    if (tripRow.status === "archived" && !query.includeArchived) throw new TripNotActiveError(`Trip ${tripId} is archived; request it explicitly.`);
    const trip = toTrip(tripRow);
    if (!this.isTripMember(tripId, memberId) && memberId !== this.systemAdministratorId) throw new PermissionError("Only a Trip member can query itinerary data.");
    const policy = this.getTripAccessPolicy(tripId);
    const review = this.reviewTrip(tripId);
    const pageSize = Math.min(Math.max(query.pageSize ?? 10, 1), 10);
    const continuation = this.readQueryToken(query.continuationToken, tripId, memberId);
    const effectiveQuery = continuation?.query ?? query;
    const matches = (item: { id?: string; title: string; localDate?: string; startsAt?: string; endsAt?: string; timezone?: string; timezoneSource?: TimezoneSource; originTimezone?: string; destinationTimezone?: string; shape?: ProposalShape; location?: string; origin?: string; destination?: string; kinds: TripItemKind[] }) => {
      if (effectiveQuery.proposalId && item.id !== effectiveQuery.proposalId) return false;
      if (effectiveQuery.date && !overlapsLocalDate(item, effectiveQuery.date, trip.timezone)) return false;
      if (effectiveQuery.location && ![item.location, item.origin, item.destination].some((value) => value?.toLocaleLowerCase().includes(effectiveQuery.location!.toLocaleLowerCase()))) return false;
      if (effectiveQuery.kind && !item.kinds.includes(effectiveQuery.kind)) return false;
      return true;
    };
    const allConfirmed = effectiveQuery.pendingOnly || effectiveQuery.reviewIssuesOnly ? [] : review.confirmed.filter(matches).sort(compareScheduledItems);
    const allPending = policy.memberCanViewPending && !effectiveQuery.reviewIssuesOnly ? review.pending.filter(matches).sort(compareScheduledItems) : [];
    const offset = continuation?.offset ?? 0;
    const combined = [...allConfirmed.map((item) => ({ type: "confirmed" as const, item })), ...allPending.map((item) => ({ type: "pending" as const, item }))].sort((left, right) => compareScheduledItems(left.item, right.item));
    const page = combined.slice(offset, offset + pageSize);
    const confirmed = page.filter((entry) => entry.type === "confirmed").map((entry) => entry.item) as TripItem[];
    const pending = page.filter((entry) => entry.type === "pending").map((entry) => entry.item) as Proposal[];
    const hasItemFilter = Boolean(effectiveQuery.date || effectiveQuery.location || effectiveQuery.kind || effectiveQuery.proposalId);
    const openDecisions = effectiveQuery.pendingOnly || effectiveQuery.reviewIssuesOnly ? [] : (this.db.connection.prepare(`SELECT * FROM decisions WHERE trip_id = ? AND status = 'open' ORDER BY title, id`).all(tripId) as unknown as DecisionRow[])
      .filter((decision) => {
        if (!hasItemFilter) return true;
        const options = (this.db.connection.prepare(`SELECT * FROM proposals WHERE trip_id = ? AND decision_id = ? AND proposal_status = 'pending'`).all(tripId, decision.id) as unknown as ProposalRow[]).map((row) => this.hydrateProposal(row));
        return options.some(matches);
      })
      .map(toDecision);
    const issues = policy.memberCanViewReviewIssues && !effectiveQuery.pendingOnly ? review.issues.filter((issue) => {
      if (!hasItemFilter) return true;
      const related = review.pending.filter((proposal) => issue.proposalIds.includes(proposal.id));
      return related.some(matches);
    }) : [];
    const canReadSource = effectiveQuery.includeSourceContent === true && policy.memberCanViewSourceContent && (memberId === this.systemAdministratorId || this.isDecisionOwner(tripId, memberId));
    const sources = canReadSource ? (this.db.connection.prepare(`SELECT * FROM sources WHERE trip_id = ? ORDER BY source_time, id`).all(tripId) as unknown as SourceRow[]).map(toSource) : [];
    const nextPageToken = offset + pageSize < combined.length ? this.createQueryToken(tripId, memberId, effectiveQuery, offset + pageSize) : null;
    return { trip, confirmed, pending, openDecisions, issues: offset === 0 ? issues : [], sources, nextPageToken };
  }

  private readQueryToken(token: string | undefined, tripId: string, memberId: string): { query: Omit<ItineraryQuery, "continuationToken">; offset: number } | null {
    if (!token) return null;
    const payload = this.queryTokens.get(token);
    this.queryTokens.delete(token);
    if (!payload || payload.expiresAt <= Date.now()) throw new ConflictError("The query continuation token has expired.");
    if (payload.tripId !== tripId || payload.memberId !== memberId) throw new PermissionError("The query continuation token does not belong to this Trip or user.");
    return { query: payload.query, offset: payload.offset };
  }

  private createQueryToken(tripId: string, memberId: string, query: Omit<ItineraryQuery, "continuationToken">, offset: number): string {
    const token = `Q-${randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase()}`;
    this.queryTokens.set(token, { tripId, memberId, query, offset, expiresAt: Date.now() + 5 * 60 * 1000 });
    return token;
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
      const parsed = parseItineraryCandidate(line, index + 1);
      return parsed.items ?? (parsed.item ? [parsed.item] : []);
    });
  }

  private insertDraftRevision(tripId: string, current: ExtractionDraftRow, status: ExtractionDraft["status"], payload: ExtractionDraftPayload): ExtractionDraft {
    this.db.connection.exec("BEGIN IMMEDIATE");
    try {
      const latest = this.db.connection.prepare(`SELECT * FROM extraction_drafts WHERE source_id = ? ORDER BY revision DESC LIMIT 1`).get(current.source_id) as ExtractionDraftRow | undefined;
      if (!latest || latest.id !== current.id) throw new ConflictError(`Extraction Draft ${current.id} is not the latest revision.`);
      const revision = latest.revision + 1;
      const draftId = `X-${randomUUID().slice(0, 8).toUpperCase()}`;
      const timestamp = now();
      this.db.connection.prepare(`INSERT INTO extraction_drafts (id, trip_id, source_id, originating_user_id, revision, previous_draft_id, status, payload_json, proposal_ids_json, confirmed_at, cancelled_at, cancelled_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', NULL, NULL, NULL, ?, ?)`).run(
        draftId, tripId, current.source_id, current.originating_user_id, revision, current.id, status, JSON.stringify(payload), timestamp, timestamp,
      );
      const persisted = this.db.connection.prepare(`SELECT * FROM extraction_drafts WHERE id = ?`).get(draftId) as ExtractionDraftRow | undefined;
      if (!persisted) throw new InvalidSourceError(`Extraction Draft ${draftId} could not be persisted.`);
      this.db.connection.exec("COMMIT");
      return toExtractionDraft(persisted);
    } catch (error) {
      this.db.connection.exec("ROLLBACK");
      throw error;
    }
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
    const member = this.db.connection.prepare(`SELECT role, revoked_at FROM members WHERE trip_id = ? AND line_user_id = ? AND revoked_at IS NULL`).get(tripId, ownerId) as { role: MemberRole; revoked_at: string | null } | undefined;
    if (member?.role !== "owner") throw new PermissionError("Only a Decision Owner can manage a Decision.");
  }
}

interface TravelGroupRow {
  id: string; line_group_id: string; display_name: string;
}

interface SourceRow { id: string; trip_id: string; type: string; idempotency_key: string; content: string; source_time: string; provider: string | null; provider_message_id: string | null; provider_group_id: string | null; provider_user_id: string | null; }

interface ExtractionDraftRow {
  id: string;
  trip_id: string;
  source_id: string;
  originating_user_id: string | null;
  revision: number;
  previous_draft_id: string | null;
  status: ExtractionDraft["status"];
  payload_json: string;
  proposal_ids_json: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  created_at: string;
  updated_at: string;
}

interface TripRow {
  id: string; travel_group_id: string; title: string; timezone: string; status: "active" | "archived";
}

interface TripAccessPolicyRow {
  trip_id: string;
  member_can_view_pending: number;
  member_can_view_review_issues: number;
  member_can_view_cancelled_history: number;
  member_can_view_source_content: number;
  updated_by: string | null;
  updated_at: string | null;
}

function toTrip(row: TripRow): Trip {
  return { id: row.id, travelGroupId: row.travel_group_id, title: row.title, timezone: row.timezone, status: row.status };
}

function toTripAccessPolicy(row: TripAccessPolicyRow): TripAccessPolicy {
  return {
    tripId: row.trip_id,
    memberCanViewPending: Boolean(row.member_can_view_pending),
    memberCanViewReviewIssues: Boolean(row.member_can_view_review_issues),
    memberCanViewCancelledHistory: Boolean(row.member_can_view_cancelled_history),
    memberCanViewSourceContent: Boolean(row.member_can_view_source_content),
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

interface ProposalRow {
  id: string; source_id: string; replacement_for_item_id: string | null; confirmed_trip_item_id: string | null; rejection_reason: string | null; rejected_by: string | null; rejected_at: string | null; kind: string; shape: ProposalShape | null; shape_source: ProposalShapeSource | null; origin: string | null; destination: string | null; origin_timezone: string | null; destination_timezone: string | null; title: string; item_status: TripItemStatus; proposal_status: "pending" | "confirmed" | "rejected"; decision_id: string | null;
  local_date: string | null; starts_at: string | null; ends_at: string | null; start_time_flexibility: ExtractedTripItem["startTimeFlexibility"] | null; end_time_flexibility: ExtractedTripItem["endTimeFlexibility"] | null; time_window: ExtractedTripItem["timeWindow"] | null; assumptions_json: string; timezone: string | null; timezone_source: TimezoneSource | null; location: string | null; notes: string | null; deadline_at: string | null; source_line: number | null; source_excerpt: string | null;
}

interface ProposalMembershipRow {
  id: string; trip_id: string; proposal_status: "pending" | "confirmed" | "rejected"; decision_id: string | null; replacement_for_item_id: string | null;
}

interface DecisionRow {
  id: string; trip_id: string; title: string; status: "open" | "resolved" | "needs_options" | "cancelled"; selected_proposal_id: string | null; resolved_by: string | null; resolved_at: string | null; cancelled_by: string | null; cancelled_at: string | null;
}

function toDecision(row: DecisionRow): Decision {
  return { id: row.id, tripId: row.trip_id, title: row.title, status: row.status, selectedProposalId: row.selected_proposal_id, resolvedBy: row.resolved_by, resolvedAt: row.resolved_at, cancelledBy: row.cancelled_by, cancelledAt: row.cancelled_at };
}

function compareScheduledItems(left: { localDate?: string; startsAt?: string; title: string; id: string }, right: { localDate?: string; startsAt?: string; title: string; id: string }): number {
  // Date-only values sort by their calendar date; values without any date sort last.
  const leftTime = scheduledSortTime(left);
  const rightTime = scheduledSortTime(right);
  return leftTime - rightTime || left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
}

function scheduledSortTime(item: { localDate?: string; startsAt?: string }): number {
  const value = item.startsAt && !isDateOnly(item.startsAt) ? item.startsAt : item.localDate ?? item.startsAt;
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

function overlapsLocalDate(item: { localDate?: string; startsAt?: string; endsAt?: string; timezone?: string; originTimezone?: string; destinationTimezone?: string; shape?: ProposalShape }, date: string, tripTimezone: string): boolean {
  if (item.localDate && item.localDate === date) return true;
  if (!item.startsAt) return false;
  const timezones = item.shape === "route"
    ? [...new Set([item.originTimezone, item.destinationTimezone, item.timezone, tripTimezone].filter((timezone): timezone is string => Boolean(timezone)))]
    : [item.timezone ?? tripTimezone];
  return timezones.some((timezone) => {
    const startDate = localDate(item.startsAt!, timezone);
    const endDate = localDate(item.endsAt ?? item.startsAt!, timezone);
    return Boolean(startDate && endDate && startDate <= date && date <= endDate);
  });
}

function toProposal(row: ProposalRow, kinds = [row.kind as Proposal["kind"]]): Proposal {
  const shape = row.shape ?? (row.location ? "point" : "point");
  return { id: row.id, sourceId: row.source_id, replacementForItemId: row.replacement_for_item_id, kind: row.kind as Proposal["kind"], kinds, shape, shapeSource: row.shape_source ?? "inferred", origin: row.origin ?? undefined, destination: row.destination ?? undefined, originTimezone: row.origin_timezone ?? undefined, destinationTimezone: row.destination_timezone ?? undefined, title: row.title, itemStatus: row.item_status, status: row.proposal_status, localDate: row.local_date ?? undefined, startsAt: row.starts_at ?? undefined, endsAt: row.ends_at ?? undefined, startTimeFlexibility: row.start_time_flexibility ?? undefined, endTimeFlexibility: row.end_time_flexibility ?? undefined, timeWindow: row.time_window ?? undefined, assumptions: parseAssumptions(row.assumptions_json), timezone: row.timezone ?? undefined, timezoneSource: row.timezone_source ?? undefined, location: row.location ?? undefined, notes: row.notes ?? undefined, deadlineAt: row.deadline_at, rejectionReason: row.rejection_reason, rejectedBy: row.rejected_by, rejectedAt: row.rejected_at, sourceLine: row.source_line ?? undefined, sourceExcerpt: row.source_excerpt ?? undefined };
}

function parseAssumptions(value: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return [];
  }
}

function toTravelGroup(row: TravelGroupRow): TravelGroup {
  return { id: row.id, lineGroupId: row.line_group_id, displayName: row.display_name };
}

function toSource(row: SourceRow): Source {
  return {
    id: row.id,
    tripId: row.trip_id,
    type: row.type,
    idempotencyKey: row.idempotency_key,
    content: row.content,
    sourceTime: row.source_time,
    provenance: row.provider ? { provider: row.provider, messageId: row.provider_message_id ?? "", ...(row.provider_group_id ? { groupId: row.provider_group_id } : {}), ...(row.provider_user_id ? { userId: row.provider_user_id } : {}) } : null,
  };
}

function toExtractionDraft(row: ExtractionDraftRow): ExtractionDraft {
  let payload: ExtractionDraftPayload;
  try {
    payload = validateExtractionDraftPayload(JSON.parse(row.payload_json));
  } catch (error) {
    throw new InvalidSourceError(`Extraction Draft ${row.id} contains invalid persisted data: ${error instanceof Error ? error.message : String(error)}`);
  }
  let proposalIds: string[];
  try {
    const parsed = JSON.parse(row.proposal_ids_json ?? "[]");
    if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== "string")) throw new Error("proposal_ids_json must be a string array.");
    proposalIds = parsed;
  } catch (error) {
    throw new InvalidSourceError(`Extraction Draft ${row.id} contains invalid Proposal IDs: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { id: row.id, tripId: row.trip_id, sourceId: row.source_id, originatingUserId: row.originating_user_id ?? null, revision: row.revision, previousDraftId: row.previous_draft_id ?? null, status: row.status, proposalIds, confirmedAt: row.confirmed_at ?? null, cancelledAt: row.cancelled_at ?? null, cancelledBy: row.cancelled_by ?? null, ...payload, createdAt: row.created_at, updatedAt: row.updated_at };
}

function toTripItem(row: Record<string, unknown>, kinds = [row.kind as TripItem["kind"]]): TripItem {
  return { id: row.id as string, sourceId: row.source_id as string, replacementForItemId: (row.replacement_for_item_id as string) ?? null, kind: row.kind as TripItem["kind"], kinds, shape: (row.shape as ProposalShape | null) ?? "point", shapeSource: (row.shape_source as ProposalShapeSource | null) ?? "inferred", origin: (row.origin as string) ?? undefined, destination: (row.destination as string) ?? undefined, originTimezone: (row.origin_timezone as string) ?? undefined, destinationTimezone: (row.destination_timezone as string) ?? undefined, title: row.title as string, status: row.status as TripItemStatus, localDate: (row.local_date as string) ?? undefined, startsAt: (row.starts_at as string) ?? undefined, endsAt: (row.ends_at as string) ?? undefined, startTimeFlexibility: row.start_time_flexibility as ExtractedTripItem["startTimeFlexibility"] ?? undefined, endTimeFlexibility: row.end_time_flexibility as ExtractedTripItem["endTimeFlexibility"] ?? undefined, timeWindow: row.time_window as ExtractedTripItem["timeWindow"] ?? undefined, assumptions: parseAssumptions(row.assumptions_json as string | null | undefined), timezone: (row.timezone as string) ?? undefined, timezoneSource: (row.timezone_source as TimezoneSource | null) ?? undefined, location: (row.location as string) ?? undefined, notes: (row.notes as string) ?? undefined, confirmedBy: (row.confirmed_by as string) ?? null };
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
  if (/train|bus|交通|接駁|開車|火車/.test(lower)) kinds.push("transport");
  if (/breakfast|lunch|dinner|meal|早餐|午餐|晚餐|餐/.test(lower)) kinds.push("meal");
  if (/tour|ticket|活動|門票|預約/.test(lower)) kinds.push("activity");
  if (/shopping|supermarket|walmart|safeway|採買|購物|超市/.test(lower)) kinds.push("shopping");
  if (/meet|集合/.test(lower)) kinds.push("meeting");
  return kinds.length > 0 ? [...new Set(kinds)] : ["other"];
}

interface ParsedItineraryCandidate {
  item?: ExtractedTripItem;
  items?: ExtractedTripItem[];
  issue?: Pick<ReviewIssue, "code" | "message">;
  issues?: Array<Pick<ReviewIssue, "code" | "message">>;
}

function parseItineraryCandidate(line: string, sourceLine: number): ParsedItineraryCandidate {
  const markdown = parseMarkdownCandidate(line, sourceLine);
  if (markdown.item || markdown.items || markdown.issue || markdown.issues) return markdown;
  return parseFreeformCandidate(line, sourceLine);
}

function parseFreeformCandidate(line: string, sourceLine: number): ParsedItineraryCandidate {
  const original = line.trim();
  if (!original || isFreeformQuestion(original)) return {};
  const text = original.replace(/^@[^\s]+\s+/, "").trim();
  const dateMatch = text.match(/\b(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?|\d{1,2}\/\d{1,2})\b/);
  const startsAt = dateMatch?.[1];
  const withoutDate = text.replace(dateMatch?.[0] ?? "", " ").replace(/\s+/g, " ").trim().replace(/[。.!！?？]+$/, "");
  const routeParts = freeformRouteParts(withoutDate);
  if (routeParts) {
    if (routeParts.length < 2) {
      return { issue: { code: "missing_route_endpoint", message: `第 ${sourceLine} 行的 Route Proposal 缺少起點或終點。` } };
    }
    const items = routeParts.slice(0, -1).map((origin, index) => {
      const destination = routeParts[index + 1];
      const inferredKinds = inferKinds(withoutDate).filter((kind) => kind !== "other");
      const kinds = ["transport" as const, ...inferredKinds.filter((kind) => kind !== "transport")];
      return makeFreeformItem({
        kind: "transport", kinds: [...new Set(kinds)], shape: "route", title: `${origin} → ${destination}`,
        startsAt, origin, destination, sourceLine, sourceExcerpt: original,
      });
    });
    return { items };
  }

  const point = freeformPointStatement(withoutDate);
  if (!point) return {};
  return { item: makeFreeformItem({ ...point, startsAt, sourceLine, sourceExcerpt: original }) };
}

function freeformRouteParts(text: string): string[] | null {
  const arrowParts = text.split(/\s*(?:→|->)\s*/).map((part) => part.trim()).filter(Boolean);
  if (arrowParts.length > 1) return arrowParts;
  const fromMatch = text.match(/^(?:從|from)\s+(.+?)\s+(?:前往|到|至|to)\s+(.+)$/i);
  if (fromMatch) return [fromMatch[1].trim(), fromMatch[2].trim()];
  if (/^(?:從|from)\s+/i.test(text) && /(?:前往|到|至|to)/i.test(text)) return [];
  return null;
}

type FreeformPoint = Pick<ExtractedTripItem, "kind" | "kinds" | "shape" | "title" | "location">;

function freeformPointStatement(text: string): FreeformPoint | null {
  const englishDining = text.match(/^(?:dining|breakfast|lunch|dinner)\s+(?:at|in)\s+(.+)$/i);
  if (englishDining) {
    const location = englishDining[1].trim();
    return { kind: "meal", kinds: ["meal"], shape: "point", title: `餐飲：${location}`, location };
  }
  const diningAt = text.match(/^(?:在|於)\s*(.+?)\s*(?:吃|用餐|用餐於)?\s*(早餐|午餐|晚餐|吃飯|用餐)$/i)
    ?? text.match(/^(早餐|午餐|晚餐|吃飯|用餐)\s*(?:在|於|：|:)\s*(.+)$/i);
  if (diningAt) {
    const meal = diningAt[1].match(/早餐|午餐|晚餐|吃飯|用餐/i) ? diningAt[1] : diningAt[2];
    const location = diningAt[1].match(/早餐|午餐|晚餐|吃飯|用餐/i) ? diningAt[2] : diningAt[1];
    return { kind: "meal", kinds: freeformKinds(text, "meal"), shape: "point", title: `${meal}：${location}`, location: location.trim() };
  }
  const lodging = text.match(/^(?:入住|住宿於|住宿在|住在|staying at)\s*[:：]?\s*(.+)$/i);
  if (lodging) return { kind: "lodging", kinds: freeformKinds(text, "lodging"), shape: "point", title: `住宿：${lodging[1].trim()}`, location: lodging[1].trim() };
  const rental = text.match(/^(?:租車(?:取車|還車)?|取車|還車)\s*[:：在於]?\s*(.+)$/i)
    ?? text.match(/^(?:rental[- ]car\s+(?:pick[- ]?up|drop[- ]?off)|rental[- ]car\s+(?:pickup|dropoff)|car\s+(?:pick[- ]?up|drop[- ]?off))\s+(?:at|in)\s+(.+)$/i);
  if (rental) return { kind: "rental_car", kinds: freeformKinds(text, "rental_car"), shape: "point", title: `租車：${rental[1].trim()}`, location: rental[1].trim() };
  return null;
}

function freeformKinds(text: string, fallback: ExtractedTripItem["kind"]): ExtractedTripItem["kind"][] {
  const inferred = inferKinds(text).filter((kind) => kind !== "other");
  return inferred.length > 0 ? inferred : [fallback];
}

function makeFreeformItem(input: Pick<ExtractedTripItem, "kind" | "kinds" | "shape" | "title" | "startsAt" | "origin" | "destination" | "location" | "sourceLine" | "sourceExcerpt">): ExtractedTripItem {
  return { ...input, shapeSource: "inferred", status: "provisional" };
}

function isFreeformQuestion(text: string): boolean {
  return /[?？]$/.test(text) || /^(?:推薦|推荐|怎麼|怎么|如何|哪裡|哪里|有沒有|是否|可以|請問|请问)\b/.test(text) || /\b(?:推薦|推荐)\b/.test(text);
}

function parseMarkdownCandidate(line: string, sourceLine: number): ParsedItineraryCandidate {
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
  const explicitTimezone = fields.timezone?.trim();
  const validTimezone = explicitTimezone && isIanaTimezone(explicitTimezone) ? explicitTimezone : undefined;
  const originTimezone = fields.origin_timezone?.trim();
  const destinationTimezone = fields.destination_timezone?.trim();
  const validOriginTimezone = originTimezone && isIanaTimezone(originTimezone) ? originTimezone : undefined;
  const validDestinationTimezone = destinationTimezone && isIanaTimezone(destinationTimezone) ? destinationTimezone : undefined;
  if (explicitTimezone && !validTimezone) {
    issues.push({ code: "invalid_timezone", message: `第 ${sourceLine} 行的 timezone 不是有效的 IANA timezone：${explicitTimezone}。` });
  }
  if (originTimezone && !validOriginTimezone) issues.push({ code: "invalid_endpoint_timezone", message: `第 ${sourceLine} 行的 origin_timezone 不是有效的 IANA timezone：${originTimezone}。` });
  if (destinationTimezone && !validDestinationTimezone) issues.push({ code: "invalid_endpoint_timezone", message: `第 ${sourceLine} 行的 destination_timezone 不是有效的 IANA timezone：${destinationTimezone}。` });
  return {
    item: {
      kind: kinds[0], kinds, shape, shapeSource, title, status: status as TripItemStatus,
      startsAt: startsAt || undefined, endsAt: fields.ends_at || undefined, location: location || undefined, origin, destination, originTimezone: validOriginTimezone, destinationTimezone: validDestinationTimezone,
      notes: notes || undefined, timezone: validTimezone, timezoneSource: validTimezone ? "explicit" : (explicitTimezone ? "fallback" : undefined), deadlineAt: fields.deadline || undefined,
      sourceLine, sourceExcerpt: line.trim(),
    },
    issues,
  };
}

function isIanaTimezone(timezone: string): boolean {
  if (!timezone || (timezone !== "UTC" && !timezone.includes("/"))) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

function resolveItemTimezone(item: ExtractedTripItem, tripTimezone: string): { value: string | null; source: TimezoneSource | null } {
  if (item.startsAt && isDateOnly(item.startsAt)) return { value: tripTimezone, source: null };
  if (item.timezone) {
    if (!isIanaTimezone(item.timezone)) throw new InvalidTimezoneError(`Item timezone ${item.timezone} is not a valid IANA timezone.`);
    return { value: item.timezone, source: item.timezoneSource ?? "explicit" };
  }
  if (item.timezoneSource === "fallback") return { value: tripTimezone, source: "fallback" };
  const inferred = inferLocationTimezone(item.location ?? item.origin ?? item.destination ?? item.title);
  if (inferred) return { value: inferred, source: "inferred" };
  return { value: tripTimezone, source: "fallback" };
}

function resolveEndpointTimezones(item: ExtractedTripItem): { origin?: string; destination?: string } {
  if (item.shape !== "route") return {};
  if (item.originTimezone && !isIanaTimezone(item.originTimezone)) throw new InvalidTimezoneError(`Origin timezone ${item.originTimezone} is not a valid IANA timezone.`);
  if (item.destinationTimezone && !isIanaTimezone(item.destinationTimezone)) throw new InvalidTimezoneError(`Destination timezone ${item.destinationTimezone} is not a valid IANA timezone.`);
  return {
    origin: item.originTimezone ?? inferLocationTimezone(item.origin),
    destination: item.destinationTimezone ?? inferLocationTimezone(item.destination),
  };
}

function inferLocationTimezone(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.toLocaleLowerCase();
  if (/(?:las vegas|mccarran|primrose|wolfgang puck|egg works)/i.test(normalized)) return "America/Los_Angeles";
  if (/(?:st\.? george|kanab)/i.test(normalized)) return "America/Denver";
  if (/(?:page|lake powell)/i.test(normalized)) return "America/Phoenix";
  return undefined;
}

function containsSensitiveTravelData(markdown: string): boolean {
  return /(?:護照(?:號碼|号码)?|passport(?:\s*(?:number|no\.?))?)\s*[:：#-]?\s*[A-Z0-9]{6,}/i.test(markdown)
    || /(?:信用卡|credit\s*card|card\s*number|卡號)\s*[:：#-]?\s*\d[\d -]{7,}/i.test(markdown);
}

function currentDateInTimezone(timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function findUnparseableLineIssues(sourceId: string, markdown: string): ReviewIssue[] {
  return markdown.split(/\r?\n/).flatMap((line, index) => {
    const parsed = parseItineraryCandidate(line, index + 1);
    if (!/^\s*-\s*\[/.test(line) && !parsed.issue && !parsed.issues?.length) return [];
    if (parsed.issue) return [{ ...parsed.issue, sourceId, sourceLine: index + 1, sourceExcerpt: line.trim(), proposalIds: [] }];
    if (parsed.issues?.length) return parsed.issues.map((issue) => ({ ...issue, sourceId, sourceLine: index + 1, sourceExcerpt: line.trim(), proposalIds: [] }));
    if (parsed.item || parsed.items?.length) return [];
    return [{ code: "unparseable_line" as const, message: `第 ${index + 1} 行無法解析為有效行程候選。`, sourceId, sourceLine: index + 1, sourceExcerpt: line.trim(), proposalIds: [] }];
  });
}

type ScheduledItem = Pick<ExtractedTripItem, "localDate" | "startsAt" | "endsAt">;

function isSameDateOrOverlapping(left: ScheduledItem, right: ScheduledItem, tripTimezone: string): boolean {
  if (dateKey(left.localDate, left.startsAt, tripTimezone) === dateKey(right.localDate, right.startsAt, tripTimezone)) return true;
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

function dateKey(localDate: string | undefined, value: string | undefined, tripTimezone: string): string | null {
  if (localDate) return localDate;
  if (!value) return null;
  if (isDateOnly(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: tripTimezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(parsed);
}

function buildReviewIssues(proposals: Proposal[], confirmed: TripItem[]): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  for (const proposal of proposals) {
    if (!proposal.startsAt && !proposal.localDate) issues.push({ code: "missing_start_time", message: `「${proposal.title}」缺少日期。`, proposalIds: [proposal.id] });
    if (proposal.startsAt && !isDateOnly(proposal.startsAt) && proposal.timezoneSource === "fallback") {
      issues.push({ code: "missing_timezone", message: `「${proposal.title}」有時間但缺少 IANA timezone，暫以 Trip Timezone fallback。`, proposalIds: [proposal.id] });
    } else if (proposal.startsAt && !isDateOnly(proposal.startsAt) && !proposal.timezone) {
      issues.push({ code: "missing_timezone", message: `「${proposal.title}」有時間但缺少 IANA timezone。`, proposalIds: [proposal.id] });
    }
    if (proposal.shape === "route" && proposal.startsAt && !isDateOnly(proposal.startsAt) && (!proposal.originTimezone || !proposal.destinationTimezone)) {
      issues.push({ code: "missing_endpoint_timezone", message: `「${proposal.title}」缺少起點或終點 IANA timezone，查詢將使用 Route timezone/Trip Timezone compatibility fallback。`, proposalIds: [proposal.id] });
    }
    if (proposal.startsAt && !isDateOnly(proposal.startsAt) && isOffsetlessDateTime(proposal.startsAt)) {
      issues.push({ code: "ambiguous_local_time", message: `「${proposal.title}」的時間沒有 UTC offset；若落在 DST 轉換時段，可能存在重複或不存在的 local time，請補充 offset。`, proposalIds: [proposal.id] });
    }
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

function isOffsetlessDateTime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value);
}
