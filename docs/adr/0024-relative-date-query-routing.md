---
status: accepted
---

# Relative-date query routing

Natural-language Itinerary Queries support a bounded set of relative date
phrases: today／tomorrow／day after tomorrow and their approved Chinese
synonyms. The phrase is resolved against the current local date in the Trip
Timezone, not the server timezone or the LINE member's timezone.

Deterministic parsing runs before the LLM router. It supports combinations with
Time Windows, locations, statuses, and Proposal Kinds, and removes the relative
phrase from location text. An explicit date and a relative date in one message
are a conflict; the worker escalates that case to the read-only LLM router for
structured clarification rather than choosing one date.

The LLM router is only used when deterministic parsing cannot safely resolve the
query. Its result remains a validated read-only Query Filter or clarification;
it cannot write itinerary evidence or silently override a deterministic date.

## Considered Options

- **Send every relative-date query to the LLM**: rejected because common relative
  dates are deterministic, cost-sensitive, and easy to regression-test.
- **Treat unresolved relative wording as a location**: rejected because it
  produces misleading empty results, such as searching for a place named
  “明天的行程”.
- **Automatically choose one date on conflict**: rejected because a wrong date
  is worse than a short clarification.
