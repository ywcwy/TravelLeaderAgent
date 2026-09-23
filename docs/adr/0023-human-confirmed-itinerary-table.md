---
status: accepted
---

# Human-confirmed itinerary table import

The next itinerary import format is a versioned Markdown Human-confirmed Table:
one row per Table Item, fixed machine-readable headers, explicit point／route
fields, and a document-level confirmation status. The importer validates the
table deterministically before writing domain records; it does not require an
LLM for core parsing or field validation.

When a confirmed document is submitted by an authorized Trip owner or Decision
Owner, rows marked `confirmed` become confirmed Trip Items directly. Rows marked
`provisional` or `open_decision` remain Proposal workflows, and a single table
may contain all three row statuses. Invalid rows remain reviewable while valid
rows may proceed according to their own status.

The table records human-facing facts only: date, times, timezone, status, kind,
shape, location or route endpoints, optional point address, geographic fields, and notes. Canonical IDs,
macro-region, provenance, resolver revision, Proposal IDs, and Trip Item IDs are
system-owned. Point and route rows have separate required-field rules; route
endpoints carry independent timezones. Registry mismatches are validation errors,
not automatic corrections. Notes outside the formal `Itinerary Table` section do
not create itinerary items.

The legacy compact Markdown format remains supported by its existing parser, but
the table parser is a separate versioned contract. Re-submitting the same table
is idempotent by document checksum; a changed table creates a new revision rather
than overwriting historical evidence.

## Considered Options

- **Let the LLM interpret arbitrary Markdown tables**: rejected because core
  field validation and confirmation authority must be deterministic.
- **Require every row to be confirmed**: rejected because one table may safely
  carry provisional and open-decision alternatives.
- **Use one opaque location column**: rejected because people must be able to
  verify point locations and route endpoints separately.

The optional `address` column follows `location`. It preserves a human-provided
point address as-is; it is not required, parsed, geocoded, or populated by the
Location Registry. Route endpoint addresses are outside this table contract.
