# Phase 7: Query and Decision Interaction

## Problem Statement

Phase 6 can ingest and review structured itinerary evidence, but a Group Member
cannot yet ask the system what it currently knows. Decision Owners also need an
explicit, idempotent LINE interaction for resolving Proposals without allowing
ordinary chat to mutate the Trip.

## Solution

Add a deterministic query and command boundary to the existing LINE Webhook →
Inbox → Worker → TravelService → SQLite → Reply seam. Group Members can read
policy-permitted structured Trip data, while Decision Owners can perform
explicit ID-based commands. Trip-scoped Access Policy controls visibility,
queries remain read-only, and the existing Source/Proposal/Trip Item model stays
the canonical domain model.

## User Stories

1. As a Group Member, I want to query the Active Trip, so that I can see what the system currently knows.
2. As a Group Member, I want to see confirmed Trip Items, so that I can understand the Effective Itinerary.
3. As a Group Member, I want to see pending Proposals, so that I know which itinerary facts still need confirmation.
4. As a Group Member, I want to see open Decisions, so that I know which mutually exclusive choices need resolution.
5. As a Group Member, I want to see Review Issues, so that I can help correct incomplete or ambiguous itinerary evidence.
6. As a Group Member, I want structured results without raw Source text by default, so that casual conversation and unnecessary details are not exposed.
7. As a Group Member, I want to query by date, location, kind, or Proposal ID, so that I can find relevant itinerary facts quickly.
8. As a Group Member, I want an empty query to be reported clearly, so that no-result is not confused with a system failure.
9. As a Group Member, I want ambiguous queries to offer clarification choices, so that the system does not silently guess my intent.
10. As a Group Member, I want query messages to remain read-only, so that asking a question never creates a Source or Proposal.
11. As a Group Member, I want to submit itinerary evidence separately from queries, so that the system can distinguish facts from questions.
12. As a Decision Owner, I want to confirm a standalone Proposal by ID, so that an explicit decision makes it effective.
13. As a Decision Owner, I want repeated confirmation commands to be idempotent, so that retries never create duplicate Trip Items.
14. As a Decision Owner, I want to reject an individual Proposal, so that unsuitable options can be removed while a Decision remains open.
15. As a Decision Owner, I want to select an option through its Decision, so that alternative options are rejected consistently.
16. As a Decision Owner, I want to cancel an entire Decision explicitly, so that a decision topic can be closed without pretending an option was selected.
17. As a Decision Owner, I want a Decision with all options rejected to become `needs_options`, so that the topic can receive new options later.
18. As a Decision Owner, I want new options to reopen the same `needs_options` Decision, so that one decision topic retains its history.
19. As a Decision Owner, I want rejected Proposals to remain immutable, so that later reconsideration creates a new Proposal rather than rewriting history.
20. As a non-owner Group Member, I want a clear authorization response when I attempt a write command, so that read access is not confused with decision authority.
21. As a System Administrator, I want each Trip to have its own Access Policy, so that different trips can use different visibility rules.
22. As a System Administrator, I want to change a Trip Access Policy through an administrative seam, so that policy changes are not hidden in chat parsing.
23. As a System Administrator, I want policy changes attributed to an administrator and time, so that visibility changes are accountable.
24. As a Group Member, I want Active Trip queries to exclude Archived Trips by default, so that old and current journeys do not mix.
25. As a Group Member, I want to request an Archived Trip explicitly, so that historical travel plans remain discoverable without polluting current results.
26. As a Group Member, I want long results to be paginated, so that LINE messages remain readable and within provider limits.
27. As a Group Member, I want continuation tokens bound to my Trip and identity, so that pagination cannot leak or mix another user's results.
28. As a maintainer, I want Markdown and LINE queries to use the same TravelService read model, so that channels cannot drift in their interpretation.
29. As a maintainer, I want existing Inbox idempotency and LINE identity rules preserved, so that retries and authorization remain trustworthy.

## Scope

Phase 7 adds a deterministic read and command boundary for the Active Trip:

- Group Members can query confirmed Trip Items, pending Proposals, open
  Decisions, and Review Issues according to the Trip Access Policy.
- Decision Owners can confirm or reject Proposals and cancel Decisions through
  explicit ID-based commands.
- A Decision can enter `needs_options` when all current options are rejected and
  can reopen when new options are added to the same decision topic.
- Queries are read-only and do not create Sources or Proposals.
- Existing LINE native Mention, LINE identity, Inbox idempotency, and Trip
  timezone rules remain authoritative.

## Default Access Policy

Each Trip has its own policy. The default is:

- Group Members may read confirmed, pending, open Decision, and Review Issue
  data.
- Group Members may submit Sources but may not confirm, reject, or cancel.
- Decision Owners may confirm, reject, or cancel.
- System Administrators may change the Trip Access Policy.
- Raw Source content is hidden from Group Members by default.
- Archived Trips are not included in default queries.

Policy changes apply to future queries and are attributable to an administrator;
already sent LINE messages are not retroactively changed.

## Query Boundary

The first interface supports explicit commands and a small deterministic set of
natural forms:

```text
查詢行程
查詢 2026-10-01
查詢 Page
查詢待確認
查詢 Review Issue
查詢 Proposal P-12345678
```

Ambiguous queries receive clarification choices. A query with no matches is a
successful empty result, not a new Source. Query results use the Trip timezone,
stable date/title ordering, Proposal IDs for pending items, and bounded pages
with a short-lived continuation token bound to the Trip and LINE user.

## Decision Commands

```text
確認 P-12345678
拒絕 P-12345678｜原因
選擇 D-12345678 P-12345678
取消 Decision D-12345678
```

- A Proposal already assigned to a Decision must be selected through that
  Decision, not directly confirmed.
- An individual option may be rejected while its Decision remains open.
- When all options are rejected, the Decision becomes `needs_options`.
- New options reopen the same Decision; a new Decision is only for a different
  topic.
- Explicit cancellation changes the Decision to `cancelled`.
- Repeated owner commands are idempotent and never create duplicate Trip Items.
- Rejected Proposals are not restored; a later viable option is a new Proposal.

## Out of Scope

- Model APIs, external search, recommendations, or free-form AI answers.
- Natural-language Replacement Proposal creation.
- Direct Source editing or Source-to-Source lineage.
- Automatic confirmation or conflict resolution.

## Acceptance Criteria

1. A mentioned Group Member can query the Active Trip and see the policy-
   permitted structured records without seeing raw Source content by default.
2. A non-owner cannot confirm, reject, or cancel through LINE commands.
3. A Decision Owner can confirm a standalone Proposal idempotently.
4. A Decision Owner selects a Proposal through its Decision and the other
   options are rejected consistently.
5. Individual rejection, `needs_options`, reopening with new options, and
   explicit Decision cancellation are distinguishable in Trip Review.
6. Queries, clarification responses, and empty results do not create Sources,
   Proposals, or Trip Items.
7. Archived Trip data is excluded unless explicitly requested.
8. Automated tests cover policy visibility, identity authorization, query
   ordering/pagination, Decision lifecycle, and duplicate command delivery.
