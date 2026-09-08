# Model mutually exclusive options as Decisions and confirm by ID

Mutually exclusive Proposals belong to an explicit Decision, whose confirmation
accepts one option and rejects the rest. An owner writes only through a stable
Proposal ID; natural language may be used to discover candidates but cannot itself
confirm one. This avoids brittle inference from titles or dates and makes the
confirmation target auditable.

## Consequences

- The schema needs Decision and Decision-option relationships before interactive
  confirmation is implemented.
- Review replies present confirmed facts separately from unresolved options and
  Review Issues.
- Reminder delivery is rate-limited and respects Quiet Hours.
