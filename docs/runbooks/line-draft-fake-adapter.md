# LINE Extraction Draft smoke test (Fake Adapter)

This runbook validates Phase 9.4 locally without a real model provider. Use a
dedicated test group and the isolated database from the existing LINE runbook.

## Start

Set these additional `.env` values:

```env
TRAVEL_DATABASE_PATH=./data/line-draft-smoke.sqlite
TRAVEL_EXTRACTION_ADAPTER=fake
```

Start the runtime and ngrok as usual, then verify `/healthz` and the LINE
Webhook URL. Create or reuse the Active Trip for the test group.

## Draft preview

Use LINE's native mention picker and send a free-form message, for example:

```text
@TravelLeaderAgent 10/1 晚上到 Page，想住 Holiday Inn。
```

Expected reply includes `Extraction Draft X-XXXXXXXX`, extracted item(s),
time flexibility (`flexible`/`estimated`/`required`), missing fields,
assumptions, and `請確認`. At this point the database must contain one Source
and one pending Draft, but zero Proposals:

```sh
sqlite3 ./data/line-draft-smoke.sqlite \
  "select id,type,idempotency_key from sources order by created_at desc limit 5;"
sqlite3 ./data/line-draft-smoke.sqlite \
  "select id,status,revision,source_id,proposal_ids_json from extraction_drafts order by created_at desc limit 5;"
sqlite3 ./data/line-draft-smoke.sqlite \
  "select count(*) as proposals from proposals;"
```

Questions (`?`), itinerary queries (`查詢行程`), and Draft commands must not
create a Source, Draft, or Proposal.

## Edit and confirm

Use the Draft ID from the preview:

```text
@TravelLeaderAgent 修改 X-XXXXXXXX｜10/1 18:00 在 Page 入住 Holiday Inn
```

The reply shows a new revision. Confirm the latest revision as the same
originating user:

```text
@TravelLeaderAgent 確認 X-XXXXXXXX
```

Expected reply contains one or more `P-XXXXXXXX` Proposal IDs. Verify the Draft
is `confirmed`, its `proposal_ids_json` is populated, and the number of
Proposals matches the extracted items:

```sh
sqlite3 ./data/line-draft-smoke.sqlite \
  "select id,status,revision,previous_draft_id,proposal_ids_json from extraction_drafts order by revision desc limit 5;"
sqlite3 ./data/line-draft-smoke.sqlite \
  "select id,title,item_status,proposal_status from proposals order by created_at desc limit 5;"
```

## Permissions and redelivery

Confirming as another group member must return a Decision Owner/originating-user
permission error and create no Proposal. Redelivering the same LINE event must
keep one Source and one Draft (Inbox `duplicate_count` may increase) and must
not create duplicate Proposals.

For a failed Draft, use `重試 Draft X-XXXXXXXX`; it creates a new revision. Use
`取消 Draft X-XXXXXXXX` to cancel without creating Proposals. Stop the runtime
and ngrok after the test; keep the Webhook URL only if it will be reused.
