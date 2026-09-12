# LINE ngrok staging smoke test

This runbook validates the complete Phase 3 path with a dedicated test LINE
Official Account and test group. Never use a production account, group, raw
webhook payload, reply token, or secret in the test record.

## 1. Prepare an isolated test environment

Use a dedicated LINE Official Account and group containing the account and one
test user. In the project root, create a local `.env` (it is git-ignored):

```env
LINE_CHANNEL_SECRET=...
LINE_CHANNEL_ACCESS_TOKEN=...
LINE_OFFICIAL_ACCOUNT_USER_ID=U...
TRAVEL_SYSTEM_ADMINISTRATOR_ID=system-admin
TRAVEL_DATABASE_PATH=./data/line-smoke-test.sqlite
PORT=3000
```

In LINE Developers, enable **Use webhook** and **Allow bot to join group chats**.
In LINE Official Account Manager, disable greeting and auto-response messages so
the application owns acknowledgements.

## 2. Start and verify the runtime

Start the runtime and tunnel in separate terminals:

```sh
npm run start
ngrok http 3000
```

Set the LINE webhook URL to the canonical smoke-test route:

```text
https://<ngrok-host>/line/webhook
```

`/webhooks/line` remains a compatibility alias. Before sending a message,
verify both the public health endpoint and the LINE Developers **Verify** action:

```sh
curl https://<ngrok-host>/healthz
```

Expected health response is `{"status":"ok","database":"ok"}`. The ngrok
Inspector at `http://127.0.0.1:4040` must show a `POST /line/webhook` with HTTP
200 after LINE sends a test event.

## 3. Create the Active Trip

Send one harmless group message, then copy only `source.groupId` from the ngrok
Inspector request. Do not copy the full payload. Create the Travel Group and its
single Active Trip:

```sh
npm run setup:trip -- <groupId> "LINE smoke test" Asia/Taipei
```

The command is idempotent for an existing Travel Group and reuses its Active
Trip. The group must have at most one Active Trip.

## 4. Verify ingestion and acknowledgement

Use LINE's native mention picker to select the Official Account, then send the
fixed test message:

```text
@TravelLeaderAgent - [provisional] 住宿 | 2026-10-16 | 台北
```

The displayed name can differ; native mention metadata is authoritative. Record
only the event ID, HTTP status, and database counts. Expected result:

- one Inbox event with `status=completed` and `outcome=processed`;
- one `line_text` Source for the test group;
- one expected Proposal;
- one short acknowledgement in the group: `已收到，等待 Decision Owner 確認。`.

For a local SQLite check:

```sh
sqlite3 ./data/line-smoke-test.sqlite \
  "select event_id,status,outcome,attempts from webhook_inbox_events order by created_at desc limit 5;"
sqlite3 ./data/line-smoke-test.sqlite \
  "select id,provider,provider_group_id from sources order by created_at desc limit 5;"
```

Trigger one LINE webhook redelivery of the same event and verify that the
`webhookEventId` is unchanged, the Inbox records a duplicate, Source/Proposal
counts remain unchanged, and no second acknowledgement appears. Do not save the
raw request or reply token as evidence.

## 5. Verify unavailable health and clean up

With the runtime stopped, `/healthz` must no longer return the healthy response.
After the run, stop the runtime and ngrok, clear the Webhook URL and **Use
webhook** setting in LINE Developers, and revoke or rotate the test Access Token
and Channel Secret. Remove the local smoke-test SQLite file if it is no longer
needed.

Record the test date, account/group description, route, health result, event ID
hash or redacted ID, counts, and cleanup result in the GitHub issue. Never record
secrets, raw payloads, reply tokens, or production identifiers.
