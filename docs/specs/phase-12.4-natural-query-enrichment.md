# Phase 12.4｜Natural Query Enrichment

## Problem Statement

The Phase 12.3 natural-language Router can classify basic date, time-window,
location, route, and status questions, but several useful questions remain
ambiguous or miss existing itinerary data. A user may ask about a place using a
local-language name, ask for a kind such as shopping, ask for recorded notes,
or ask how long an existing route is. These questions must remain read-only and
must not be mistaken for itinerary input.

## Solution

Extend the Natural-language Itinerary Query flow with deterministic location
aliases, constrained alias resolution, Proposal Kind filters, title-aware
matching, and deterministic rendering of existing notes. The feature reads
only existing Trip data. It never invents travel advice, performs external
research, writes a Source, creates a Draft, or changes a Proposal or Trip Item.

## User Stories

1. As a Group Member, I want to ask when I am going to Horseshoe Bend using
   「什麼時候去馬蹄灣」, so that I can find the scheduled time without knowing
   the English canonical name.
2. As a Group Member, I want local-language and English place names to resolve
   to one canonical location, so that one itinerary is not split across names.
3. As a Group Member, I want a place query to match a Proposal or Trip Item's
   title, location, origin, or destination, so that display titles remain useful
   search terms.
4. As a Group Member, I want to ask 「什麼時候會有逛街行程」, so that the
   system finds items whose Proposal Kind is `shopping`.
5. As a Group Member, I want common kind wording such as 逛街、購物、買東西,
   and shopping to resolve to `shopping`, so that I do not need domain enum
   names.
6. As a Group Member, I want confirmed and pending matches to remain visibly
   separated, so that a pending Proposal is not mistaken for an effective fact.
7. As a Group Member, I want to ask 「去羚羊谷有什麼事情需要注意」, so that
   existing itinerary notes for the matching items are shown.
8. As a Group Member, I want notes to be displayed as recorded, so that a
   deterministic query does not silently paraphrase or add advice.
9. As a Group Member, I want the response to say that no notes are recorded
   when matching items have no notes, so that no-notes is distinct from no
   matching itinerary.
10. As a Group Member, I want 「去大峽谷要開多久」 to show a recorded route
    duration when one exists in existing notes, so that the answer remains
    traceable to itinerary evidence.
11. As a Group Member, I want a query with an unknown or low-confidence place
    reference to ask me for the formal place name, so that the system does not
    silently choose the wrong destination.
12. As a Group Member, I want a failed alias lookup to remain a no-write query,
    so that a question never creates an Extraction Draft.
13. As a Group Member, I want the display to use the alias I asked with while
    preserving the canonical itinerary data, so that the answer is natural but
    the evidence remains stable.
14. As a Group Member, I want a query with no matching item to use the existing
    no-data response, so that missing data is not replaced with a recommendation.
15. As a Trip maintainer, I want aliases and kind synonyms to be versioned and
    reviewable, so that search behavior is reproducible.
16. As a Trip maintainer, I want the alias fallback to choose only from a
    bounded candidate list, so that an LLM cannot invent a new location.
17. As a Trip maintainer, I want alias resolution to happen deterministically
    first, so that common names do not incur an unnecessary model request.
18. As a Trip maintainer, I want the constrained LLM fallback to remain within
    the Router's one-call budget, so that LINE reply latency and provider cost
    remain bounded.
19. As a Trip maintainer, I want canonical location names and user aliases to
    be separate fields, so that searching never mutates Sources, Proposals, or
    Trip Items.
20. As an operator, I want alias failures and low-confidence results to be
    observable without storing raw message copies in Router telemetry, so that
    diagnosis remains privacy-conscious.
21. As an operator, I want the existing Trip Access Policy to apply unchanged
    to kind, note, route, pending, and confirmed query results, so that richer
    search does not widen visibility.
22. As an operator, I want query pagination and continuation to preserve the
    normalized Query Filter, so that a later page cannot broaden the search.
23. As a developer, I want the feature to work without Vector DB, so that the
    structured itinerary read model remains the source of truth.

## Implementation Decisions

- Extend the Query Filter vocabulary with `kind`, while retaining date,
  Time Window, location, origin, destination, and visibility status.
- Normalize kind wording through a deterministic synonym table into the existing
  Proposal Kinds vocabulary; do not add a separate `shopping`-like enum value.
- Maintain a versioned global Location Alias registry mapping user-facing names
  to canonical locations. Do not let an LLM or LINE user add aliases.
- Resolve aliases deterministically first. If no deterministic alias matches,
  the Router may choose one canonical location from a bounded candidate list in
  the same model request. The model may not invent a location or modify the
  registry.
- Treat low-confidence or non-unique alias resolution as clarification or a
  request for the formal place name; never guess a destination.
- Match a normalized location against title, location, origin, and destination
  with deterministic case-insensitive substring semantics. Route endpoint
  filters retain their existing independent endpoint behavior.
- Preserve the user's alias for the response label while retaining canonical
  names and original evidence in the underlying records.
- Render existing notes deterministically. If matching items have no notes,
  explicitly state that the itinerary has no recorded notes. Do not generate
  general travel advice.
- Route duration remains note-backed in this phase. A structured duration field,
  estimation, and external research are out of scope.
- Reuse existing Trip Access Policy, status sections, Query Page, and
  continuation semantics.
- Do not add Vector DB. A Natural-language Itinerary Query remains a read-only
  Query Filter operation over structured Trip data.

## Testing Decisions

- Test external behavior at the highest existing seams: `LineSourceWorker` for
  LINE replies and no-write guarantees, and `TravelService.queryTrip` for
  normalized Query Filter matching and visibility policy.
- Add regression coverage for Chinese/English aliases, title/location/endpoint
  matching, `shopping` kind synonyms, notes rendering, no-notes responses,
  route notes duration, low-confidence alias fallback, no-data responses,
  pagination, and Access Policy boundaries.
- Verify that every query path creates no Source, Extraction Draft, Proposal,
  Decision, or Trip Item.
- Verify that aliases and kind synonyms are deterministic and versioned, and
  that constrained LLM fallback cannot produce a value outside the candidate
  registry.
- Follow existing worker/service integration-test style rather than testing
  private helper functions or provider prompt wording directly.

## Out of Scope

- External web search, Research Sources, live travel restrictions, or current
  venue advice.
- Vector DB, embeddings, semantic retrieval, and corpus indexing.
- Automatic creation or editing of Alias registry entries.
- Automatic route duration estimation or geocoding.
- A structured `durationMinutes` schema change.
- Any natural-language write, confirm, reject, delete, or Proposal mutation.

## Further Notes

The feature is an enrichment of Phase 12.3's Router and deterministic itinerary
read path. It should not reopen or broaden the write lifecycle from Phase 11.
