---
status: accepted
---

# Curated Location Registry governance

The MVP treats the Location Registry as the manually reviewed, versioned
authority for every concrete, queryable place. A place may be imported before it
is registered; until then, the Proposal or Trip Item remains usable but carries
an `unresolved_location` issue. LLM extraction may surface Registry Candidates,
but it must not create canonical places or aliases automatically.

Matching is deterministic. Exact matches use approved aliases, coarse matches
may resolve only to an explicitly named city, and ambiguous matches remain
unresolved rather than guessing. A compound place may fall back to a uniquely
identified city only when that city is explicit in the source text, preserving
the original place as evidence. Route origins and destinations are normalized
independently.

Registry gaps are handled in two stages: a read-only Location Inventory reports
unresolved values, typed Proposal or Trip Item references, and their occurrences, then an explicit
`normalize:locations --context` maintenance run applies newly approved entries
to existing Proposals and Trip Items. This avoids re-importing Sources and
spending LLM tokens merely because the registry grew.

Canonical names and aliases are never silently merged across potentially
different places. Conflicting aliases require city or region disambiguation;
inactive entries are retained for historical traceability but are excluded from
new matches. Normalized fields supplement rather than replace the original
location text and Source evidence, and each normalized record records the
Registry revision that authorized the match.

## Considered Options

- **Automatic LLM-created Registry entries**: rejected because an extraction
  error would become a durable global fact.
- **Require Registry completion before import**: rejected because it blocks
  importing otherwise useful itinerary data and makes Registry maintenance
  unnecessarily token-intensive.
- **Delete retired places**: rejected because existing itinerary evidence must
  remain interpretable.
