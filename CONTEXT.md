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

**Timezone Provenance**:
The authority of a timed Proposal or Trip Item's IANA timezone: `explicit` when
the Source supplies it, `inferred` when a supported deterministic location
mapping supplies it, or `fallback` when the Trip Timezone is used because the
item timezone is missing or invalid. Fallback remains queryable but creates a
Review Issue.
_Avoid_: timezone confidence, user timezone

**Trip**:
A bounded, independently managed group journey. Its sources, proposals, effective
itinerary, members, and reminders do not mix with another trip.
_Avoid_: workspace, project

**Active Trip**:
The single Trip in a Travel Group that accepts new evidence and sends reminders.
_Avoid_: current group, live itinerary

**Trip Reset**:
A development operation that archives one explicitly identified Trip and creates
a fresh Active Trip for the same Travel Group. It preserves the archived Trip's
history and never means permanent deletion.
_Avoid_: delete trip, clear itinerary

**Archived Trip**:
A Trip that no longer accepts Sources or sends reminders, but whose history remains
readable. A Decision Owner may reactivate it for a bounded correction.
_Avoid_: deleted trip, closed group

**Source**:
An immutable piece of explicit itinerary evidence, such as imported Markdown, a
booking record, or a message addressed to the configured LINE Official Account.
_Avoid_: chat history, LLM memory

**Source Idempotency Key**:
A provider-specific stable key that permits one Source to be recorded once even if
an event or import is retried. LINE uses the webhook event ID; manual import uses
a content hash and an explicit import batch.
_Avoid_: duplicate check, title match

**Import Batch**:
The explicit identity assigned to one manual itinerary import attempt. Reusing an
Import Batch returns its original Source and Proposal IDs; a changed document must
use a new Import Batch.
_Avoid_: upload session, filename

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

**Proposal Shape**:
The spatial structure of a Proposal. A `point` Proposal describes an activity or
fact at one location; a `route` Proposal describes movement from an origin to a
destination. The Source may provide the shape explicitly, or the deterministic
extractor may infer it from a supported route or point pattern. An uncertain
inference remains a Review Issue rather than becoming an effective fact.
_Avoid_: itinerary status, transport kind

**Proposal Kinds**:
A set of travel categories attached to one Proposal. A Proposal may have more
than one kind, such as `transport`, `lodging`, and `meal` for a sleeper train
with onboard dining. Kinds describe facets of one candidate and do not create
multiple confirmation actions or multiple Trip Items by themselves.
The initial vocabulary is `flight`, `lodging`, `rental_car`, `transport`,
`meal`, `activity`, `shopping`, `meeting`, and `other`. A Proposal has at least
one kind; an uncertain but recognizable item may temporarily use `other` with a
Review Issue requesting clarification.
_Avoid_: multiple proposals, Decision options

**Shape Source**:
The provenance of a Proposal Shape: `explicit` when the Source names the shape
or supplies its structural fields, and `inferred` when a supported deterministic
pattern supplies it. Shape Source does not grant authority; a Proposal still
requires Decision Owner confirmation.
_Avoid_: model confidence, confirmation status

**Supported Itinerary Statement**:
A free-form user statement that matches a deterministic itinerary pattern, such
as movement from one named place to another, staying at a named place, dining at
a named place, or picking up a rental car at a named place. A general question
or recommendation request is not an itinerary statement.
_Avoid_: natural-language command, chat question

**Shape Conflict**:
A Review Issue raised when an explicitly supplied Proposal Shape contradicts the
structure of the Source text, such as declaring a movement statement to be a
`point`. The Source is retained, but no Proposal is created until the conflict
is corrected.
_Avoid_: schedule collision, status conflict

**Incomplete Itinerary Statement**:
A supported itinerary statement that has a missing non-structural fact. A route
without a date may become a Proposal with a Review Issue; a route without an
origin or destination is retained only as a Source and Review Issue.
_Avoid_: invalid Source, discarded message

**Route Segment**:
One movement between exactly one origin and one destination. A multi-leg statement
is represented by multiple Route Proposals that retain the same Source; the
system does not collapse several legs into one ambiguous route.
_Avoid_: multi-stop Proposal, itinerary paragraph

