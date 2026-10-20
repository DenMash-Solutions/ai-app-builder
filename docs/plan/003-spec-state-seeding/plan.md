# Spec State Seeding — Implementation Plan

**Status:** implemented
**Date:** 2026-10-05

## Goal

Generated specs that carry a `state` block (repeated content via `repeat`, `$state` bindings, `visible` gates, `openPath` dialogs, `$template` interpolation) render **empty or wrong** because the app never seeds `spec.state` into json-render's `StateProvider` — `page.tsx` hardcoded `initialState={{}}`. The gallery experiment surfaced it: a correct model output (`Grid` + `repeat` over 6 Unsplash items + lightbox actions) rendered a header and a zero-child grid with no console errors. This fix wires `displayedSpec.state` into the state store so state-dependent specs work end to end.

## Scope

### In scope

- `app/[locale]/page.tsx` — move the provider stack (`StateProvider`/`VisibilityProvider`/`ActionProvider`/`ValidationProvider`) from `Home()` into `Playground()`'s return (Playground owns `displayedSpec`) and pass `initialState={displayedSpec?.state ?? {}}`
- `e2e/state.spec.ts` (new) — mock spec with `state` + `repeat` + `$state`/`visible`/`setState` assertions
- `e2e/msw/fixture.ts` + `e2e/constants.ts` — `STATEFUL_UI_LINES` fixture and shared `STATE_MOCK` labels
- MCP live re-verification of the gallery session (6 cards render, lightbox opens, undo restores)

### Out of scope

- Persisting runtime store mutations (e.g. `lightboxOpen` clicks) back into `spec.state` / history revisions — seed-only fix; undo resetting transient dialog state to the committed seed is acceptable semantics (descoped 2026-10-05)
- Controlled store (`createStateStore` + manual sync) — rejected, duplicates the library's own diff-on-initialState effect (descoped 2026-10-05)

## Design decisions

1. **Move the provider stack into `Playground`** rather than lifting `displayedSpec` to `Home` or adding an `onSpecState` callback — `Playground` is the single owner of the spec, the providers wrap only `<Playground />` today (no other consumers), and the move keeps one source of truth. Rejected: callback up + state down (re-render loop risk, two sources of truth).
2. **Reuse `StateProvider`'s native `initialState` effect** (reference-based diff: sets changed keys, deletes absent ones). Verified semantics against dist source: same `state` reference → early return (edits that spread `...spec` keep the same reference → user mutations not clobbered); new generation/undo/restore → structuredClone/new object → re-seed to the snapshot. Rejected: manual `store.update` effect (re-implements library logic).
3. **`?? {}` fallback** keeps stateless specs behaving exactly as today: `{}` diff wipes any keys left by a previous spec (fresh-canvas reset).

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build && bun run test:e2e` — all green (76 unit / 19 e2e)
- [x] New `e2e/state.spec.ts`: 6 repeated items render from seeded `/items`; `$state`-gated content hidden until `setState` flips it; `$state` value renders
- [x] Existing suites unaffected (mock specs are stateless → `{}` wipe path) — 18 prior e2e still pass
- [x] MCP live check: fresh gallery generation renders 6 cards in 3×2 (was zero-child grid); restored pre-fix lightbox entry seeds state → Expand opens Dialog with `$state` title + `$template` caption, Close Viewer round-trips twice

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-05 | plan drafted (after gallery experiment exposed empty grid) |
| 2026-10-05 | approved |
| 2026-10-05 | implemented — full chain green (76 unit / 19 e2e) + MCP live gallery + lightbox verified |
