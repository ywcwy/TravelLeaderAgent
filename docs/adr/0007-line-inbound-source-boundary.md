# LINE inbound events require explicit intent and signed delivery

Phase 2 accepts only signed LINE Webhook Events from a LINE group. Text message
events become Sources only when native Mention metadata addresses
`@leaderAgent`; the group ID maps to its Travel Group and current Active Trip.
`memberLeft` events are accepted only as roster-control events and never create
Sources. Direct conversations with the LINE Official Account do not create
Sources in this phase. Phase 2 sends only a short acknowledgement through the
webhook reply token; it does not send asynchronous Push results. Unknown LINE
identities cannot create Sources unless they are already members of the Active
Trip.

The LINE event ID is the Source Idempotency Key. The LINE message ID and delivery
metadata are retained as provenance. The adapter acknowledges the webhook before
Source extraction so delivery retries do not depend on domain processing time.
The adapter uses the event's one-time reply token for a short acknowledgement;
later asynchronous results require a separate push message.

## Consequences

- Images, files, and other LINE event types are ignored in this increment rather
  than introducing OCR or attachment storage.
- The adapter must verify the LINE signature before acknowledging an event.
- The adapter preserves raw text and provenance; LLM extraction remains outside
  this phase.
- Direct-conversation Source ingestion is deliberately deferred until its Trip
  routing and selection model is designed.
- An unconfigured group or a group without an Active Trip receives a short
  explanatory reply but still gets HTTP 200; no Source is created.
- Non-Markdown text is retained as a Source and surfaced as `source_unparsed`.
- Duplicate events return a short acknowledgement without creating another
  Source. Successful events also return only a short acknowledgement rather
  than a full Review.
- Source creation remains inside the public Travel Service boundary.
- The adapter is exposed as a framework-independent webhook handler; an HTTP
  route only supplies the raw request and returns its response intent.
- Accepted webhook events are written to a durable inbox before the handler
  acknowledges HTTP 200. A worker owns subsequent Source processing.
- The LINE Channel Secret is supplied by deployment configuration, never by
  repository or database state.
- Adapter tests use signed synthetic payloads and assert event routing,
  authorization, idempotency, and provenance without requiring a live LINE
  account.
- Inbox provenance retains event ID, message ID, group ID, LINE user ID,
  received time, and the raw payload while it is retained.
- The inbox tracks `pending`, `processing`, `completed`, and `failed` states,
  including bounded attempts and the last error; exhausted events are
  dead-lettered.
- A temporary inbox write failure returns HTTP 5xx; a valid but policy-rejected
  event is completed as rejected and returns HTTP 200.
- `webhookEventId` is unique in the inbox; duplicates become ignored and never
  create another Source.
- Raw payloads are short-lived diagnostic data. A Source retains only the
  necessary text and provenance after Sensitive Travel Data checks; raw payload
  retention follows an explicit cleanup policy.
- Raw payload retention is seven days, after which only provenance and processing
  results remain.
- Inbox processing retries at most three times before dead-lettering an event.
- Worker claims use a processing lease so an abandoned event can be reclaimed.
- Reply tokens are short-lived Inbox credentials, used once and then removed;
  they never enter Source history.
- Raw payloads stay in controlled Inbox storage and never application logs or
  Source content.
- A sender of a valid, mentioned group message is automatically added as a
  `member` of that Active Trip; Phase 2 does not synchronize every LINE group
  member. Owner authority remains an explicit System Administrator action.
- Member leave events revoke future Source submission while preserving history.
- When a new Active Trip replaces an archived one, old members are not copied;
  a sender is added to the new Trip only after a new valid message.
