# Runtime CSS Layer — Implementation Plan

**Status:** approved
**Date:** 2026-10-08

## Goal

The runtime-compile hook injects Tailwind output into an **unlayered** `<style>` tag. Unlayered declarations outrank every cascade layer, so any class the injected CSS shares with the app chrome silently overrides the static build. The first live trigger: a generated spec containing `flex-col` injected an unlayered `.flex-col{flex-direction:column}` that beat the layered `.sm:flex-row` on `<main>` → flex direction flipped to column at all viewports → the editor drawer (full-height, shrink-0) stacked below the canvas column instead of beside it → canvas column height 0 → `overflow-y-auto` clipped all spec content and the canvas went blank whenever the drawer was open. This fix wraps injected CSS in a `runtime` cascade layer that loses to the static `utilities` layer, restoring correct chrome layout while keeping on-demand classes working.

## Scope

### In scope

- `lib/runtime-classes/wrap-runtime-css.ts` — pure `wrapRuntimeCss(css)` returning `@layer runtime{…}` (no-op wrap for empty string) + unit tests
- `components/playground/use-runtime-classes.ts` — wrap returned CSS before injecting
- e2e in `e2e/runtime-classes.spec.ts`: with the drawer open on a spec containing `flex-col`, `main` computes `flex-direction: row` and the canvas scroller has non-zero height; injected tag content starts with `@layer runtime`
- Manual MCP verification on the live page (drawer open → canvas visible again)

### Out of scope

- Sub-640px layout: `flex-col` below `sm:` is intentional; drawer-over-canvas stacking there stays as designed (descoped 2026-10-08)
- Drawer UX for state-bound child text — the model built cards via children bound to `/products` state, so Card's `title`/`description` props are genuinely absent and empty fields are data-truthful (descoped 2026-10-08, possible future feature)
- Changing the compile endpoint or selector extraction (descoped 2026-10-08)

## Design decisions

1. **`@layer runtime` wrapper, not selector rewriting or static-CSS filtering** — rejected: prefixing every injected selector with a scope (requires parsing/re-serializing CSS); rejected: skipping candidates already present in static stylesheets (previously rejected as brittle — runtime-class-compile design decision 5; also cannot see into layered rules reliably).
2. **Layer loses to utilities by declaration order** — static CSS declares `@layer theme, base, components, utilities` first; the injected `@layer runtime` appends last, so utilities outrank runtime. Spec elements still receive identical rules from the static layer where they exist; injected rules only matter where static compiled nothing.
3. **Wrap the entire compile output** (including its theme `:root`/`.dark` blocks) — those land in the runtime layer and lose to the identical unlayered static theme rules; harmless and keeps the helper trivial.
4. **Pure helper in `lib/runtime-classes/`** with unit tests — the invariant (every injected chunk is layered) must be testable without a browser (`bun test lib`).

## Verification

- [ ] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build && bun run test:e2e`
- [ ] New e2e passes: drawer open + `flex-col` spec → `main` is `flex-direction: row`, scroller height > 0, injected tag layered
- [ ] Manual MCP check on the live page: drawer reopens with canvas visible at 885px viewport
- [ ] Unit: `wrapRuntimeCss("")` safe; nesting/content preserved

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-08 | plan drafted in implementation preview |
| 2026-10-08 | approved (user "ok") |
