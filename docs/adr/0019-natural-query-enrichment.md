---
status: accepted
---

# Enrich natural-language itinerary queries without semantic storage

## Context

Users need to ask about itinerary facts using local place names, itinerary
kinds, recorded notes, and route details. The existing structured Trip read model
already contains the authoritative data, but names and conversational wording do
not always match its canonical fields. Adding Vector DB or external research
would broaden the feature beyond read-only itinerary lookup and make answers
harder to trace.

## Decision

Phase 12.4 uses a deterministic Location Alias registry and deterministic kind
synonyms before querying the structured Trip model. Location matching includes
title, location, origin, and destination. If deterministic alias resolution
cannot identify a place, the existing Router may choose only from a bounded
candidate list in its single request; it cannot invent or persist an alias.
The user's alias is a display label only. Canonical itinerary data and Source
evidence remain unchanged.

Existing notes are rendered verbatim. Missing notes are reported as missing
recorded notes; the system does not produce general travel advice. Route duration
remains note-backed until a separate decision introduces a structured duration
model.

## Consequences

- Common local-language queries remain predictable and testable without Vector DB.
- LLM use is constrained to interpretation and bounded candidate selection.
- Alias registry maintenance is explicit and versioned.
- External knowledge and duration estimation require a later phase.
- Query Filter, Access Policy, pagination, and no-write guarantees remain the
  same domain boundaries.
