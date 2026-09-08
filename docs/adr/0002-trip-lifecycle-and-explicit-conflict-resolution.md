# Trips have one active lifecycle and conflicts require explicit resolution

A Travel Group has at most one Active Trip; only Decision Owners can create,
activate, archive, or reactivate it. Replacing a confirmed Trip Item uses a
Replacement Proposal, and inconsistent Sources produce a Resolution Proposal
rather than silently selecting a candidate. This preserves history while keeping
the MVA operational with one-owner approval.

## Consequences

- The model needs Travel Group, Trip lifecycle, and proposal-to-item replacement
  relationships that are not present in the initial core schema.
- Archived Trips remain available for audit but cannot receive Sources or send
  Group Reminders.
- The LINE adapter must distinguish native mentions from lower-confidence text
  fallback matching.
