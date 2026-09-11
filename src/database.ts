import { DatabaseSync } from "node:sqlite";

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
        title TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('confirmed', 'provisional', 'open_decision', 'conflicted', 'cancelled')),
        starts_at TEXT,
        ends_at TEXT,
        timezone TEXT,
        location TEXT,
        notes TEXT,
        confirmed_by TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        trip_id TEXT NOT NULL REFERENCES trips(id),
        title TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
        selected_proposal_id TEXT,
        resolved_by TEXT,
        resolved_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS proposals (
        id TEXT PRIMARY KEY,
        trip_id TEXT NOT NULL REFERENCES trips(id),
        source_id TEXT NOT NULL REFERENCES sources(id),
        decision_id TEXT REFERENCES decisions(id),
        replacement_for_item_id TEXT REFERENCES trip_items(id),
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        item_status TEXT NOT NULL CHECK (item_status IN ('confirmed', 'provisional', 'open_decision', 'conflicted', 'cancelled')),
        proposal_status TEXT NOT NULL CHECK (proposal_status IN ('pending', 'confirmed', 'rejected')),
        starts_at TEXT,
        ends_at TEXT,
        timezone TEXT,
        location TEXT,
        notes TEXT,
        deadline_at TEXT,
        source_line INTEGER,
        source_excerpt TEXT,
        created_at TEXT NOT NULL
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
    `);
    const tripItemColumns = this.connection.prepare(`PRAGMA table_info(trip_items)`).all() as Array<{ name: string }>;
    if (!tripItemColumns.some((column) => column.name === "replacement_for_item_id")) {
      this.connection.exec(`ALTER TABLE trip_items ADD COLUMN replacement_for_item_id TEXT REFERENCES trip_items(id)`);
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
  }

  close(): void {
    this.connection.close();
  }
}
