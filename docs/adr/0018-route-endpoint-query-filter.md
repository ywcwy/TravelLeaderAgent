---
status: accepted
---

# Match Route queries by both endpoints

A Query Filter may include an `origin`, a `destination`, or both for a Route query. When both are present, a result must match both existing Route endpoints rather than treating the complete route phrase as one location; the filter remains read-only and does not infer or alter itinerary facts.

## Consequences

- Natural wording such as 「從 Tusayan 到 Los Angeles 的行程」 can select the intended Route without including another route from Tusayan.
- Point items cannot satisfy an endpoint condition.
