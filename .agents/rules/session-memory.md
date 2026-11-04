# Session Memory Updates Are MANDATORY (`.agents/memory/active-work.md`)

> User instruction, 2026-11-04: "Enforce the memory update every time I ask
> you for status. Also, you must update it after a finding or completing
> anything."

## When to update

Update `.agents/memory/active-work.md` **in the same turn**, before replying:

1. **Every status request** ("status?", "where are we?", "what's next?") —
   refresh the file FIRST, then answer from it.
2. **After every finding** — a bug caught, a gotcha discovered, a decision
   answered, a migration applied, a stale assumption corrected.
3. **After every completion** — a task/checkbox done, a gate run, a commit
   made, a plan status changed.

## How to update

- Touch **only** `.agents/memory/active-work.md` (gitignored — never stage
  it). The plan file (`docs/plan/…`) stays the long-form design source.
- Keep the **`Last updated:`** header honest (date + one-line state), the
  **`Where we are`** block current, and add/extend the plan's own section
  with what shipped, what was found, and what is next.
- Self-contained: the next agent must be able to continue from this file
  without re-doing research. Keep it under ~200 lines of *new* content —
  trim a stale shipped-section when its plan is long closed.
- Never let a finding live only in chat: a finding that is not in this file
  (or the plan) did not happen.

## Anti-patterns

- Replying to "status?" from conversation memory while the file still says
  the previous plan.
- Deferring the update to "later in the session" — sessions end without
  warning.
- Recording a finding only in the commit message or a plan checkbox note
  without mirroring it here.
