# Phase 6: Structured Proposal Shapes and Kinds

## Problem Statement

The current importer treats every itinerary candidate as a mostly flat record.
That works for a fixed-location item such as a hotel, but it loses the structure
of movement such as `Las Vegas → St. George`. It also models an item with several
travel facets, such as a sleeper train with transport, lodging, and meal service,
as if it could have only one kind. Free-form LINE messages need to produce the
same trustworthy domain representation as Markdown imports without turning
ordinary questions into itinerary facts.

## Solution

Give every Proposal a spatial `shape`: `point` or `route`. A Point Proposal has
one location; a Route Proposal has an origin and destination. Give every Proposal
a non-empty set of `kinds`, allowing one candidate to have several travel facets.
Use deterministic extraction for explicit metadata, legacy structured lines, and
supported free-form itinerary statements. Preserve the original Source and
surface a Review Issue whenever required structure is missing, ambiguous, or
contradictory. Make Markdown and LINE ingestion use the same Proposal validation,
storage, review, and confirmation behavior.

## User Stories

1. As a traveler, I want a fixed-location itinerary item to be represented as a Point Proposal, so that its location is queryable.
2. As a traveler, I want a movement itinerary item to be represented as a Route Proposal, so that its origin and destination are queryable.
3. As a traveler, I want route segments to preserve their origin and destination, so that the system does not hide movement inside free-form text.
4. As a traveler, I want a transport event at one place, such as rental-car pickup, to remain a valid Point Proposal.
5. As a traveler, I want a multi-leg route statement to be split into Route Proposals, so that each leg can be reviewed independently.
6. As a traveler, I want one Proposal to have multiple travel kinds, so that a sleeper train can be transport, lodging, and meal without creating three confirmations.
7. As a traveler, I want multiple kinds to remain one Proposal and one eventual Trip Item, so that classification does not duplicate my itinerary.
8. As a traveler, I want the system to recognize legacy location-based Markdown as an inferred Point Proposal, so that existing imports remain useful.
9. As a traveler, I want to write supported itinerary statements naturally in LINE, so that I do not need to learn metadata syntax.
10. As a traveler, I want Markdown and LINE to produce the same Proposal structure, so that the source channel does not change domain behavior.
11. As a traveler, I want an incomplete route to remain traceable as Source evidence, so that missing origin or destination is not invented.
12. As a traveler, I want a route without a date to remain a visible candidate with a Review Issue, so that useful route information is not discarded.
13. As a traveler, I want contradictory explicit shape metadata and text to be flagged, so that the system does not silently choose the wrong interpretation.
14. As a traveler, I want ordinary questions and recommendation requests not to become Proposals, so that chat is not mistaken for itinerary truth.
15. As a Decision Owner, I want Point and Route Proposals to use the same confirmation flow, so that authority does not depend on shape.
16. As a Decision Owner, I want a confirmed Route to retain its route structure in the Effective Itinerary, so that confirmed facts remain useful for planning.
17. As a developer, I want unknown kinds to become actionable Review Issues, so that new categories are not silently dropped.
18. As a developer, I want Trip Review to show shape, route endpoints, and all kinds, so that I can inspect what the system understands.
19. As a developer, I want the migration to preserve existing Sources, Proposals, and Trip Items, so that adding structure is recoverable.
20. As a maintainer, I want one deterministic validation contract shared by CLI and LINE seams, so that tests prevent channel-specific drift.

## Implementation Decisions

- Add Proposal Shape values `point` and `route`.
- A Point Proposal requires `location`; it does not require `origin` or `destination`.
- A Route Proposal requires `origin` and `destination`; `location` is optional and cannot substitute for either endpoint.
- Add a non-empty Proposal Kinds collection. Initial canonical values are `flight`, `lodging`, `rental_car`, `transport`, `meal`, `activity`, `shopping`, `meeting`, and `other`.
- Multiple kinds are facets of one Proposal. They do not create multiple Decision actions or Trip Items.
- Preserve `shape`, `origin`, `destination`, and all kinds when a Proposal becomes a confirmed Trip Item.
- Store kinds in a normalized association so queries can find all Proposals or Trip Items with a given kind.
- Preserve shape provenance as `explicit` or `inferred`; provenance is not authority and does not bypass Decision Owner confirmation.
- Support explicit Markdown metadata for shape, route endpoints, and comma-separated kinds while keeping existing pipe-delimited fields.
- Support deterministic free-form patterns such as movement from A to B, staying at X, dining at X, and rental-car pickup at X. Do not add a model API or external search in this phase.
- Infer `point` for legacy structured lines that have one clear location and no route structure. Infer `route` only when a supported route pattern supplies both endpoints.
- Split a multi-leg route statement into Route Proposals that share the same Source. Do not introduce `multi_stop` in this phase.
- If a route lacks an origin or destination, retain the Source and create a Review Issue without creating an incomplete Proposal.
- If a supported itinerary statement lacks a date, create the Proposal and a Review Issue for the missing date.
- If explicit metadata conflicts with the text structure, retain the Source and create a `shape_conflict` Review Issue without creating a Proposal.
- If no kind can be inferred for an otherwise recognizable item, use `other` and create a Review Issue requesting clarification.
- Unknown kind values create an `unknown_kind` Review Issue and are not silently discarded.
- General questions and recommendation requests are not itinerary statements and do not create Proposals.
- Add nullable shape and route fields through a recoverable migration. Existing single-kind records are migrated to one-element kinds collections; existing Sources and domain history remain readable.
- Keep Decision grouping out of this spec. Existing `decisionId` relationships remain compatible for a later Decision grouping ticket.
- Use one validation contract from Markdown import and LINE ingestion through Trip Review and confirmation.

## Testing Decisions

- Tests observe public command results, TravelService behavior, persisted SQLite state, and LINE runtime behavior; they do not test private parser helpers or SQL assembly.
- Extend the existing CLI-to-TravelService-to-SQLite tests with Point and Route imports, explicit and inferred shape provenance, multi-kind persistence, legacy migration, missing fields, unknown kinds, and shape conflicts.
- Extend the existing LINE Webhook-to-Inbox-to-Worker-to-SQLite tests with supported free-form point and route statements, multi-kind inference, ordinary-question rejection, and deterministic acknowledgement text.
- Verify that a Route Proposal confirms to one Trip Item retaining endpoints and kinds.
- Verify that a Point transport event is accepted and does not require route endpoints.
- Verify that a multi-leg statement creates separate Route Proposals sharing one Source.
- Verify that incomplete route structure creates only Source plus Review Issue, while a date-less but structurally complete route creates a Proposal plus Review Issue.
- Verify that Markdown and LINE produce equivalent domain records for equivalent statements.
- Verify that Trip Review displays shape, endpoints, kinds, pending Proposals, Effective Itinerary, and Review Issues.
- Preserve regression coverage for existing Phase 1–5 import, review, reset, webhook idempotency, and confirmation behavior.

## Out of Scope

- Automatic Decision grouping for mutually exclusive options such as breakfast choices.
- `multi_stop`, area, virtual, or other additional shapes.
- Model APIs, external search, recommendations, booking, or automatic confirmation.
- Treating natural-language questions as itinerary updates.
- Splitting one multi-kind Proposal into multiple Trip Items.
- Preference inference from ratings or narrative notes.

## Further Notes

The shape and kinds model is intentionally small. `shape` answers where the
Proposal exists spatially; `kinds` answer which travel facets it has. A Proposal
may therefore be a route with transport, lodging, and meal kinds without
confusing classification with authority or confirmation.
