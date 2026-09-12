# Provider-neutral LINE Webhook Runtime

Phase 3 uses a provider-neutral Node runtime: a thin HTTP endpoint receives the
signed LINE webhook and hands accepted events to the durable Inbox, while a
single-process polling worker creates Sources and sends one-time reply
acknowledgements. Credentials remain environment configuration, SQLite requires
persistent storage, and TLS is terminated by ngrok or the deployment proxy so
the application can stay portable across hosting providers.

## Consequences

- The smoke-test public route is `POST /line/webhook`; the original
  `POST /webhooks/line` remains as a compatibility alias. `GET /healthz` exposes
  only safe runtime and database health.
- Missing credentials or failed migrations prevent startup rather than allowing
  a partially configured bot to accept traffic.
- Reply API failures do not roll back an already-created Source and never reuse
  a consumed LINE Reply Token.
- A dedicated test Official Account and group are required for the ngrok smoke
  test; production groups are not used for validation.
