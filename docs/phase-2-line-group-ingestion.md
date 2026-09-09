# Phase 2: LINE group Source ingestion

## Outcome

Receive explicitly addressed text messages from a LINE group and turn them into
immutable Sources for that group's current Active Trip, without bypassing the
Travel Service authorization and provenance rules from Phase 1.

Direct conversations with the LINE Official Account are intentionally deferred;
they require a separate Trip-routing and selection model.

## Event boundary

Accepted Source event:

1. The webhook signature is valid.
2. The event is a text message from a LINE group.
3. The group ID is mapped to a Travel Group with an Active Trip.
4. Native mention metadata addresses `@leaderAgent`.
5. The sender is added as a `member` of that Active Trip if not already present.
6. The event ID is used as the Source Idempotency Key.

`memberLeft` is accepted as a roster-control event: it revokes future Source
submission for that LINE Identity while retaining history. Images, files,
stickers, ordinary unmentioned chat, unconfigured groups, and groups without an
Active Trip do not create Sources.

## Processing model

The framework-independent `LineWebhookHandler` validates the raw request and
produces a normalized event intent. The Inbox integration writes that intent as
a durable Webhook Inbox Event before acknowledging HTTP 200. A worker claims
pending events with a processing lease.
Events move through `pending`, `processing`, `completed`, and `failed`; failed
events retry at most three times before dead-lettering. A temporary Inbox write
failure returns HTTP 5xx so LINE may redeliver the event.

The Channel Secret comes from deployment configuration. Reply tokens remain in
the short-lived Inbox record, are used once for a short acknowledgement, and are
then removed. Phase 2 does not send asynchronous Push results.

## Data and privacy

The Inbox retains event ID, message ID, group ID, LINE user ID, received time,
raw payload, and processing outcome. Raw payloads are retained for seven days,
never written to application logs, and then removed. A Source retains only the
necessary text and provenance after Sensitive Travel Data checks. Non-Markdown
text remains visible as a Source with a `source_unparsed` Review Issue.

## Verification

Tests use signed synthetic webhook payloads and an in-memory or file-backed
SQLite database. They cover signature rejection, group routing, native mention
handling, automatic sender membership, `memberLeft`, unknown groups, missing
Active Trips, duplicate event IDs, retry and lease recovery, provenance, and
end-to-end Source creation through the public Travel Service.

## Tickets

Because GitHub Pull Requests already occupy issue numbers 6 and 7, GitHub will
assign the next available issue numbers when these tickets are created:

1. Webhook verification and group routing
2. Durable Webhook Inbox and retry worker
3. End-to-end LINE group Source ingestion
