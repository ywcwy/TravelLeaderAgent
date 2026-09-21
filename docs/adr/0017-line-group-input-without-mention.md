---
status: accepted
---

# Accept signed LINE group text without an Official Account mention

LINE group text sent to a configured Travel Group with an Active Trip is accepted without native Mention metadata. This temporarily supersedes ADR-0007's explicit-mention requirement so group conversation can create Sources, Draft commands, and itinerary queries directly; signed delivery, Active Trip routing, membership revocation, Source idempotency, sensitive-data checks, and Decision Owner authority remain required safeguards.

## Consequences

- Casual group text can now become a Source and require review, so users should use a query form for read-only questions.
- `officialAccountUserId` remains deployment configuration to support a future mention-required policy, but it does not gate inbound text in this policy.
