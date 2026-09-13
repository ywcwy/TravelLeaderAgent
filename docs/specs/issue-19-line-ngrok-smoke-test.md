# LINE ngrok staging smoke test specification

## Problem Statement

As the operator of Travel Leader, I need evidence that a dedicated LINE Official
Account can deliver a native group Mention through an HTTPS ngrok endpoint into
the Webhook Runtime, where it becomes one durable Source/Proposal and receives
one acknowledgement. I also need to prove that a redelivered Webhook Event is
idempotent, that health checks expose runtime availability safely, and that the
test can be cleaned up without leaving credentials or production data behind.

## Solution

Provide a repeatable staging smoke-test procedure using an isolated SQLite
database, a dedicated test Official Account and group, and the existing runtime
boundary. The procedure uses `POST /line/webhook` as the canonical public route,
retains `/webhooks/line` as a compatibility alias, creates one Active Trip for
the captured LINE `groupId`, sends a fixed native-Mention Markdown message, and
verifies Inbox, Source, Proposal, Reply, redelivery, health, and cleanup outcomes.

## User Stories

1. As a System Administrator, I want to configure a dedicated test Official Account, so that smoke testing cannot affect production conversations.
2. As a System Administrator, I want to configure a dedicated test group, so that the test Travel Group and Active Trip are isolated.
3. As a System Administrator, I want to store test credentials in a local ignored `.env`, so that secrets are not committed to the repository.
4. As a System Administrator, I want to select a canonical public webhook URL, so that LINE Developers configuration is unambiguous.
5. As a System Administrator, I want to verify `/healthz` before sending messages, so that tunnel and database failures are detected early.
6. As a System Administrator, I want to verify the LINE Developers webhook connection, so that the external provider-to-runtime boundary is known to work.
7. As a System Administrator, I want to inspect an incoming webhook without recording its raw payload, so that I can obtain the group ID while protecting reply tokens and message contents.
8. As a System Administrator, I want to create one Travel Group and one Active Trip from the LINE group ID, so that accepted messages have a valid domain destination.
9. As a Group Member, I want to address the configured Official Account with LINE's native Mention picker, so that the runtime can distinguish an explicit request from ambient group chat.
10. As a Group Member, I want to submit a fixed provisional Markdown candidate, so that the smoke test has deterministic Source and Proposal expectations.
11. As a System Administrator, I want to see exactly one completed Webhook Inbox Event, so that durable ingestion is proven.
12. As a System Administrator, I want to see exactly one `line_text` Source with LINE provenance, so that the provider boundary is proven.
13. As a System Administrator, I want to see exactly one expected Proposal, so that extraction and persistence are proven.
14. As a Group Member, I want to receive one short acknowledgement, so that accepted processing is visible without using a Push message.
15. As a System Administrator, I want to redeliver the same Webhook Event, so that Source Idempotency Key behavior is proven against the same `webhookEventId`.
16. As a System Administrator, I want redelivery to leave Source and Proposal counts unchanged, so that duplicate delivery cannot duplicate itinerary evidence.
17. As a System Administrator, I want redelivery not to send a second acknowledgement, so that a consumed LINE Reply Token is never reused.
18. As a System Administrator, I want the unavailable runtime to fail the health check, so that monitoring can distinguish a healthy database-backed runtime from a stopped service.
19. As a System Administrator, I want to record only redacted IDs, statuses, and counts, so that test evidence contains no raw payload, reply token, or secret.
20. As a System Administrator, I want to stop the runtime and ngrok and clear the provider configuration, so that the temporary public endpoint is not left active.
21. As a System Administrator, I want to revoke or rotate test credentials and remove the isolated database when finished, so that the staging test leaves no reusable secret or personal data.

## Implementation Decisions

- The highest test seam is the complete external path from LINE Webhook delivery through the Webhook Runtime and SQLite persistence to LINE Reply; no parallel test transport is introduced.
- The canonical staging route is `POST /line/webhook`. `POST /webhooks/line` remains a compatibility alias for existing configurations.
- The health route is `GET /healthz` and exposes only safe status fields.
- The test uses a dedicated Official Account and group, never a production account or group.
- Test credentials are supplied through a local ignored `.env`; they are never written to the spec, issue, or test evidence.
- The smoke database is isolated with `TRAVEL_DATABASE_PATH=./data/line-smoke-test.sqlite`. Setup, runtime, and queries must use the same path.
- The `setup:trip` command is the supported test-data seam. It creates or reuses the Travel Group by LINE `groupId` and creates or reuses its single Active Trip.
- The `groupId` is obtained from the local ngrok Inspector. Only the ID is retained; the raw webhook request is not an artifact.
- The test message is a native Mention of the configured Official Account followed by `- [provisional] 住宿 | 2026-10-16 | 台北`.
- Native Mention metadata and LINE User ID are authoritative. The displayed account name and manually typed `@` text are not sufficient evidence of a Mention.
- Expected successful processing is one completed Inbox event, one `line_text` Source, one Proposal inferred as `lodging`, and one short Reply acknowledgement.
- Redelivery means the same Webhook Event with the same `webhookEventId`; manually typing the same text again is a new event and is not a redelivery test.
- The redelivery check records only event ID, HTTP status, duplicate/outcome status, and resulting counts. It does not persist raw payload or Reply Token.
- Reply failure and retry internals remain covered by automated integration tests; the staging smoke test covers the successful provider path and duplicate delivery.
- Cleanup stops the runtime and ngrok, clears the Webhook URL and Use webhook setting, rotates or revokes test credentials, and removes the isolated database if no longer needed.

## Testing Decisions

- Tests assert externally observable outcomes at the runtime boundary: HTTP status, health response, Inbox status/outcome, Source/Proposal counts and provenance, visible acknowledgement count, and unchanged counts after redelivery.
- The operational smoke test uses the existing HTTP server, LINE Webhook ingress, Webhook Inbox, continuous worker, Travel Service, SQLite database, and Reply API client; no implementation-private method is used as the pass criterion.
- Automated prior art covers signature verification, Inbox durability and idempotency, worker retry/lease recovery, Source creation, Reply API failures, and runtime shutdown. The smoke test complements those tests with the real LINE/ngrok provider boundary.
- A successful health check is required before message testing, and stopping the runtime must make the public health check unavailable rather than report a false healthy state.
- The final issue record contains the test date, route, redacted event identifier, status/count results, and cleanup result, but never secrets, raw payloads, Reply Tokens, or production identifiers.

## Out of Scope

- Production Official Accounts, production groups, production databases, or production credentials.
- A management UI or public management API for Travel Groups and Active Trips.
- Direct one-to-one conversation Source ingestion.
- Push messages, scheduled reminders, or message-count optimization.
- Deliberately breaking a real LINE credential or Reply Token to test provider failure; those paths are covered by automated tests.
- Confirming a Proposal into the Effective Itinerary as part of the smoke test.

## Further Notes

- The smoke test is the final Phase 3 operational gate; implementation tickets #16–#18 may be complete while #19 remains open until this procedure has been executed and recorded.
- The domain term `Mention` means a native LINE Mention of the configured Official Account. `@leaderAgent` is a product shorthand, not a required display name.
- If the local `.env`, setup command, runtime, and SQLite query use different database paths, the test evidence is invalid and must be rerun with one shared path.
