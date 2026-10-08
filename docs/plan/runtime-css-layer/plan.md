# Runtime CSS Layer — Implementation Plan

**Status:** implemented
**Date:** 2026-10-08

## Goal

The runtime-compile hook injects Tailwind output into an **unlayered** `<style>` tag. Unlayered declarations outrank every cascade layer, so any class the injected CSS shares with the app chrome silently overrides the static build. The first live trigger: a generated spec containing `flex-col` injected an unlayered `.flex-col{flex-direction:column}` that beat the layered `.sm:flex-row` on `<main>` → flex direction flipped to column at all viewports → the editor drawer (full-height, shrink-0) stacked below the canvas column instead of beside it → canvas column height 0 → `overflow-y-auto` clipped all spec content and the canvas went blank whenever the drawer was open. This fix routes the on-demand compile's utilities into the `components` cascade layer (declared before `utilities` by the static sheet), so injected rules lose class-name collisions with the chrome while non-conflicting on-demand classes keep working.

## Scope

### In scope

- `lib/runtime-classes/compile.ts` — compile input imports utilities with `layer(components)` instead of `layer(utilities)`
- e2e in `e2e/runtime-classes.spec.ts`: with the drawer open on a spec containing `flex-col`, `main` computes `flex-direction: row` and the canvas scroller has non-zero height; injected tag content is layered (`@layer components`)
- Manual MCP verification on the live page (drawer open → canvas visible again)

### Out of scope

- Sub-640px layout: `flex-col` below `sm:` is intentional; drawer-over-canvas stacking there stays as designed (descoped 2026-10-08)
- Drawer UX for state-bound child text — the model built cards via children bound to `/products` state, so Card's `title`/`description` props are genuinely absent and empty fields are data-truthful (descoped 2026-10-08, possible future feature)
- Changing the compile endpoint or selector extraction (descoped 2026-10-08)

## Design decisions

1. **Route compiled utilities into the existing `components` layer** (`layer(components)` in `compile.ts`) — rejected: client-side `@layer runtime` wrap (original design), because the compile output contains inner `@layer utilities {…}` blocks; nested inside a client-appended `@layer runtime {…}` they form `runtime.utilities`, and a layer first declared AFTER the static sheet's statement outranks `utilities` — verified live: the wrapped build still computed `flex-direction: column` (revision 2026-10-08). Rejected also: prepending the runtime tag before the static `<link>` to reorder layer declaration — position-dependent and fragile vs. a server-side layer that joins a name the static sheet already ordered. Rejected: prefixing selectors / skipping static-present classes (runtime-class-compile design decision 5).
2. **`components` loses to `utilities` by the static sheet's own layer statement** — the static CSS declares `@layer theme, base, components, utilities` first; injected rules join `components` at its fixed position regardless of when the runtime tag is appended. Spec elements still receive identical rules from the static utilities where they exist; injected rules only matter where static compiled nothing.
3. **No client-side wrapper** — the hook injects endpoint CSS as-is (compile.ts owns the cascade contract); theme `:root`/`.dark` duplicates in the output are unlayered-but-identical to the static theme, harmless.

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build && bun run test:e2e`
- [x] New e2e passes: drawer open + `flex-col` spec → `main` is `flex-direction: row`, scroller height > 0, injected tag layered (`@layer components`)
- [x] Manual MCP check on the live page: drawer reopens with canvas visible at 885px viewport
- [x] Endpoint smoke: compiled CSS places utilities inside `@layer components`

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-08 | plan drafted in implementation preview |
| 2026-10-08 | approved (user "ok") |
| 2026-10-08 | design revised: e2e proved `@layer runtime` wrap still loses nothing — nested inner `@layer utilities` blocks outrank the static sheet; switched to server-side `layer(components)` |
| 2026-10-08 | implemented — chain green (202 unit / 618 assertions, build ok, 36 e2e); live MCP: drawer 448×930 open → main row, scroller 437×930, 8 cards single-row |
