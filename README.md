# Travel Leader Agent

The first vertical slice implements the trustworthy trip core: immutable sources,
candidate proposals, confirmed trip items, and a review that separates them.

## Run

```sh
npm test
npm run demo
```

The deployable webhook runtime starts with:

```sh
npm run start
```

It requires `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`,
`LINE_OFFICIAL_ACCOUNT_USER_ID`, and `TRAVEL_SYSTEM_ADMINISTRATOR_ID`. Optional
settings include `TRAVEL_DATABASE_PATH` (default `./data/travel.sqlite`),
`PORT` (default `3000`), `WEBHOOK_BODY_LIMIT_BYTES` (default `262144`),
`WEBHOOK_REQUEST_TIMEOUT_MS` (default `10000`), and `TRAVEL_WORKER_POLL_MS`
(default `1000`). The runtime exposes `POST /webhooks/line` and `GET /healthz`.

The implementation uses Node.js' built-in `node:sqlite` module. Node 22.5 or newer
is required.

## Current Markdown contract

Each candidate line is explicit and remains a proposal until a decision owner
confirms it:

```md
- [provisional] 10/16 住宿：Carmel | 2026-10-16T15:00:00-07:00 | Carmel | 可取消 | timezone=America/Los_Angeles | deadline=2026-10-01T17:00:00-07:00
```

The fields are `status | title | startsAt | location | notes`, followed by optional
`timezone=` and `deadline=` metadata. Supported statuses are `confirmed`,
`provisional`, `open_decision`, and `conflicted`. The original line and its line
number are stored with every proposal as evidence.

Every import also supplies a provider-specific Source Idempotency Key. Repeating
an import with the same key returns the original Source and Proposal IDs; a new key
creates a separate Source even when the Markdown is identical.
