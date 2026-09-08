# Reject sensitive travel data and acknowledge reminder delivery

The MVA rejects Sensitive Travel Data before it becomes a Source; shared itinerary
facts are the only booking-derived data it retains. LLM output may create only a
Schema-valid Proposal, never a confirmed fact. Group Reminder delivery is recorded
as a Delivery Attempt and marked sent only after LINE accepts the message, with
bounded retry on failure.

## Consequences

- The LINE adapter needs sensitive-data detection and a user-facing redaction
  response before persistence.
- The reminder store needs attempt count, failure metadata, and next-attempt time,
  rather than a single boolean.
- Quiet Hours have no automatic emergency exception in the MVA.
