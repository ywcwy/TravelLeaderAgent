# LINE LLM provider smoke test

This is the production-like Phase 10.4 check. Use a dedicated LINE Official
Account, test group, isolated SQLite file, and a short-lived API key. Never
record the API key, raw webhook body, reply token, or full travel source in the
test result.

## Configure and start

Add the existing LINE variables plus these local `.env` values:

```env
# Choose one provider:
TRAVEL_EXTRACTION_ADAPTER=openai
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4o-mini
OPENAI_TIMEOUT_MS=20000
# Or use Grok:
# TRAVEL_EXTRACTION_ADAPTER=grok
# XAI_API_KEY=...
# XAI_MODEL=grok-4.6
# XAI_TIMEOUT_MS=20000
TRAVEL_DATABASE_PATH=./data/line-llm-smoke.sqlite
```

Start the service and tunnel, set LINE's Webhook URL to
`https://<ngrok-host>/line/webhook`, and verify `GET /healthz` returns the
healthy response. Confirm the service is using the same SQLite path for setup,
runtime, and checks.

## Draft → confirm

Use LINE's native mention picker and send a free-form message:

```text
@TravelLeaderAgent 10/1 晚上到 Page，想住 Holiday Inn。
```

The reply must contain an `Extraction Draft X-XXXXXXXX` preview and must not
contain a Proposal ID yet. Check that the Inbox event is completed and that
there is exactly one Source, one Draft, and zero Proposals:

```sh
sqlite3 ./data/line-llm-smoke.sqlite \
  "select event_id,status,outcome,attempts from webhook_inbox_events order by created_at desc limit 5;"
sqlite3 ./data/line-llm-smoke.sqlite \
  "select count(*) from sources; select count(*) from extraction_drafts; select count(*) from proposals;"
```

Use the Draft ID from the reply:

```text
@TravelLeaderAgent 修改 X-XXXXXXXX｜10/1 18:00 在 Page 入住 Holiday Inn
```

Then confirm as the same originating user:

```text
@TravelLeaderAgent 確認 X-XXXXXXXX
```

The confirmation reply contains the resulting `P-XXXXXXXX` ID(s). Verify the
Draft is `confirmed`, the Proposal is `pending`, and no Trip Item was created:

```sh
sqlite3 ./data/line-llm-smoke.sqlite \
  "select id,status,revision,provider,model,prompt_version,proposal_ids_json from extraction_drafts order by updated_at desc limit 5;"
sqlite3 ./data/line-llm-smoke.sqlite \
  "select id,proposal_status,item_status from proposals order by created_at desc limit 5;"
sqlite3 ./data/line-llm-smoke.sqlite \
  "select count(*) from trip_items;"
```

## Failure and redelivery checks

Temporarily use an invalid/expired key or a very short timeout in a disposable
test environment. The provider failure must produce a `failed` Draft while
retaining its Source; the LINE reply must not expose provider details or the
API key. `重試 Draft X-XXXXXXXX` creates a new revision.

Redeliver the same webhook event and verify the event becomes a duplicate while
Source, Draft, and Proposal counts remain unchanged. A non-originating member
cannot confirm the Draft. Stop ngrok and the service after the test; rotate or
revoke the temporary API key when finished.

## Phase 10 regression checklist

The automated suite covers the provider boundary and Fake Adapter equivalents
for: lodging context versus a separate Arrival, multiple independent items,
vague Time Windows, required times, missing facts, low-information candidates,
duplicates, contradictions, valid empty extraction, provider failures, Draft
revision, confirmation blocking, and idempotent redelivery. The real smoke
run only proves the external OpenAI → LINE path; it does not require storing
the provider response body.

For a successful run, record only the Draft/Proposal IDs, statuses, revision,
provider/model/prompt version, and aggregate SQLite counts. Do not record API
keys, raw webhook payloads, Reply Tokens, or the full travel source.
