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
(default `1000`). `TRAVEL_EXTRACTION_ADAPTER` selects the extraction seam and
currently defaults to `fake` for local Draft testing. Set it to `openai` with
`OPENAI_API_KEY` (and optionally `OPENAI_MODEL` and `OPENAI_TIMEOUT_MS`) for the
real provider. The runtime exposes `POST /line/webhook` (with
`/webhooks/line` retained as a compatibility alias) and `GET /healthz`.

For local development, put these variables in a root `.env` file. `npm run start`
loads it automatically; never commit that file because it contains credentials.

To create the first Active Trip for a LINE group, copy its `groupId` from the
ngrok request inspector at `http://127.0.0.1:4040`, then run:

```sh
npm run setup:trip -- Cxxxxxxxxxxxxxxxx "測試旅程" Asia/Taipei
```

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

## LINE Extraction Draft flow

With the default Fake Adapter, a free-form mentioned message is persisted as one
Source and one `pending_confirmation` Extraction Draft. Structured Markdown
candidate messages continue to use the deterministic importer. The Draft reply
is a concise preview; no Proposal is created until the originating user confirms it:

```text
確認 X-XXXXXXXX
修改 X-XXXXXXXX｜補充日期、地點或其他內容
取消 Draft X-XXXXXXXX
重試 Draft X-XXXXXXXX
```

Confirmation creates pending Proposals and returns their IDs. See
`docs/runbooks/line-draft-fake-adapter.md` for the manual smoke test and SQLite
checks.
