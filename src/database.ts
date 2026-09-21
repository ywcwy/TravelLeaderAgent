import { DatabaseSync } from "node:sqlite";
import { normalizeItemLocations } from "./location-normalization.ts";

export type SqlValue = string | number | null;

export class TravelDatabase {
  readonly connection: DatabaseSync;

  constructor(path = ":memory:") {
    this.connection = new DatabaseSync(path);
    this.connection.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS travel_groups (
        id TEXT PRIMARY KEY,
        line_group_id TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS trips (
        id TEXT PRIMARY KEY,
        travel_group_id TEXT NOT NULL REFERENCES travel_groups(id),
        title TEXT NOT NULL,
        timezone TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
        created_at TEXT NOT NULL,
        archived_at TEXT
      );

      CREATE TABLE IF NOT EXISTS trip_access_policies (
        trip_id TEXT PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
        member_can_view_pending INTEGER NOT NULL DEFAULT 1 CHECK (member_can_view_pending IN (0, 1)),
        member_can_view_review_issues INTEGER NOT NULL DEFAULT 1 CHECK (member_can_view_review_issues IN (0, 1)),
        member_can_view_cancelled_history INTEGER NOT NULL DEFAULT 0 CHECK (member_can_view_cancelled_history IN (0, 1)),
        member_can_view_source_content INTEGER NOT NULL DEFAULT 0 CHECK (member_can_view_source_content IN (0, 1)),
        updated_by TEXT,
        updated_at TEXT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS one_active_trip_per_group
        ON trips(travel_group_id) WHERE status = 'active';

      CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,
        trip_id TEXT NOT NULL REFERENCES trips(id),
        type TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        content TEXT NOT NULL,
        source_time TEXT NOT NULL,
        provider TEXT,
        provider_message_id TEXT,
        provider_group_id TEXT,
        provider_user_id TEXT,
        created_at TEXT NOT NULL,
        UNIQUE (trip_id, idempotency_key)
      );

      CREATE TABLE IF NOT EXISTS extraction_drafts (
        id TEXT PRIMARY KEY,
        trip_id TEXT NOT NULL REFERENCES trips(id),
        source_id TEXT NOT NULL REFERENCES sources(id),
        originating_user_id TEXT,
        revision INTEGER NOT NULL DEFAULT 1,
        previous_draft_id TEXT REFERENCES extraction_drafts(id),
        status TEXT NOT NULL CHECK (status IN ('pending_confirmation', 'confirmed', 'cancelled', 'failed')),
        payload_json TEXT NOT NULL,
        proposal_ids_json TEXT NOT NULL DEFAULT '[]',
        provider TEXT NOT NULL DEFAULT 'unknown',
        model TEXT NOT NULL DEFAULT 'unknown',
        prompt_version TEXT NOT NULL DEFAULT 'extraction-draft-v3',
        confirmed_at TEXT,
        cancelled_at TEXT,
        cancelled_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS import_chunks (
        id TEXT PRIMARY KEY,
        trip_id TEXT NOT NULL REFERENCES trips(id),
        source_id TEXT NOT NULL REFERENCES sources(id),
        import_batch_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed', 'blocked', 'removed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        provider_calls INTEGER NOT NULL DEFAULT 0,
        error_code TEXT,
        error_message TEXT,
        result_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (source_id, ordinal)
      );
      CREATE INDEX IF NOT EXISTS import_chunks_source_ordinal ON import_chunks(source_id, ordinal);

      CREATE TABLE IF NOT EXISTS import_document_contexts (
        source_id TEXT PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
        trip_id TEXT NOT NULL REFERENCES trips(id),
        version TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS extraction_cache (
        cache_key TEXT PRIMARY KEY,
        content_hash TEXT NOT NULL,
        context_key TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt_version TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('success', 'error')),
        payload_json TEXT,
        error_code TEXT,
        error_message TEXT,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS guard_revisions (
        id TEXT PRIMARY KEY,
        trip_id TEXT NOT NULL REFERENCES trips(id),
        source_id TEXT NOT NULL REFERENCES sources(id),
        chunk_id TEXT REFERENCES import_chunks(id),
        draft_id TEXT REFERENCES extraction_drafts(id),
        rule_version TEXT NOT NULL,
        field_path TEXT NOT NULL,
        before_json TEXT NOT NULL,
        after_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS guard_revisions_source ON guard_revisions(source_id, created_at);

      CREATE UNIQUE INDEX IF NOT EXISTS extraction_draft_source_revision ON extraction_drafts(source_id, revision);

      CREATE TABLE IF NOT EXISTS members (
        trip_id TEXT NOT NULL REFERENCES trips(id),
        line_user_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
        revoked_at TEXT,
        PRIMARY KEY (trip_id, line_user_id)
      );

      CREATE TABLE IF NOT EXISTS trip_items (
        id TEXT PRIMARY KEY,
        trip_id TEXT NOT NULL REFERENCES trips(id),
        source_id TEXT NOT NULL REFERENCES sources(id),
        replacement_for_item_id TEXT REFERENCES trip_items(id),
        kind TEXT NOT NULL,
        shape TEXT,
        shape_source TEXT,
        origin TEXT,
        destination TEXT,
        origin_timezone TEXT,
        destination_timezone TEXT,
        title TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('confirmed', 'provisional', 'open_decision', 'conflicted', 'cancelled')),
        local_date TEXT,
        starts_at TEXT,
        ends_at TEXT,
        start_time_flexibility TEXT CHECK (start_time_flexibility IN ('required', 'estimated', 'flexible') OR start_time_flexibility IS NULL),
        end_time_flexibility TEXT CHECK (end_time_flexibility IN ('required', 'estimated', 'flexible') OR end_time_flexibility IS NULL),
        time_window TEXT CHECK (time_window IN ('morning', 'afternoon', 'evening', 'night') OR time_window IS NULL),
        assumptions_json TEXT NOT NULL DEFAULT '[]',
        timezone TEXT,
        timezone_source TEXT,
        location TEXT,
        city TEXT,
        region TEXT,
        country TEXT,
        macro_region TEXT,
        location_source TEXT,
        location_confidence TEXT,
        origin_city TEXT,
        origin_region TEXT,
        origin_country TEXT,
        origin_macro_region TEXT,
        destination_city TEXT,
        destination_region TEXT,
        destination_country TEXT,
        destination_macro_region TEXT,
        notes TEXT,
        confirmed_by TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        trip_id TEXT NOT NULL REFERENCES trips(id),
        title TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('open', 'resolved', 'needs_options', 'cancelled')),
        selected_proposal_id TEXT,
        resolved_by TEXT,
        resolved_at TEXT,
        cancelled_by TEXT,
        cancelled_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS proposals (
        id TEXT PRIMARY KEY,
        trip_id TEXT NOT NULL REFERENCES trips(id),
        source_id TEXT NOT NULL REFERENCES sources(id),
        decision_id TEXT REFERENCES decisions(id),
        replacement_for_item_id TEXT REFERENCES trip_items(id),
        removal_for_item_id TEXT REFERENCES trip_items(id),
        kind TEXT NOT NULL,
        shape TEXT,
        shape_source TEXT,
        origin TEXT,
        destination TEXT,
        origin_timezone TEXT,
        destination_timezone TEXT,
        title TEXT NOT NULL,
        item_status TEXT NOT NULL CHECK (item_status IN ('confirmed', 'provisional', 'open_decision', 'conflicted', 'cancelled')),
        proposal_status TEXT NOT NULL CHECK (proposal_status IN ('pending', 'confirmed', 'rejected')),
        local_date TEXT,
        starts_at TEXT,
        ends_at TEXT,
        start_time_flexibility TEXT CHECK (start_time_flexibility IN ('required', 'estimated', 'flexible') OR start_time_flexibility IS NULL),
        end_time_flexibility TEXT CHECK (end_time_flexibility IN ('required', 'estimated', 'flexible') OR end_time_flexibility IS NULL),
        time_window TEXT CHECK (time_window IN ('morning', 'afternoon', 'evening', 'night') OR time_window IS NULL),
        assumptions_json TEXT NOT NULL DEFAULT '[]',
        timezone TEXT,
        timezone_source TEXT,
        location TEXT,
        city TEXT,
        region TEXT,
        country TEXT,
        macro_region TEXT,
        location_source TEXT,
        location_confidence TEXT,
        origin_city TEXT,
        origin_region TEXT,
        origin_country TEXT,
        origin_macro_region TEXT,
        destination_city TEXT,
        destination_region TEXT,
        destination_country TEXT,
        destination_macro_region TEXT,
        notes TEXT,
        deadline_at TEXT,
        confirmed_trip_item_id TEXT REFERENCES trip_items(id),
        rejection_reason TEXT,
        rejected_by TEXT,
        rejected_at TEXT,
        source_line INTEGER,
        source_excerpt TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS proposal_kinds (
        proposal_id TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        PRIMARY KEY (proposal_id, kind)
      );

      CREATE TABLE IF NOT EXISTS trip_item_kinds (
        trip_item_id TEXT NOT NULL REFERENCES trip_items(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        PRIMARY KEY (trip_item_id, kind)
      );

      CREATE TABLE IF NOT EXISTS reminders (
        id TEXT PRIMARY KEY,
        trip_id TEXT NOT NULL REFERENCES trips(id),
        dedupe_key TEXT NOT NULL UNIQUE,
        due_at TEXT NOT NULL,
        content TEXT NOT NULL,
        sent_at TEXT
      );

      CREATE TABLE IF NOT EXISTS webhook_inbox_events (
        event_id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        group_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        trip_id TEXT NOT NULL,
        text TEXT NOT NULL,
        received_at TEXT NOT NULL,
        raw_payload TEXT,
        reply_token TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
        outcome TEXT NOT NULL CHECK (outcome IN ('accepted', 'processed', 'retryable_failure', 'dead_letter')),
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        lease_until TEXT,
        lease_token TEXT,
        next_attempt_at TEXT,
        completed_at TEXT,
        duplicate_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS query_router_events (
        id TEXT PRIMARY KEY,
        inbox_event_id TEXT NOT NULL REFERENCES webhook_inbox_events(event_id),
        intent TEXT,
        selected_tool TEXT,
        outcome TEXT NOT NULL,
        reason TEXT,
        latency_ms INTEGER NOT NULL,
        provider TEXT,
        model TEXT,
        prompt_version TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS query_router_events_inbox ON query_router_events(inbox_event_id, created_at);
    `);
    const tripItemColumns = this.connection.prepare(`PRAGMA table_info(trip_items)`).all() as Array<{ name: string }>;
    if (!tripItemColumns.some((column) => column.name === "replacement_for_item_id")) {
      this.connection.exec(`ALTER TABLE trip_items ADD COLUMN replacement_for_item_id TEXT REFERENCES trip_items(id)`);
    }
    const proposalSchemaColumns = this.connection.prepare(`PRAGMA table_info(proposals)`).all() as Array<{ name: string }>;
    if (!proposalSchemaColumns.some((column) => column.name === "removal_for_item_id")) {
      this.connection.exec(`ALTER TABLE proposals ADD COLUMN removal_for_item_id TEXT REFERENCES trip_items(id)`);
    }
    const memberColumns = this.connection.prepare(`PRAGMA table_info(members)`).all() as Array<{ name: string }>;
    if (!memberColumns.some((column) => column.name === "revoked_at")) {
      this.connection.exec(`ALTER TABLE members ADD COLUMN revoked_at TEXT`);
    }
    const inboxColumns = this.connection.prepare(`PRAGMA table_info(webhook_inbox_events)`).all() as Array<{ name: string }>;
    if (!inboxColumns.some((column) => column.name === "lease_token")) this.connection.exec(`ALTER TABLE webhook_inbox_events ADD COLUMN lease_token TEXT`);
    if (!inboxColumns.some((column) => column.name === "next_attempt_at")) this.connection.exec(`ALTER TABLE webhook_inbox_events ADD COLUMN next_attempt_at TEXT`);
    const sourceColumns = this.connection.prepare(`PRAGMA table_info(sources)`).all() as Array<{ name: string }>;
    if (!sourceColumns.some((column) => column.name === "provider")) this.connection.exec(`ALTER TABLE sources ADD COLUMN provider TEXT`);
    if (!sourceColumns.some((column) => column.name === "provider_message_id")) this.connection.exec(`ALTER TABLE sources ADD COLUMN provider_message_id TEXT`);
    if (!sourceColumns.some((column) => column.name === "provider_group_id")) this.connection.exec(`ALTER TABLE sources ADD COLUMN provider_group_id TEXT`);
    if (!sourceColumns.some((column) => column.name === "provider_user_id")) this.connection.exec(`ALTER TABLE sources ADD COLUMN provider_user_id TEXT`);
    const extractionDraftTable = this.connection.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'extraction_drafts'`).get() as { sql: string } | undefined;
    if (extractionDraftTable?.sql.includes("source_id TEXT NOT NULL UNIQUE")) {
      const legacyDraftColumns = new Set((this.connection.prepare(`PRAGMA table_info(extraction_drafts)`).all() as Array<{ name: string }>).map((column) => column.name));
      const legacyOriginatingUser = legacyDraftColumns.has("originating_user_id") ? "originating_user_id" : "NULL";
      const legacyProposalIds = legacyDraftColumns.has("proposal_ids_json") ? "proposal_ids_json" : "'[]'";
      const legacyConfirmedAt = legacyDraftColumns.has("confirmed_at") ? "confirmed_at" : "NULL";
      this.connection.exec(`PRAGMA foreign_keys = OFF`);
      try {
        this.connection.exec("BEGIN IMMEDIATE");
        this.connection.exec(`CREATE TABLE extraction_drafts_v2 (id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id), source_id TEXT NOT NULL REFERENCES sources(id), originating_user_id TEXT, revision INTEGER NOT NULL DEFAULT 1, previous_draft_id TEXT REFERENCES extraction_drafts(id), status TEXT NOT NULL CHECK (status IN ('pending_confirmation', 'confirmed', 'cancelled', 'failed')), payload_json TEXT NOT NULL, proposal_ids_json TEXT NOT NULL DEFAULT '[]', provider TEXT NOT NULL DEFAULT 'unknown', model TEXT NOT NULL DEFAULT 'unknown', prompt_version TEXT NOT NULL DEFAULT 'extraction-draft-v3', confirmed_at TEXT, cancelled_at TEXT, cancelled_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
        this.connection.exec(`INSERT INTO extraction_drafts_v2 (id, trip_id, source_id, originating_user_id, revision, previous_draft_id, status, payload_json, proposal_ids_json, confirmed_at, cancelled_at, cancelled_by, created_at, updated_at) SELECT id, trip_id, source_id, ${legacyOriginatingUser}, 1, NULL, status, payload_json, ${legacyProposalIds}, ${legacyConfirmedAt}, NULL, NULL, created_at, updated_at FROM extraction_drafts`);
        this.connection.exec(`DROP TABLE extraction_drafts`);
        this.connection.exec(`ALTER TABLE extraction_drafts_v2 RENAME TO extraction_drafts`);
        this.connection.exec("COMMIT");
      } catch (error) {
        this.connection.exec("ROLLBACK");
        throw error;
      } finally {
        this.connection.exec(`PRAGMA foreign_keys = ON`);
      }
    }
    const extractionDraftColumns = this.connection.prepare(`PRAGMA table_info(extraction_drafts)`).all() as Array<{ name: string }>;
    if (!extractionDraftColumns.some((column) => column.name === "originating_user_id")) this.connection.exec(`ALTER TABLE extraction_drafts ADD COLUMN originating_user_id TEXT`);
    if (!extractionDraftColumns.some((column) => column.name === "proposal_ids_json")) this.connection.exec(`ALTER TABLE extraction_drafts ADD COLUMN proposal_ids_json TEXT NOT NULL DEFAULT '[]'`);
    if (!extractionDraftColumns.some((column) => column.name === "confirmed_at")) this.connection.exec(`ALTER TABLE extraction_drafts ADD COLUMN confirmed_at TEXT`);
    if (!extractionDraftColumns.some((column) => column.name === "revision")) this.connection.exec(`ALTER TABLE extraction_drafts ADD COLUMN revision INTEGER NOT NULL DEFAULT 1`);
    if (!extractionDraftColumns.some((column) => column.name === "previous_draft_id")) this.connection.exec(`ALTER TABLE extraction_drafts ADD COLUMN previous_draft_id TEXT REFERENCES extraction_drafts(id)`);
    if (!extractionDraftColumns.some((column) => column.name === "cancelled_at")) this.connection.exec(`ALTER TABLE extraction_drafts ADD COLUMN cancelled_at TEXT`);
    if (!extractionDraftColumns.some((column) => column.name === "cancelled_by")) this.connection.exec(`ALTER TABLE extraction_drafts ADD COLUMN cancelled_by TEXT`);
    if (!extractionDraftColumns.some((column) => column.name === "provider")) this.connection.exec(`ALTER TABLE extraction_drafts ADD COLUMN provider TEXT NOT NULL DEFAULT 'unknown'`);
    if (!extractionDraftColumns.some((column) => column.name === "model")) this.connection.exec(`ALTER TABLE extraction_drafts ADD COLUMN model TEXT NOT NULL DEFAULT 'unknown'`);
    if (!extractionDraftColumns.some((column) => column.name === "prompt_version")) this.connection.exec(`ALTER TABLE extraction_drafts ADD COLUMN prompt_version TEXT NOT NULL DEFAULT 'extraction-draft-v3'`);
    this.connection.exec(`CREATE UNIQUE INDEX IF NOT EXISTS extraction_draft_source_revision ON extraction_drafts(source_id, revision)`);
    const importChunkColumns = this.connection.prepare(`PRAGMA table_info(import_chunks)`).all() as Array<{ name: string }>;
    if (!importChunkColumns.some((column) => column.name === "error_code")) this.connection.exec(`ALTER TABLE import_chunks ADD COLUMN error_code TEXT`);
    if (!importChunkColumns.some((column) => column.name === "error_message")) this.connection.exec(`ALTER TABLE import_chunks ADD COLUMN error_message TEXT`);
    if (!importChunkColumns.some((column) => column.name === "result_json")) this.connection.exec(`ALTER TABLE import_chunks ADD COLUMN result_json TEXT`);
    if (!importChunkColumns.some((column) => column.name === "provider_calls")) this.connection.exec(`ALTER TABLE import_chunks ADD COLUMN provider_calls INTEGER NOT NULL DEFAULT 0`);
    if (!importChunkColumns.some((column) => column.name === "section_title")) this.connection.exec(`ALTER TABLE import_chunks ADD COLUMN section_title TEXT`);
    if (!importChunkColumns.some((column) => column.name === "section_date_label")) this.connection.exec(`ALTER TABLE import_chunks ADD COLUMN section_date_label TEXT`);
    if (!importChunkColumns.some((column) => column.name === "section_local_date")) this.connection.exec(`ALTER TABLE import_chunks ADD COLUMN section_local_date TEXT`);
    if (!importChunkColumns.some((column) => column.name === "section_date_provenance")) this.connection.exec(`ALTER TABLE import_chunks ADD COLUMN section_date_provenance TEXT NOT NULL DEFAULT 'undated'`);
    if (!importChunkColumns.some((column) => column.name === "document_context_version")) this.connection.exec(`ALTER TABLE import_chunks ADD COLUMN document_context_version TEXT NOT NULL DEFAULT 'document-context-v1'`);
    const decisionColumns = this.connection.prepare(`PRAGMA table_info(decisions)`).all() as Array<{ name: string }>;
    const decisionTable = this.connection.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'decisions'`).get() as { sql: string } | undefined;
    if (decisionTable && !decisionTable.sql.includes("needs_options")) {
      this.connection.exec(`PRAGMA foreign_keys = OFF`);
      try {
        this.connection.exec("BEGIN IMMEDIATE");
        this.connection.exec(`CREATE TABLE decisions_v2 (id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id), title TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('open', 'resolved', 'needs_options', 'cancelled')), selected_proposal_id TEXT, resolved_by TEXT, resolved_at TEXT, cancelled_by TEXT, cancelled_at TEXT, created_at TEXT NOT NULL)`);
        this.connection.exec(`INSERT INTO decisions_v2 (id, trip_id, title, status, selected_proposal_id, resolved_by, resolved_at, created_at) SELECT id, trip_id, title, status, selected_proposal_id, resolved_by, resolved_at, created_at FROM decisions`);
        this.connection.exec(`DROP TABLE decisions`);
        this.connection.exec(`ALTER TABLE decisions_v2 RENAME TO decisions`);
        this.connection.exec("COMMIT");
      } catch (error) {
        this.connection.exec("ROLLBACK");
        throw error;
      } finally {
        this.connection.exec(`PRAGMA foreign_keys = ON`);
      }
    } else {
      if (!decisionColumns.some((column) => column.name === "cancelled_by")) this.connection.exec(`ALTER TABLE decisions ADD COLUMN cancelled_by TEXT`);
      if (!decisionColumns.some((column) => column.name === "cancelled_at")) this.connection.exec(`ALTER TABLE decisions ADD COLUMN cancelled_at TEXT`);
    }
    const proposalColumns = this.connection.prepare(`PRAGMA table_info(proposals)`).all() as Array<{ name: string }>;
    if (!proposalColumns.some((column) => column.name === "local_date")) this.connection.exec(`ALTER TABLE proposals ADD COLUMN local_date TEXT`);
    if (!proposalColumns.some((column) => column.name === "confirmed_trip_item_id")) this.connection.exec(`ALTER TABLE proposals ADD COLUMN confirmed_trip_item_id TEXT REFERENCES trip_items(id)`);
    if (!proposalColumns.some((column) => column.name === "rejection_reason")) this.connection.exec(`ALTER TABLE proposals ADD COLUMN rejection_reason TEXT`);
    if (!proposalColumns.some((column) => column.name === "rejected_by")) this.connection.exec(`ALTER TABLE proposals ADD COLUMN rejected_by TEXT`);
    if (!proposalColumns.some((column) => column.name === "rejected_at")) this.connection.exec(`ALTER TABLE proposals ADD COLUMN rejected_at TEXT`);
    if (!proposalColumns.some((column) => column.name === "shape")) this.connection.exec(`ALTER TABLE proposals ADD COLUMN shape TEXT`);
    if (!proposalColumns.some((column) => column.name === "shape_source")) this.connection.exec(`ALTER TABLE proposals ADD COLUMN shape_source TEXT`);
    if (!proposalColumns.some((column) => column.name === "origin")) this.connection.exec(`ALTER TABLE proposals ADD COLUMN origin TEXT`);
    if (!proposalColumns.some((column) => column.name === "destination")) this.connection.exec(`ALTER TABLE proposals ADD COLUMN destination TEXT`);
    if (!proposalColumns.some((column) => column.name === "origin_timezone")) this.connection.exec(`ALTER TABLE proposals ADD COLUMN origin_timezone TEXT`);
    if (!proposalColumns.some((column) => column.name === "destination_timezone")) this.connection.exec(`ALTER TABLE proposals ADD COLUMN destination_timezone TEXT`);
    if (!proposalColumns.some((column) => column.name === "timezone_source")) this.connection.exec(`ALTER TABLE proposals ADD COLUMN timezone_source TEXT`);
    if (!proposalColumns.some((column) => column.name === "start_time_flexibility")) this.connection.exec(`ALTER TABLE proposals ADD COLUMN start_time_flexibility TEXT`);
    if (!proposalColumns.some((column) => column.name === "end_time_flexibility")) this.connection.exec(`ALTER TABLE proposals ADD COLUMN end_time_flexibility TEXT`);
    if (!proposalColumns.some((column) => column.name === "time_window")) this.connection.exec(`ALTER TABLE proposals ADD COLUMN time_window TEXT`);
    if (!proposalColumns.some((column) => column.name === "assumptions_json")) this.connection.exec(`ALTER TABLE proposals ADD COLUMN assumptions_json TEXT NOT NULL DEFAULT '[]'`);
    const tripItemColumnsAfterMigration = this.connection.prepare(`PRAGMA table_info(trip_items)`).all() as Array<{ name: string }>;
    if (!tripItemColumnsAfterMigration.some((column) => column.name === "local_date")) this.connection.exec(`ALTER TABLE trip_items ADD COLUMN local_date TEXT`);
    if (!tripItemColumnsAfterMigration.some((column) => column.name === "shape")) this.connection.exec(`ALTER TABLE trip_items ADD COLUMN shape TEXT`);
    if (!tripItemColumnsAfterMigration.some((column) => column.name === "shape_source")) this.connection.exec(`ALTER TABLE trip_items ADD COLUMN shape_source TEXT`);
    if (!tripItemColumnsAfterMigration.some((column) => column.name === "origin")) this.connection.exec(`ALTER TABLE trip_items ADD COLUMN origin TEXT`);
    if (!tripItemColumnsAfterMigration.some((column) => column.name === "destination")) this.connection.exec(`ALTER TABLE trip_items ADD COLUMN destination TEXT`);
    if (!tripItemColumnsAfterMigration.some((column) => column.name === "origin_timezone")) this.connection.exec(`ALTER TABLE trip_items ADD COLUMN origin_timezone TEXT`);
    if (!tripItemColumnsAfterMigration.some((column) => column.name === "destination_timezone")) this.connection.exec(`ALTER TABLE trip_items ADD COLUMN destination_timezone TEXT`);
    if (!tripItemColumnsAfterMigration.some((column) => column.name === "timezone_source")) this.connection.exec(`ALTER TABLE trip_items ADD COLUMN timezone_source TEXT`);
    if (!tripItemColumnsAfterMigration.some((column) => column.name === "start_time_flexibility")) this.connection.exec(`ALTER TABLE trip_items ADD COLUMN start_time_flexibility TEXT`);
    if (!tripItemColumnsAfterMigration.some((column) => column.name === "end_time_flexibility")) this.connection.exec(`ALTER TABLE trip_items ADD COLUMN end_time_flexibility TEXT`);
    if (!tripItemColumnsAfterMigration.some((column) => column.name === "time_window")) this.connection.exec(`ALTER TABLE trip_items ADD COLUMN time_window TEXT`);
    if (!tripItemColumnsAfterMigration.some((column) => column.name === "assumptions_json")) this.connection.exec(`ALTER TABLE trip_items ADD COLUMN assumptions_json TEXT NOT NULL DEFAULT '[]'`);
    this.connection.exec(`UPDATE proposals SET shape = 'point', shape_source = 'inferred' WHERE shape IS NULL AND location IS NOT NULL`);
    this.connection.exec(`UPDATE trip_items SET shape = 'point', shape_source = 'inferred' WHERE shape IS NULL AND location IS NOT NULL`);
    this.backfillTimezoneMetadata("proposals");
    this.backfillTimezoneMetadata("trip_items");
    this.backfillLocationNormalization("proposals");
    this.backfillLocationNormalization("trip_items");
    this.connection.exec(`INSERT OR IGNORE INTO proposal_kinds (proposal_id, kind) SELECT id, kind FROM proposals WHERE kind IS NOT NULL`);
    this.connection.exec(`INSERT OR IGNORE INTO trip_item_kinds (trip_item_id, kind) SELECT id, kind FROM trip_items WHERE kind IS NOT NULL`);
    this.connection.exec(`INSERT OR IGNORE INTO trip_access_policies (trip_id) SELECT id FROM trips`);
  }

  close(): void {
    this.connection.close();
  }

  private backfillTimezoneMetadata(table: "proposals" | "trip_items"): void {
    const rows = this.connection.prepare(`SELECT id, trip_id, timezone FROM ${table} WHERE timezone_source IS NULL AND starts_at IS NOT NULL AND starts_at NOT GLOB '????-??-??'`).all() as Array<{ id: string; trip_id: string; timezone: string | null }>;
    const tripTimezone = this.connection.prepare(`SELECT timezone FROM trips WHERE id = ?`) as { get: (tripId: string) => { timezone: string } | undefined };
    const update = this.connection.prepare(`UPDATE ${table} SET timezone = ?, timezone_source = ? WHERE id = ?`);
    for (const row of rows) {
      const valid = row.timezone !== null && isIanaTimezoneValue(row.timezone);
      const fallback = tripTimezone.get(row.trip_id)?.timezone ?? "UTC";
      update.run(valid ? row.timezone : fallback, valid ? "explicit" : "fallback", row.id);
    }
  }

  private backfillLocationNormalization(table: "proposals" | "trip_items"): void {
    const columns = ["city", "region", "country", "macro_region", "location_source", "location_confidence", "location_canonical_id", "origin_city", "origin_region", "origin_country", "origin_macro_region", "origin_canonical_id", "destination_city", "destination_region", "destination_country", "destination_macro_region", "destination_canonical_id"];
    const existing = this.connection.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    for (const column of columns) if (!existing.some((entry) => entry.name === column)) this.connection.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
    const rows = this.connection.prepare(`SELECT id, location, origin, destination FROM ${table}`).all() as Array<{ id: string; location: string | null; origin: string | null; destination: string | null }>;
    const update = this.connection.prepare(`UPDATE ${table} SET city = ?, region = ?, country = ?, macro_region = ?, location_source = ?, location_confidence = ?, location_canonical_id = ?, origin_city = ?, origin_region = ?, origin_country = ?, origin_macro_region = ?, origin_canonical_id = ?, destination_city = ?, destination_region = ?, destination_country = ?, destination_macro_region = ?, destination_canonical_id = ? WHERE id = ?`);
    for (const row of rows) {
      const normalized = normalizeItemLocations(row);
      const location = normalized.location; const origin = normalized.origin; const destination = normalized.destination;
      update.run(location?.city ?? null, location?.region ?? null, location?.country ?? null, location?.macroRegion ?? null, location?.source ?? null, location?.confidence ?? null, location?.canonicalId ?? null, origin?.city ?? null, origin?.region ?? null, origin?.country ?? null, origin?.macroRegion ?? null, origin?.canonicalId ?? null, destination?.city ?? null, destination?.region ?? null, destination?.country ?? null, destination?.macroRegion ?? null, destination?.canonicalId ?? null, row.id);
    }
  }
}

function isIanaTimezoneValue(timezone: string): boolean {
  if (!timezone || (timezone !== "UTC" && !timezone.includes("/"))) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}
