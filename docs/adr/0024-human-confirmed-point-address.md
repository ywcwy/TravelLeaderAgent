---
status: accepted
---

# Preserve optional human-confirmed point addresses

Human-confirmed itinerary tables may include an optional `address` column for
point items. The value is source evidence supplied by a person and is preserved
as entered, without translation, parsing, geocoding, or LLM enrichment. It
supplements the existing `location` field, which remains the primary display and
query location.

Existing proposals and Trip Items receive a nullable `address` field through a
backward-compatible migration. Existing records remain `NULL`; a later table
revision may provide an address. A confirmed row retains the same address on the
confirmed Trip Item and any related Proposal, but a missing address never creates
a Review Issue by itself.

The MVP displays an address only when it is non-empty. It does not use address as
a natural-language query filter. Route endpoint addresses, address parsing,
fuzzy address matching, and automatic geocoding are deferred.

## Considered Options

- **Require addresses on every point**: rejected because many valid itinerary
  facts identify only a venue or city.
- **Have the Registry or LLM fill addresses**: rejected because the MVP needs a
  trustworthy, human-verifiable source and must avoid invented or stale street
  details.
- **Replace location with address**: rejected because users query by landmarks,
  cities, and regions more often than by street text.
