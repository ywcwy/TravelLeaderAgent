---
status: accepted
---

# Curated Location Registry governance

The Location Registry remains a manually reviewed, versioned authority. LLM
extraction may surface Registry Candidates, but it must not create canonical
places or aliases automatically. Matching is deterministic: formatting
normalization and approved aliases are allowed, while ambiguous aliases remain
unresolved. A compound place may fall back to a uniquely identified city only
when that city is explicit in the source text, preserving the original place as
evidence. Route origins and destinations are normalized independently.

Registry gaps are handled in two stages: a read-only Location Inventory reports
unresolved values, typed Proposal or Trip Item references, and their occurrences, then an explicit
`normalize:locations --context` maintenance run applies newly approved entries
to existing Proposals and Trip Items. This avoids re-importing Sources and
spending LLM tokens merely because the registry grew.
