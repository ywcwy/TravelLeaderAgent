# Travel Leader Agent

The first vertical slice implements the trustworthy trip core: immutable sources,
candidate proposals, confirmed trip items, and a review that separates them.

## Run

```sh
npm test
npm run demo
```

The implementation uses Node.js' built-in `node:sqlite` module. Node 22.5 or newer
is required.

## Current Markdown contract

Each candidate line is explicit and remains a proposal until a decision owner
confirms it:

```md
- [provisional] 10/16 住宿：Carmel | 2026-10-16T15:00:00-07:00 | Carmel | 可取消 | timezone=America/Los_Angeles | deadline=2026-10-01T17:00:00-07:00
```

The fields are `status | title | startsAt | location | notes`, followed by optional
`timezone=` and `deadline=` metadata. Supported statuses are `confirmed`,
`provisional`, `open_decision`, and `conflicted`. The original line and its line
number are stored with every proposal as evidence.

Every import also supplies a provider-specific Source Idempotency Key. Repeating
an import with the same key returns the original Source and Proposal IDs; a new key
creates a separate Source even when the Markdown is identical.
