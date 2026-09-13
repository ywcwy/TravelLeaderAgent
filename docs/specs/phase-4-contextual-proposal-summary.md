# Phase 4: contextual Proposal summary

## Problem Statement

When a Group Member sends a structured itinerary candidate to Travel Leader, the
current acknowledgement confirms receipt but does not explain how the candidate
relates to the Trip's known plan. The user cannot tell whether the date and item
kind already have a confirmed Trip Item, whether another Proposal is pending, or
what action a Decision Owner should take next.

The first Phase 4 slice should improve that feedback without pretending that one
candidate is a lasting personal preference and without introducing a model API.

## Solution

After an accepted LINE group message creates a Source and Proposal, the runtime
builds a deterministic contextual summary for the same Active Trip. The Reply
acknowledgement identifies the new Proposal, reports relevant existing Effective
Itinerary and pending Proposal state, and gives a clear next action.

For the initial scenario, when no confirmed item exists for the candidate's date
and kind, the Reply states that the candidate is pending and that a Decision Owner
can confirm it. The system does not confirm the Proposal automatically and does
not infer a durable Travel Preference from a single submission.

## User Stories

1. As a Group Member, I want confirmation that my structured itinerary message was accepted, so that I know it entered the Active Trip.
2. As a Group Member, I want the acknowledgement to identify the new Proposal, so that I can refer to it unambiguously.
3. As a Group Member, I want to know whether the candidate's date and item kind already have a confirmed Trip Item, so that I understand its current itinerary context.
4. As a Group Member, I want to know when no matching confirmed item exists, so that I understand the candidate is new information rather than an already-confirmed fact.
5. As a Group Member, I want the response to distinguish a pending Proposal from the Effective Itinerary, so that provisional evidence is not mistaken for a confirmed plan.
6. As a Decision Owner, I want the response to tell me that I can confirm the Proposal, so that I know the next authorized action.
7. As a Decision Owner, I want to use the Proposal ID in a future confirmation command, so that confirmation targets an explicit candidate rather than ambiguous text.
8. As a Group Member, I want the contextual response to remain visible in the LINE group, so that the shared trip plan is understandable to the group.
9. As a System Administrator, I want the summary to be deterministic, so that the same domain state produces the same response without a model API.
10. As a System Administrator, I want a single Source to remain the evidence for the submitted message, so that contextual feedback does not duplicate itinerary data.
11. As a System Administrator, I want existing confirmed items and pending Proposals to remain unchanged while the summary is generated, so that acknowledgement cannot silently mutate the plan.
12. As a System Administrator, I want a missing or incomplete date/location to remain a Review Issue, so that the summary does not invent itinerary facts.
13. As a System Administrator, I want a retried Webhook Event to produce the same contextual outcome without a second Source or Reply, so that idempotency remains intact.

## Implementation Decisions

- The feature is limited to the first contextual scenario: no matching confirmed Trip Item exists for the candidate's date and inferred kind.
- The highest seam remains the accepted LINE Webhook Event through Inbox, Worker, TravelService, and the Reply API. No separate query transport is introduced.
- Context is read from the same Active Trip that accepted the Source. The summary may inspect the Effective Itinerary and pending Proposals but may not write additional domain state.
- The Reply contains three conceptual parts: accepted candidate and Proposal ID, current matching itinerary context, and the next authorized action.
- If no matching confirmed item exists, the response explicitly says the candidate is pending and recommends Decision Owner confirmation.
- A Proposal remains `provisional`/`pending` until an explicit Decision Owner action exists in a later slice. This feature does not confirm, reject, resolve, or replace anything.
- A matching item is determined from existing domain fields: same Trip, same item kind, and the candidate's date/time overlap according to the Trip timezone rules. Exact conflict semantics are limited to the initial no-match scenario; conflict resolution is out of scope here.
- Existing domain terms remain distinct: Source is raw evidence, Proposal is a candidate, and Effective Itinerary contains only confirmed Trip Items.
- The system does not create a Travel Preference record or infer a preference from one Proposal. Preference modeling is a later domain decision.
- The response is group-visible and must not include Reply Tokens, credentials, raw payloads, or unnecessary sensitive travel data.
- No model API, natural-language command interpretation, Push message, direct conversation ingestion, or notification scheduler is added.
- Relevance is limited to the same date or overlapping time window and the same item kind. The summary does not dump the entire Effective Itinerary.
- When no Active Trip exists, the accepted Source still creates a Proposal; the response says that contextual matching is unavailable until an Active Trip is configured.
- A redelivered event is deduplicated by `event_id`; content similarity alone never suppresses a distinct event.
- The displayed context includes date/time, kind/title, location, status, and Proposal ID only. It excludes raw provider payloads, credentials, Reply Tokens, and unnecessary booking data.
- If a confirmed item exists without a time overlap, the response says that a confirmed item exists but no overlap was found. The system never rejects the new Proposal automatically.
- If Reply delivery fails after persistence, the Inbox event follows the existing retryable failure path; Source and Proposal are not rolled back.

## Testing Decisions

- Tests assert the external Reply content and domain state, not private helper calls or string assembly internals.
- The primary integration test submits one accepted native-Mention group event with a provisional lodging candidate to an Active Trip with no matching confirmed lodging and verifies one Source, one Proposal, unchanged Effective Itinerary, and the contextual acknowledgement.
- A second integration test supplies a matching confirmed item and verifies the feature does not claim the candidate is new; this is a guard for the next conflict slice even if no automatic resolution is implemented.
- Existing worker, Inbox idempotency, Source import, Proposal extraction, and Reply API tests remain the prior art and must continue to pass.
- A retry/redelivery regression verifies that contextual response generation does not duplicate Source, Proposal, or Reply.
- The integration suite covers no Active Trip, multiple pending Proposals for the same date/kind, a confirmed non-overlapping item, and Reply delivery failure after persistence.
- Tests use the existing SQLite integration seam and a fake Reply API transport, as established by the current runtime tests.

## Out of Scope

- Confirming or rejecting a Proposal.
- Creating or resolving a Decision.
- Replacement Proposal confirmation.
- A general itinerary query command.
- Persistent Travel Preference entities or preference inference.
- Model API integration, natural-language understanding, OCR, or external search.
- Direct one-to-one conversations, Push API, reminders, and production deployment.
- Automatically choosing an accommodation, destination, or other itinerary option.
- Content-based duplicate detection across distinct LINE event IDs.

## Further Notes

- The initial reply is a contextual acknowledgement, not a confirmation of travel arrangements.
- A single submission such as `住宿 | 2026-10-16 | 台北` is evidence of a candidate, not proof that the user prefers Taipei.
- Later Phase 4 slices can add explicit Proposal listing/confirmation and conflict handling after this contextual summary is stable.
