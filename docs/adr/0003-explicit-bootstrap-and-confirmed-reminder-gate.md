# Bootstrap outside LINE and gate reminders on confirmation

The System Administrator initializes a Travel Group, Trip, and initial Decision
Owner outside LINE; owner roster changes are also administrator actions. A Group
Reminder may be scheduled only from a confirmed Trip Item or a Confirmed Deadline,
while search results and AI-suggested deadlines remain review-only until owner
approval. This trades conversational convenience for a clear authorization and
notification safety boundary.

## Consequences

- The MVA needs an operator-facing bootstrap path before the LINE adapter.
- Date-only Trip Items remain valid but cannot create precise timed reminders.
- External research is advisory only and does not add booking credentials or
  autonomous booking workflows.
