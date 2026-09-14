# Phase 5: Trip reset, itinerary import, and review

## Problem Statement

During development, the same LINE group and local database accumulate test
Sources, pending Proposals, and confirmed Trip Items. The current Active Trip
setup is intentionally idempotent, so it reuses the existing Trip instead of
letting the developer start a clean iteration. The system can parse individual
candidate messages, but there is not yet a clear workflow for importing a
complete itinerary and showing what the system currently understands.

The developer needs a repeatable, safe way to reset one Trip, import a complete
itinerary, and inspect the resulting domain state before building later
confirmation and recommendation behavior.

## Solution

Add a development-oriented Trip lifecycle and review workflow:

1. A scoped reset operation archives the current Active Trip for one Travel
   Group and creates a fresh Active Trip, preserving the archived history.
2. A bulk itinerary import accepts a complete Markdown itinerary and records it
   as one immutable Source with idempotent extraction into Proposals.
3. A Trip Review operation presents the Effective Itinerary, pending Proposals,
   and actionable Review Issues so the developer can verify the system's
   understanding.

Imported status markers remain evidence from the submitted Source. They do not
silently make a Proposal effective; only an authorized Decision Owner action can
create or change an Effective Itinerary item.

## User Stories

1. As a developer, I want to reset one Travel Group's Active Trip, so that I can
   start a clean development iteration without touching another group's data.
2. As a developer, I want reset to require an explicit confirmation flag, so
   that an accidental command cannot archive a Trip.
3. As a developer, I want the previous Trip archived rather than erased, so
   that test history and provenance remain inspectable.
4. As a developer, I want reset to create a new Active Trip with a chosen title
   and Trip Timezone, so that the next test starts with known settings.
5. As a developer, I want reset to work when a group has no Active Trip, so
   that setup is still one predictable workflow.
6. As a developer, I want to import a complete itinerary in one operation, so
   that I do not have to send every item as a separate LINE message.
7. As a developer, I want the import to preserve the original Markdown Source,
   so that every extracted candidate remains traceable to submitted evidence.
8. As a developer, I want each parseable itinerary line to become an explicit
   Proposal, so that the system's interpretation is inspectable item by item.
9. As a developer, I want confirmed, provisional, open-decision, and conflicted
   markers to remain distinguishable, so that uncertainty is not hidden.
10. As a developer, I want incomplete lines to remain attached to a Review
    Issue, so that missing data is visible instead of invented.
11. As a developer, I want the import to be idempotent, so that rerunning the
    same file with the same import identity does not duplicate Sources or
    Proposals.
12. As a developer, I want a changed import identity to create a separately
    traceable Source, so that a revised itinerary is not silently substituted.
13. As a developer, I want Trip Review to show the current Effective Itinerary,
    so that I know which facts are actually authoritative.
14. As a developer, I want Trip Review to show pending Proposals separately,
    so that candidates are not mistaken for confirmed plans.
15. As a developer, I want Trip Review to show Review Issues with affected
    Proposal IDs, so that I know what needs correction.
16. As a developer, I want Trip Review to identify schedule collisions, so that
    conflicting candidates can be resolved deliberately.
17. As a Decision Owner, I want an imported candidate to remain non-effective
    until I explicitly confirm it, so that importing text cannot change the
    shared itinerary without authorization.
18. As a System Administrator, I want reset and import operations to use the
    existing Travel Service authorization and Trip boundaries, so that lifecycle
    changes cannot cross Travel Groups.
19. As a developer, I want the workflow to work without a model API, so that
    parsing and review remain deterministic while the domain is still being
    validated.
20. As a maintainer, I want the workflow to be verifiable through one public
    CLI-to-SQLite seam, so that tests reflect the behavior I will actually use.

## Implementation Decisions

- Add explicit development commands for scoped Trip reset, bulk itinerary
  import, and Trip Review. They reuse TravelService rather than adding a new
  HTTP transport.
- Reset accepts a Travel Group identity, optional new Trip title/timezone, and
  an explicit confirmation flag. It archives the current Active Trip and then
  creates exactly one fresh Active Trip. It never deletes archived data.
- Reset is scoped to one Travel Group and uses the existing System Administrator
  authorization. A missing group or invalid timezone is a clear failure.
- Bulk import targets one Active Trip, accepts a Markdown document and an
  explicit provider-specific import identity, and reuses the existing
  Source/Proposal extraction contract.
- The original document is one immutable Source. Parseable lines produce
  Proposals that retain source line and excerpt provenance.
- A status marker in imported Markdown describes the candidate's evidence; it is
  not authority to create an Effective Itinerary Trip Item. Confirmation remains
  an explicit Decision Owner operation.
- Importing the same identity returns the original Source and Proposal IDs.
  Importing the same content with a new identity creates a new Source by design.
- Trip Review reads, but does not mutate, domain state. It presents confirmed
  Trip Items, pending Proposals, and Review Issues using existing domain terms.
- Existing Trip Timezone rules govern date-only interpretation and deterministic
  schedule collision reporting.
- No model API, external search, LINE Push API, or automatic Proposal
  confirmation is introduced by this phase.
- A disposable local database may be recreated by the developer outside the
  domain workflow, but the reset command itself must remain scoped and
  recoverable through archived Trip history.

## Testing Decisions

- Tests observe public command results and persisted domain state through the
  CLI → TravelService → SQLite seam. They do not test private helpers or SQL
  string assembly.
- Reset tests verify explicit confirmation, authorization, archive preservation,
  new Active Trip creation, and isolation from another Travel Group.
- Import tests verify one Source, multiple Proposals, source line provenance,
  status preservation, missing-field Review Issues, and idempotent reruns.
- Review tests verify the separation of Effective Itinerary, pending Proposals,
  and Review Issues, including deterministic schedule collisions.
- A cross-operation test resets a Trip, imports a complete itinerary, and reads
  the review to verify the end-to-end development workflow.
- Existing TravelService, SQLite migration, Proposal extraction, and LINE worker
  tests remain regression coverage. A later LINE integration ticket may expose
  the same bulk import flow through a group message, but it is not required for
  this first development workflow.

## Out of Scope

- Confirming, rejecting, or resolving imported Proposals automatically.
- A natural-language itinerary parser, OCR, model API, or external search.
- Deleting archived Trips or deleting another Travel Group's data.
- Direct one-to-one ingestion, LINE Push messages, reminders, or production
  deployment changes.
- A general-purpose web UI for editing the itinerary.
- Preference inference from the imported itinerary.

## Further Notes

This phase is intentionally a trustworthy write-and-inspect loop. It lets the
developer establish what the system knows before deciding which confirmation,
conflict-resolution, and recommendation behaviors deserve the next phase.