**Point Proposal**:
A Proposal with one primary location and no required origin or destination. A
transport-related event such as rental-car pickup may still be a Point Proposal.
_Avoid_: stationary trip, location-only item

**Route Proposal**:
A Proposal describing movement between an explicit origin and destination. Its
origin and destination are required route facts; a single `location` is not a
substitute for them.
_Avoid_: multi-stop itinerary, transport status

**Contextual Proposal Summary**:
A deterministic, group-visible acknowledgement of a newly accepted Proposal and
its relevant Active Trip context. It reports nearby confirmed and pending items
without confirming, rejecting, or inferring preferences.
_Avoid_: itinerary confirmation, recommendation, AI summary

**Decision**:
A named pending choice that groups mutually exclusive Proposals. Confirming one
option resolves the Decision and rejects its other options. A Decision may need
new options when all current options are rejected, or be explicitly cancelled by
the Decision Owner.
_Avoid_: implicit conflict, title matching

**Trip Access Policy**:
The visibility and interaction rules for one Trip. It determines which
structured itinerary states and Source details a Group Member may read; it does
not replace Decision Owner authority.
_Avoid_: global permissions, chat permissions

**Itinerary Query**:
A read-only request for structured Trip data, such as the Effective Itinerary,
pending Proposals, Decisions, or Review Issues. An Itinerary Query is not a
Source and does not change Trip state.
_Avoid_: itinerary evidence, Proposal

**Decision Needs Options**:
The lifecycle state of a Decision whose current Proposals have all been
rejected, while the underlying decision topic remains open for new options.
_Avoid_: cancelled Decision, resolved Decision

**Proposal ID**:
A stable identifier used for an owner confirmation command. Natural-language
references may find a Proposal but cannot themselves authorize a write.
_Avoid_: free-form confirmation

**Replacement Proposal**:
A Proposal that supersedes a confirmed Trip Item. On confirmation, it makes the
prior item cancelled and preserves their shared decision history.
_Avoid_: in-place edit, overwrite

**Itinerary Evolution**:
The ordered change of a Trip's evidence, Proposals, and confirmed Trip Items over
time. It explains how the current Effective Itinerary emerged without treating
older Sources or confirmed versions as overwritten data.
_Avoid_: edit history, chat history

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

**Trip Review**:
A read-only view of one Trip's Effective Itinerary, pending Proposals, and Review
Issues. It explains what the system currently understands without changing domain
state.
_Avoid_: chat summary, itinerary confirmation

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
An explicit request addressed to the configured LINE Official Account through
LINE's native mention picker. Native mention metadata and the account's LINE User
ID are authoritative; the displayed account name (for example,
`TravelLeaderAgent`) and typed `@` text are presentation only.
_Avoid_: ordinary group chat, ambient message

**LINE Official Account**:
The LINE channel identity through which the Travel Leader receives direct and
group messages. In the current inbound phase, only group conversations can
create Sources; a group conversation requires an explicit native Mention.
Direct-conversation Source ingestion is a future extension with its own Trip
routing rules.
_Avoid_: Decision Owner, Travel Group

**LINE Webhook Event**:
A signed delivery event from the LINE Official Account. Its stable event ID is
the Source Idempotency Key for retry-safe ingestion; the message ID remains
provenance rather than the deduplication key.
_Avoid_: chat message, Source

**Webhook Inbox Event**:
A short-lived, durable record of a LINE Webhook Event before domain processing.
It tracks acknowledgement, processing attempts, rejection or completion, and
may retain the raw payload only during its retention window.
_Avoid_: Source, message queue

**LINE Reply Token**:
A one-time LINE credential that permits a short acknowledgement for one Webhook
Event. It is delivery machinery, not itinerary evidence, and never belongs in a
Source.
_Avoid_: Push token, Source credential

**Webhook Runtime**:
The deployed boundary that receives signed LINE Webhook Events, persists them in
the Webhook Inbox, and runs the worker that turns accepted events into Sources.
_Avoid_: LINE bot logic, chat server

**Processing Lease**:
A bounded claim held by one worker while processing a Webhook Inbox Event. An
expired lease allows another worker to recover the event without creating a
second Source.
_Avoid_: permanent lock, Decision

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
