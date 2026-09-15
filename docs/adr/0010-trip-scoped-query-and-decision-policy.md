# Use Trip-scoped read policy and explicit Decision lifecycle commands

Status: accepted

Phase 7 will expose read-only Itinerary Queries to Group Members while keeping Proposal confirmation, rejection, and Decision cancellation under Decision Owner authority. Visibility is configured per Trip through a Trip Access Policy, and query commands are distinct from itinerary evidence so that asking a question never creates a Source or Proposal.

## Decisions

- The default policy lets Group Members read confirmed items, pending Proposals, open Decisions, and Review Issues, but not raw Source content.
- Source content is restricted to Decision Owners and System Administrators unless a Trip policy explicitly allows it.
- Queries target the Active Trip by default; Archived Trips require an explicit identifier or history query.
- A Proposal in a Decision cannot be directly confirmed; the owner selects it through the Decision so the other options are rejected atomically.
- A Decision Owner may reject an individual option while leaving the Decision open. If all options are rejected, the Decision becomes `needs_options`; adding new options reopens that same Decision. Only an explicit cancellation changes it to `cancelled`.
- Rejected Proposals are immutable history. If the same idea becomes viable again, it is represented by a new Proposal.

## Consequences

Trip access can vary without changing the domain model, but every query must resolve the policy before returning data. The first query interface remains deterministic and does not require a model API. Query pagination and idempotent owner commands are part of the interaction boundary, while natural-language recommendations and automatic edits remain out of scope.
