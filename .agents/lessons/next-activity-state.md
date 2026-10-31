# Next 16 `<Activity>` Keeps Hidden Route Copies Alive — Seeds, Bridges, and E2E Assertions Must Assume It

> **Lesson source**: plan 061-4 (2026-10-30) — the shared `/session` e2e failed
> three times with a stale value after a rapid bump→back navigation, and probes
> found 3 canvases / duplicate elements that looked like a state leak and a
> double render. Plan 059 T1 had already met the *selector* half of this; 061-4
> hit the *state* half. Root-caused with a labeled instance trace.

## Problem Description

- **Routes are hidden, not unmounted** — with `cacheComponents`, Next 16 wraps
  route changes in React's `<Activity>`: the previous route (and possibly a
  *prerendered twin of the destination*) stays in the DOM with
  `display:none` (`node_modules/next/dist/docs/01-app/02-guides/preserving-ui-state.md`)
- **Effect lifecycle differs from unmount**: cleanups run when the route is
  hidden, effects re-run when it is shown again, and React state is *preserved*
  across the round trip — so "navigation remounts the page" (plan 022 decision 3)
  is **void**, and components with timers/writes keep living while hidden
- **Render-time snapshots apply late**: a seed computed during render can be
  applied in an effect *after* a concurrent write already landed → the "stale
  re-add" (a value the store had already moved past came back into state)
- **Content equality has no recency**: a write-through compared only by value
  is last-writer-wins across every live copy — a stale hidden instance's flush
  clobbers the freshest write regardless of who is "current"
- **E2E sees the hidden copies**: `getByText`/raw `querySelector`/counts match
  `display:none` content, so a hidden twin reads as a leak, a duplicate, or a
  second `.session-token`; interleaved logs from N instances with no IDs are
  *undecidable* (the "which twin did what" story I told was disproven by the
  labeled trace)

## Solution Steps

1. **Scope every DOM assertion to what a user can see** — `.filter({ visible:
   true })` (710 existing usages = house style) or `getByRole` (the a11y tree
   excludes hidden content, so it is Activity-proof by construction). For
   headings use role + `exact: true` — the prompt input/mirror embeds the same
   copy and collides with `getByText` in strict mode
2. **Never put volatile bridged state in a render-time seed** — make the seed
   *omit* the key (the provider's `initialState` diff then deletes it) and let
   a dedicated bridge component own the value: a **layout-effect** pull
   (pre-paint: mount, screen change, Activity re-show) + a store subscription
   for writes landing elsewhere
3. **Order the bridge's own effects deliberately**: the write-back debounce is
   *declared first* so a genuine local change is pending before the pull could
   mistake it for stale state; an "expected value" guard stops store-originated
   values from arming write-backs (echoes)
4. **Give writes recency, not just equality** — a realm-monotonic value stamp;
   the store accepts only stamps *strictly newer* than its last accepted write
   (order-independent: an equality/base-rev check fails when the stale write
   arrives first)
5. **Tag before you design** — when a trace interleaves multiple instances,
   re-run it with `seq@route`-style tags (a ref-held instance id + the URL at
   event time). Only then reason about the fix; label which facts are observed
   and which are inferred

## Verification

- Targeted e2e (the failing race) green twice — store samples showed the fresh
  value at every poll — then **full suite 128 passed / exit 0**
- MCP spot-check: write-through → project-namespaced record → navigate →
  sibling reads both → rapid bump→back leaves restored screen *and* store on
  the fresh value; console 0 errors / 0 warnings
- Unit: `stale stamps are rejected — only strictly newer writes land`

## Prevention Strategies

- Concluding "leak / duplicate / double render" from an e2e count or raw query
  → first ask whether a hidden Activity copy is matching
- About to assume a route change gives you a clean remount (fresh state, dead
  timers, unmounted writes) → read `preserving-ui-state.md`; write cleanup and
  reconciliation for hide/show instead
- About to trust `evaluate_script` ran → `format: "script"` only *parses* a
  `() => …` (never calls it; returns `undefined`, zero side effects) —
  `format: "function"` calls it; assert the returned value is what you expect
- A fix argument that depends on ordering you have not observed → instrument the
  order first (tagged), then decide

## Memory Triggers

- e2e finds a leak/duplicate/stray node after navigation → hidden Activity copy?
  Visibility-scope first
- "Navigation remounts the playground/page" in an old plan or comment → Next 16
  may keep it alive; re-verify before relying on unmount semantics
- Stale value reappears after you synced it → did a render-time snapshot apply
  late? Seeds must not carry it
- Writes racing "for no reason" → content equality cannot order them; stamps can
- Interleaved log, multiple instances, no IDs → inference only; tag and re-run
- Probe returned `undefined` from a body that returns a string → wrong `format`
