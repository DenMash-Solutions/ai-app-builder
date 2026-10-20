# Form Validation Gating — Implementation Plan

**Status:** implemented
**Date:** 2026-10-18

## Goal

Generated forms must not persist invalid input. Today a `required` check on an
Input only paints a local message after a blur, while the submit Button's
`data_mutate` press runs unconditionally — proven live on entry
`9186a96f-4240-4e68-85f4-b5d9b8bdf5c1`: pressing **Add Task** with an untouched
empty input created 3 junk rows (`201` each) with no message shown. This
feature teaches (and verifies) the gating pattern: the submit button is
disabled until `validateForm` reports the form valid, so an empty submission
is physically impossible.

## Scope

### In scope

- `lib/playground/styling-rules.ts`: one bullet teaching the gating pattern —
  the Input carries a top-level `watch` on its `$bindState` path →
  `validateForm` (every keystroke write re-validates into
  `/formValidation = {valid, errors}`, and the post-submit `setState` clear
  trips the same watcher so the button re-locks automatically), submit Button
  `"disabled": {"$cond": {"$state": "/formValidation/valid"}, "$then": false, "$else": true}`,
  press sequence unchanged (`[data_mutate, setState clear]` — no extra tail
  action to forget).
- `styling-rules.test.ts` assertions for the new bullet.
- E2e (`e2e/data-sources.spec.ts`): empty Add Task is disabled → type →
  enabled → press creates → input clears → disabled again.
- MCP spot-check on the todo entry via a **non-technical** steer prompt
  (check the compiled recipe in `.next` or restart the dev server first —
  HMR-staleness lesson from 2026-10-18).

### Out of scope

- Conditional action execution (`when`/guard on actions) — not expressible in
  json-render today; node_modules patches don't persist (descoped 2026-10-18).
- App-side guard inside the `data_mutate` handler — the handler can't know
  which fields are required or which form a mutation belongs to; heuristics
  would block unrelated writes (descoped 2026-10-18).
- Seeding `/formValidation` in spec state — the `$cond` `$else` branch covers
  undefined state, so no seed is needed (descoped 2026-10-18).
- Rendering field errors from state in the Input override — the local message
  works once validation runs; the untouched-field case is covered by the
  disabled button instead (descoped 2026-10-18, revisit if messages vanish
  after re-renders in practice).

## Design decisions

1. **Spec-level gating via `watch`-driven `validateForm` + `$cond` disabled
   binding** — the Input carries a top-level
   `watch: {"<its $bindState path>": {"action": "validateForm"}}`, so every
   keystroke write re-validates into `/formValidation`, and the post-submit
   `setState` clear trips the same watcher → the button re-locks with no
   extra press action. Watchers never fire on initial render, so
   `/formValidation` starts undefined → `$else` → disabled at first paint.
   Verified in the installed package: the prompt's "STATE WATCHERS" section
   documents `watch` (core prompt assembly, rendered because the schema
   carries built-in actions), the renderer executes watch bindings through
   `execute` (reference-compared, initial render skipped, `await`ed), and
   `validateSpec` knows the field (`watch_in_props` error + auto-fix).
   Official skill doc `validation.md` sanctions the guard: *"…does not
   automatically gate on validation. Guard submission with a `$cond` … on the
   button."* Button's `disabled` is declared upstream
   (`z.boolean().nullable()`, spread into our catalog). Rejected:
   **`on.change` + press-tail variant** — two adherence asks instead of one;
   forgetting the tail re-opens an empty-create window after submit, and
   forgetting `on.change` leaves `/formValidation` undefined → a permanently
   dead button; the watch variant keeps the press sequence exactly as models
   already generate it. Rejected: upstream conditional actions (not ours to
   change), app-side handler guard (no form semantics at the handler).
2. **Post-submit revalidation** — press sequence is
   `[data_mutate, setState clear, validateForm]`. Rejected: `validateForm`
   first as a pre-gate — actions run sequentially but never skip later ones,
   so a pre-check cannot block the mutation; only the disabled button gates.
3. **Disabled-before-first-interaction** via `$cond` `$else` (undefined →
   disabled). Rejected: seeding state — extra recipe surface for the same
   result.

## Verification

- [ ] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build`
- [ ] New styling-rules unit assertions
- [ ] E2e: validation-gated add flow (enabled/disabled transitions)
- [ ] MCP (chrome-devtools): plain-language steer on the todo entry →
      empty press blocked, typed press creates, input clears, button re-locks
- [ ] DB check: no new empty rows after the empty-press attempt

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-18 | plan drafted |
| 2026-10-18 | approved (watch-based design after json-render skill audit) |
| 2026-10-19 | implemented — gate green (lint/tsc/518 tests/build); e2e journey "the add button gates on validation" passes; MCP live steer (rev 5) proved disabled→type→enable→submit→auto re-lock with inline message and exactly one create per click |
