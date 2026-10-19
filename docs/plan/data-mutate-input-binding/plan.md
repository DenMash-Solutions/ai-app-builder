# data_mutate Input Item-Reads — Implementation Plan

**Status:** implemented
**Date:** 2026-10-18

## Goal

M2's live MCP verification (T11) exposed a silent data-loss bug: a generated
Checkbox toggle saved the **pre-toggle** value. The model's own spec was
structurally right (`checked: {"$bindItem": "completed"}` + a `data_mutate`
update), but the recipe taught `update`'s `input` shape only as
`{"<field>": <value>}` without saying *which* expression reads an item's
current value. The model used nested `{"$item": "<field>"}`, which
`resolvePropValue` reads from `repeatItem` — a **render-time memoized
snapshot** captured before the interaction's binding write — so the update
wrote back the old value (verified: PATCH body carried `completed: false`).
`{"$bindItem": "<field>"}` reads `stateModel` (the live post-write snapshot)
and yields the new value. This fix teaches the correct expression so toggles
and other read-back mutations persist what the user just chose.

## Scope

### In scope

- `lib/playground/styling-rules.ts` — the `update` clause of the
  `data_mutate` bullet: item-value reads inside `input` must use
  `{"$bindItem": "<field>"}`, with the reason stated (nested `$item` resolves
  from the pre-interaction render snapshot; `$bindItem` reads live state).
- `lib/playground/styling-rules.test.ts` — assertions pinning the new clause.

### Out of scope

- Upstream json-render (`$item` in nested action params resolving from the
  render snapshot instead of live state) — we can't ship a dependency change
  inside this fix; reported as a carried follow-up (2026-10-18).
- Input-validation gating on `press` (`validateForm` before create) —
  separate recipe gap observed during the same T11 run; filed as follow-up
  (2026-10-18).
- `id` params stay `{"$item": "id"}` — top-level `$item` resolves to a path
  string that `query-manager` reads from live state (D2 rev 1.1), so it is
  already correct and must not change.

## Design decisions

1. Teach `$bindItem` inside `input` rather than a negation/toggle helper —
   rejected: adding a `$not`-style directive, because the binding write
   **already is** the toggle; the defect was reading it back with the stale
   expression, and a new directive would still read `repeatItem`.
2. Scope the change to the `update` clause only — rejected: rewriting the
   whole bullet, because `create` (reads `$state`/literals) and `delete`
   (top-level `$item` id) are verified correct and expanding the edit risks
   regressing the M2 recipe assertions.

## Verification

- [ ] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build`
- [ ] Recipe test asserts the `$bindItem` input clause and keeps every prior
      data-source/M2 assertion green
- [ ] Expression semantics proven against `@json-render/core`:
      nested `$item` → stale, nested `$bindItem` → live, top-level `$item` →
      path string (session transcript, `/tmp/hypothesis.ts`)

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-18 | plan drafted (root cause found during M2 T11 live MCP run) |
| 2026-10-18 | approved |
| 2026-10-18 | implemented — format/lint 0/tsc/511 unit tests/build all green; recipe clause + 3 assertions landed |
