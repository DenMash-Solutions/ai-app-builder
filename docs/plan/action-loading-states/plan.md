# Action Loading States — Implementation Plan

**Status:** implemented
**Date:** 2026-10-18

## Goal

Actions that hit storage must show a busy state. Today a `data_mutate` write
gives no feedback: buttons stay clickable (double-press creates duplicate
rows — two rapid empty presses produced two `201`s during repro) and specs
have no state to branch a spinner/"Saving…" on. This feature enforces loading
states app-side (Buttons auto-disable while any action is in flight, using
upstream's `loadingActions`) and exposes a manager-owned `pending` flag in the
query mirror so generated specs can render their own busy UI.

## Scope

### In scope

- `ButtonImpl` (`lib/playground/overrides.tsx`): `disabled || actionsInFlight`
  from `useActions().loadingActions` (verified: the set holds the action name
  for the whole handler await — adapter write + refresh), plus a spinning
  icon in place of `leadingIcon` while busy (`aria-busy`).
- `QueryMirror` gains `pending: boolean` (`lib/data-sources/types.ts`):
  included in every manager mirror write (`writeMirror` replaces the whole
  node, so the flag must be manager-owned); `QueryLoader`'s `data_mutate`
  handler sets it true before the adapter op and false after refresh
  (`finally`), covering all queries bound to the resource.
- `lib/playground/styling-rules.ts`: bullet teaching the pending branch
  (`{"$state": "/queries/<name>/pending", "eq": true}` → spinner/"Saving…"
  element) and noting buttons auto-disable during writes.
- `styling-rules.test.ts` assertion for the bullet.
- `docs/data-sources.md`: mirror shape appendix updated (`pending`).
- Tests: unit (mirror includes `pending`, loader lifecycle true→false incl.
  failure path, Button disables while an action is in flight), e2e (delayed
  mutation → button disabled/spinner → re-enabled on completion).

### Out of scope

- Checkbox/switch auto-disable — upstream shadcn components (not ours);
  LWW makes a double-toggle idempotent; overriding every control inflates the
  surface (descoped 2026-10-18 — revisit on request).
- Per-trigger-button scoping of the disable — `loadingActions` is keyed by
  action name; the public `on("press")` handle exposes only
  `bound: boolean` (whether any action is bound), not which action names,
  so an element can't tell "my own write finished" (descoped 2026-10-18).

## Design decisions

1. **Auto-disable reads upstream `loadingActions`** (ActionProvider state,
   exposed via `useActions()`; verified to hold the action name across the
   full handler await). `ComponentContext.loading` was rejected — the skill
   registry docs define it as the *renderer's* (streaming) state, not
   action-in-flight. Rejected: mirror-flag-only — recipes can
   forget it and the ask is to *enforce*; rejected: state-store flag as the
   only mechanism — no app-side guarantee.
2. **`pending` lives in the manager-owned mirror** — `writeMirror` replaces
   `/queries/<name>` wholesale, so a handler-written sibling key would be
   clobbered on the next read. Rejected: a separate `/mutations` path — two
   sources of truth for one concept.
3. **Disable scope = any action in flight** (`loadingActions.size > 0`) —
   sync actions (setState/validateForm) add+remove inside one batch so there
   is no flicker, and auth actions get busy states for free. (Scope question
   to user: vs `data_mutate` only.)
4. **Spinner swaps `leadingIcon`** while busy; plain-label buttons get the
   disabled styling (shadcn `disabled:` variants already exist).

## Verification

- [ ] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build`
- [ ] New unit tests (mirror/loader/Button) + styling-rules assertion
- [ ] E2e delayed-mutation busy-state journey
- [ ] MCP spot-check on the todo entry: Add Task disables + spins during a
      live supabase write, re-enables after
- [ ] `docs/data-sources.md` appendix matches the shipped mirror shape

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-18 | plan drafted |
| 2026-10-18 | approved (Q1: any action in flight; Q2: checkbox deferred) |
| 2026-10-19 | implemented — gate green; unit tests cover pending stamping during refresh, resource scoping and detach release; e2e busy journey (supabase delay) proves disabled+aria-busy+spinner+"Saving…" → settled; MCP live: recipe steering produced the pending indicator + buttons auto-disable, checkbox single-fire PATCH intact |
