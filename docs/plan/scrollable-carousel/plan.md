# Scrollable Single-Row Carousel — Implementation Plan

**Status:** draft
**Date:** 2026-10-07

## Goal

Model-generated carousels must render as a **single non-wrapping row** at every viewport, with a horizontal scroll container so cards beyond the fold remain reachable — today a carousel with 8 items on `grid-cols-4` silently wraps into 2 rows and stops being a carousel. This closes the gap with one prompt rule, compile coverage for the scroll-pattern classes models will need, a probe that pins the behavior, and one real-API generation verified at mobile width.

## Scope

### In scope

- **A. Prompt rule** (in `lib/playground/styling-rules.ts`, shared by generate + steer):
  - Carousel-style sections (product rows, card decks, galleries) = one non-wrapping row inside a scroll container: `flex` + `overflow-x-auto` + `snap-x` with `shrink-0 min-w-*` cards (or `grid grid-flow-col auto-cols-*` + `overflow-x-auto`)
  - Never express a carousel as a wrapping grid (`grid-cols-N`) — wrapping grids are for galleries/tables, not carousels
  - Cards get fixed width via **named** tokens (`min-w-64`, `min-w-72`, …) per the existing A2 named-over-arbitrary rule
- **B. Compile coverage** in `app/globals.css` `@source inline` (observed-evidence enumeration, same trimmed approach as B2):
  - scroll/snap set: `overflow-x-auto`, `overflow-x-scroll`, `scroll-smooth`, `snap-x`, `snap-start`, `snap-end`, `snap-always`, `snap-mandatory`, `snap-proximity`
  - non-shrinking row: `shrink-0`, `grow-0`, `flex-nowrap`, `grid-flow-col`, `auto-cols-{min,max,fr,3xl,2xl,xl,lg,md}`
  - card widths: named `min-w-{0,16,…,96}` (full named scale), plus observed arbitrary `min-w-[240px|260px|280px|300px|320px]`
  - edge-bleed idiom often emitted with carousels: `-mx-*`/`px-*` pairs already partially covered — verify and add the `-mx-{4,6}` forms if missing
- **C. Probe**: new e2e case in `e2e/runtime-classes.spec.ts` — 8 fixed-width cards in `flex overflow-x-auto snap-x` → assert (a) all 8 card rects share the same y (single row, no wrap), (b) `scrollWidth > clientWidth` (actually scrollable), (c) last card x is beyond client width (hidden content exists)
- **D. MCP live check (real API)**: generate an 8-card carousel prompt at a mobile viewport (~390px) → verify one row + horizontal scroll (scroll to end, 8th card visible), then desktop width → still one row (scrolls); light + dark both readable
- Update this plan's status log + verification on completion

### Out of scope

- Retrofitting the stored "Richard's Favorites" history entry — future generations adopt the pattern; existing drafts can be steered manually (descoped 2026-10-07, user chose full scope without retrofit)
- Custom scrollbar styling / hide-scrollbar utilities — cosmetic, not required for reachability (descoped 2026-10-07)
- Carousel *behavior* (arrows, dots, autoplay, drag-to-scroll) — that is component interactivity, not layout; scroll container alone satisfies reachability (descoped 2026-10-07)
- Wrapping on large screens — user decision: always a single row at every viewport (2026-10-07)

## Design decisions

1. **Single row at every viewport, scroll on overflow** — rejected: wrap into rows above `lg`, because it splits carousel semantics by breakpoint and doubles the prompt rule's conditional surface; user decision 2026-10-07
2. **Prompt steers the pattern, CSS only guarantees the classes** — rejected: forcing scroll layout post-generation (spec rewriting), because it mutates model output outside the patch/steer path and is brittle; the prompt rule already proved effective for dual-theme (feature dual-theme-generation)
3. **Coverage via trimmed `@source inline` enumeration, not exhaustive arbitrary space** — same decision as dual-theme #6: enumerate the scroll-pattern forms models plausibly emit (named min-w scale + a few observed arbitrary widths), let prompt rule A2 keep output in named tokens
4. **Probe asserts geometry, not class strings** — same rationale as dual-theme #3: same-y + scrollWidth checks prove the visible behavior (one row, scrollable) regardless of which syntactic variant (`flex` vs `grid-flow-col`) the test fixture uses

## Verification

- [ ] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build && bun run test:e2e` — all green (baseline 142 unit / 31 e2e; +1 e2e expected)
- [ ] Unit: styling-rules test pins the carousel clause (single row, `overflow-x-auto`, named `min-w-*`)
- [ ] e2e: 8-card single-row + scrollable probe passes; no existing probe regresses
- [ ] MCP (real API): 8-card carousel generated → at ~390px: one row, scrolls to card 8; at desktop: still one row; light + dark both readable
- [ ] CSS size delta recorded in this plan (baseline: 3,095,385 raw / 231,005 gzip)

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-07 | plan drafted (scope confirmed via question tool: always-one-row + full scope incl. live test) |
