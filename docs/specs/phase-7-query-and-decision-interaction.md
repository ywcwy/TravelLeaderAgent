# Phase 7: Query and Decision Interaction

## Problem Statement

Phase 6 can ingest and review structured itinerary evidence, but a Group Member
cannot yet ask the system what it currently knows. Decision Owners also need an
explicit, idempotent LINE interaction for resolving Proposals without allowing
ordinary chat to mutate the Trip.

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
