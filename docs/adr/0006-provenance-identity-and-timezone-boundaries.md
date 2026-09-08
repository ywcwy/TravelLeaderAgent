# Preserve minimal provenance, stable identity, and explicit timezones

Research Sources retain only retrieval metadata and a concise, actionable summary;
every Source has a provider-specific idempotency key. Membership and owner
authority use stable LINE user IDs rather than display names. Each Trip has an IANA
Trip Timezone for date-only concepts and Quiet Hours, while timed Trip Items retain
their local IANA timezone. This keeps group data traceable across retries, renamed
members, and cross-timezone travel without over-retaining external content.

## Consequences

- The source schema needs provider identity, idempotency key, and research
  provenance fields.
- Group reply renderers must default to non-sensitive itinerary information and
  only reveal a Masked Booking Reference to an explicitly requesting owner.
- Reminder evaluation must select the event timezone for timed events and the Trip
  Timezone for date-only deadlines and Quiet Hours.
