# X-Ray Chip DFS Placement — Implementation Plan

**Status:** implemented
**Date:** 2026-10-08

## Goal

Fix the x-ray chip stack misreading where a child's chip lands under a later sibling's chip (observed: `badge-overlay-container` stacked under `product-image`, making the background image look like the badge's parent). Chips must stack in tree (depth-first document) order within each container so vertical adjacency always implies parenthood.

## Root cause

`components/editor/xray-labels.tsx:286-291` — the placement pass sorts permanent chips globally by `(depth, y, x)`. All depth-N chips across all instances reserve rows before any depth-N+1 chip is placed. A later DOM sibling at depth N (e.g. `product-image`) therefore always occupies the rows above every child of an earlier sibling (e.g. `badge-overlay-container`), interleaving the visual tree.

## Scope

### In scope

- Placement order: replace the global depth sort with DFS document order (the `next` array's collection order from `querySelectorAll("[data-jr-key]")`, already depth-first) — keep the `container || quiet` filter; ancestors remain before descendants by construction
- e2e: within a carousel card, assert the badge chip's y is the row directly under the `card-overlay-content` chip (delta = CHIP_HEIGHT + LANE_GAP = 22) and the `product-image` chip is NOT between them (product-image y > badge y)
- MCP: live skincare carousel — badge chip directly under its real parent's chip; no sibling interleaving

### Out of scope

- Tree-outline x placement (chipLeft = depth × indent) — rejected 2026-10-08, see `docs/plan/xray-chip-tree-indent/plan.md` (chips must stay element-anchored in their containers)
- Connector lines / indent guides between parent and child chips — YAGNI until asked (descoped 2026-10-08)
- Hover-only chip placement path — unchanged; it reuses the permanent-chip positions

## Design decisions

1. **DFS document order for placement** — rejected: keeping `(depth, y, x)` with per-instance grouping, because global depth is the root cause and per-instance grouping adds complexity without fixing intra-instance interleaving; DFS order is what `querySelectorAll` already gives for free and guarantees ancestors-before-descendants
2. **No secondary y/x sort within the order** — rejected: sorting siblings by y, because DOM order is the semantic tree order the user reads; y-sorting would reorder children arbitrarily

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build && bun run test:e2e` — all green; **210 unit / 643 assertions**, **59 e2e**
- [x] e2e: new `carousel-overlay-card` fixture mirrors the live shape (content stack + full-bleed image sibling + badge child); adjacency assertions — badge chip y − content chip y === 22 (one chip row), image chip y > badge chip y; all existing hierarchy/overlap/ghost/overflow tests green. Assertions proven against the old code path by construction: global depth sort places the image (depth-N) before the badge (depth-N+1), which would give delta 44 and image < badge
- [x] MCP: live skincare carousel — `badge-overlay-container` chip at y=308, exactly 22 below `card-overlay-content` (y=286); `product-image` after the whole overlay subtree (y=603); each card's stack reads parent → children contiguously; chips remain element-anchored in their own containers
- [x] Removed the now-unused `depth` field from `LabelBox` (only consumer was the deleted sort)

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-08 | plan drafted — root-caused to global depth sort at `xray-labels.tsx:286-291`; live DOM tree verified (`product-image` is the last sibling of `card-overlay-content`) |
| 2026-10-08 | approved |
| 2026-10-08 | implemented — placement sort → DFS document order; `depth` field removed; overlay-card fixture + adjacency e2e; 210/643 unit, 59/59 e2e; live badge chip directly under its parent (Δ22), image after subtree |
