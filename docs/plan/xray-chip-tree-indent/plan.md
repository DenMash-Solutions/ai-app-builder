# X-Ray Chip Tree Indent — Implementation Plan

**Status:** rejected
**Date:** 2026-10-08

> **Outcome**: implemented and verified, then **rejected by the user on live review** —
> the tree outline (chip x = depth × indent from the canvas edge) collapsed all
> repeat-instance chips into one left column over the first card instead of
> sitting over their own containers. Fully reverted (code + e2e byte-identical
> to `12e8430`); element-anchored chips (`chipLeft = box x`) restored. The
> original "good indent" the user cited (`product-image` → `badge-overlay-container`)
> is the element-anchored placement picking up the parent's layout padding —
> that behavior is intact. Lesson: verify x-ray placement on a *repeat-heavy*
> spec before committing to a placement scheme.

## Goal

When x-ray mode is enabled, permanent chips (`key · Type`) render as a left-aligned tree outline — `chipLeft = EDGE + depth × 10px` — so the vertical stack reads like an indented tree and nesting depth is legible at a glance. Today chips are element-anchored (`chipLeft = box x`), so depth doesn't read: `product-image` (depth 4) and `card-overlay-content` (depth 4) sit at the same x, and the only "indent" seen (e.g. `badge-overlay-container` at +20px) is the element's own padding, not hierarchy. Dots/markers stay pinned to element box corners so elements remain locatable.

## Scope

### In scope

- `chipLeft` for every chip (containers, quiet leaves, hover-only leaves) = `EDGE + depth * CHIP_INDENT` with `CHIP_INDENT = 10` (overlay-relative; the overlay's `overflow-hidden` clips at the canvas edge — unchanged)
- Lane-placement pass uses the same tree x for its overlap `rect.x` (otherwise overlap math desyncs from render)
- e2e: child chip left − parent chip left === 10 for a known pair (`product-card` → `dark-overlay`); existing hierarchy / overlap / no-overlap tests stay green

### Out of scope

- Changing vertical lane stacking, tiering, or hover behavior — untouched (descoped 2026-10-08)
- Indent cap / depth clamp — generated UIs rarely exceed depth ~10 (≤100px + 160px chip < canvas) (descoped 2026-10-08)
- Element-anchored min-indent hybrid — rejected in favor of the tree outline (descoped 2026-10-08)

## Design decisions

1. **Uniform tree x for all chips** — one formula, always legible; rejected: min-indent hybrid (chips stay scattered at arbitrary element x's; depth still hard to compare across subtrees)
2. **Dots stay element-anchored** — the dot/marker marks the element's box corner; the chip becomes a tree label; rejected: moving dots too (loses the element↔label spatial link)
3. **10px per level, no cap** — matches the existing boxless-marker cascade (`depth * 10`, `xray-labels.tsx:230`); rejected: 4-6px (too subtle at 10px mono type), rejected: cap (arbitrary cut-off, no real-world depth to justify it)

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build && bun run test:e2e` — all green; **210 unit / 643 assertions**, **59 e2e** (in-editor test corrected mid-run: `carousel-tabs` is a sibling of the cards, not the row — tabs x === card x)
- [x] e2e: `carousel-card-1` chip x − `carousel-row` chip x === 10; tabs === card (same depth); existing container/leaf/overlap/hierarchy/ghost/overflow tests green
- [x] MCP on the 8-product carousel: chip lefts cascade 2 → 12 → 22 → 32 → 42 → 52 → 62 by depth; dots remain on element corners. Tradeoff noted: repeat instances share depth → their chips stack in one left column over the first card (was: spread across each card)

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-08 | plan drafted (research: `chipLeft = x` at `xray-labels.tsx:257`; depth already computed; +20px "indent" on `badge-overlay-container` is element padding coincidence) |
| 2026-10-08 | approved — tree outline chosen over element-anchored min-indent |
| 2026-10-08 | implemented — 210/643 unit, 59/59 e2e; live cascade verified on the carousel; repeat-instance chips now share one column (accepted, flagged to user) |
