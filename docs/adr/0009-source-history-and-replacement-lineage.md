# Use Source as immutable evidence and Proposal replacement as change lineage

Status: accepted

`Source` records the original user input and remains immutable. The current effective itinerary is represented by SQL `Proposal` and `Trip Item` records; a change to a confirmed item is represented by a `Replacement Proposal` rather than an in-place edit. We will not add a separate Source-to-Source lineage relationship for now, because it would duplicate the existing Proposal-to-Trip Item replacement relationship without improving the current product behavior.

## Considered Options

- Keep only the latest structured itinerary and use Sources as the entire history. This is simpler, but it cannot reliably reconstruct past parsed or confirmed states.
- Add both Source lineage and Proposal replacement lineage. This provides more audit detail, but duplicates relationships and creates another consistency obligation.
- Keep immutable Sources plus structured Proposal/Trip Item replacement history. This preserves the original evidence and the effective itinerary history while keeping one canonical change relationship.

## Consequences

- A new external user input creates a new Source; internal status changes do not.
- A Replacement Proposal contains a complete new snapshot, including unchanged fields, and points to the confirmed Trip Item it supersedes.
- `Effective Itinerary` shows only the currently confirmed Trip Items; cancelled predecessors remain readable as history.
- If future requirements need to relate unparseable or pre-Proposal edits, Source lineage can be added deliberately rather than inferred from text.
