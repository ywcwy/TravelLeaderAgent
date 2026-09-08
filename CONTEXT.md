# Travel Leader

The Travel Leader context turns shared travel evidence into a trusted, group-visible
trip plan without treating casual chat as itinerary truth.

## Travel workspace

**Travel Group**:
A LINE group that can host several trips over time. It has at most one Active Trip.
_Avoid_: tenant, chat room

**Trip Timezone**:
The IANA timezone chosen when a Trip is initialized. It governs Quiet Hours and
date-only Trip Items; a timed Trip Item retains its own IANA timezone.
_Avoid_: user timezone, browser timezone

**Trip**:
A bounded, independently managed group journey. Its sources, proposals, effective
itinerary, members, and reminders do not mix with another trip.
_Avoid_: workspace, project

**Active Trip**:
The single Trip in a Travel Group that accepts new evidence and sends reminders.
_Avoid_: current group, live itinerary

**Archived Trip**:
A Trip that no longer accepts Sources or sends reminders, but whose history remains
readable. A Decision Owner may reactivate it for a bounded correction.
_Avoid_: deleted trip, closed group

**Source**:
An immutable piece of explicit itinerary evidence, such as imported Markdown, a
booking record, or a message addressed to `@leaderAgent`.
_Avoid_: chat history, LLM memory

**Source Idempotency Key**:
A provider-specific stable key that permits one Source to be recorded once even if
an event or import is retried. LINE uses the webhook event ID; manual import uses
a content hash and an explicit import batch.
_Avoid_: duplicate check, title match

**Research Source**:
An external-search record containing retrieval time, URL, title, concise summary,
and applicability conditions. It informs a Proposal but is not an itinerary fact.
_Avoid_: confirmed booking, scraped page

**Sensitive Travel Data**:
Credentials or personal data unnecessary for the shared itinerary, including
passport numbers, payment-card data, and unredacted booking documents. It is
rejected before becoming a Source.
_Avoid_: travel evidence, booking detail

**Proposal**:
A candidate itinerary change derived from a Source that has not yet become part of
the effective itinerary.
_Avoid_: draft itinerary, pending trip item

**Decision**:
A named pending choice that groups mutually exclusive Proposals. Confirming one
option resolves the Decision and rejects its other options.
_Avoid_: implicit conflict, title matching

**Proposal ID**:
A stable identifier used for an owner confirmation command. Natural-language
references may find a Proposal but cannot themselves authorize a write.
_Avoid_: free-form confirmation

**Replacement Proposal**:
A Proposal that supersedes a confirmed Trip Item. On confirmation, it makes the
prior item cancelled and preserves their shared decision history.
_Avoid_: in-place edit, overwrite

**Resolution Proposal**:
A Proposal that presents mutually inconsistent Sources as explicit options for a
Decision Owner to resolve.
_Avoid_: conflict dismissal, arbitrary winner

**Effective Itinerary**:
The currently authoritative set of confirmed Trip Items for one Trip.
_Avoid_: chat history, AI memory, current plan

**Trip Item**:
A confirmed itinerary fact such as a flight, lodging, rental car, activity,
transport movement, or meeting point.
_Avoid_: proposal, booking

**Date-only Trip Item**:
A Trip Item known to occur on a calendar date but without a specific time. It may
be part of the Effective Itinerary but cannot trigger a time-specific reminder.
_Avoid_: all-day event, timed item

**Confirmed Deadline**:
A deadline explicitly approved by a Decision Owner. It may produce a Group
Reminder even when the underlying decision remains open.
_Avoid_: suggested deadline, AI deadline

**Review Issue**:
An actionable request for missing or ambiguous information that is attached to a
Source or Proposal. It retains the Source when extraction is incomplete.
_Avoid_: discarded parse, validation error

**Schema-valid Proposal**:
A Proposal whose extracted structure passes application validation. It is still
provisional unless a Decision Owner confirms it; LLM confidence is not authority.
_Avoid_: verified itinerary, AI-confirmed item

## Authority and communication

**Decision Owner**:
A member authorized to confirm a Proposal. Confirmation by any one Decision Owner
makes the resulting Trip Item effective and records that owner as confirmer.
_Avoid_: admin, approver

**System Administrator**:
An operator outside a Travel Group who initializes Trips and changes the Decision
Owner roster. This role is not inferred from LINE membership.
_Avoid_: Decision Owner, group creator

**Group Member**:
A participant who may submit Sources, ask questions, and propose changes, but may
not make a Proposal effective.
_Avoid_: viewer, user

**LINE Identity**:
The stable LINE user ID used for membership and authorization. A display name is a
replaceable presentation snapshot and cannot grant authority.
_Avoid_: display name, LINE handle

**Mention**:
An explicit request addressed to `@leaderAgent`. Native LINE mention metadata is
authoritative; exact-text matching is only a compatibility fallback.
_Avoid_: ordinary group chat, ambient message

**Group Reminder**:
A non-sensitive, action-oriented notice sent to the Travel Group about an Active
Trip.
_Avoid_: personal notification, private reminder

**Quiet Hours**:
The Active Trip's local 22:00–08:00 interval, during which non-urgent Group
Reminders are deferred. A scheduler emits at most three reminders per run.
_Avoid_: notification preference, do-not-disturb setting

**Delivery Attempt**:
A recorded attempt to send a Group Reminder. A reminder becomes sent only after
LINE accepts it; failed attempts retry with a bounded backoff.
_Avoid_: sent reminder, duplicate key

**Search Recommendation**:
An externally researched option presented for discussion. It can become a Source
or Proposal but never books, modifies, or confirms a Trip Item by itself.
_Avoid_: booking action, automatic update

**Masked Booking Reference**:
The last four characters of a booking reference, available only when a Decision
Owner explicitly requests a specific item. Ordinary group replies omit it.
_Avoid_: public confirmation code
