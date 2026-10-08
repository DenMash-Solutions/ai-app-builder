# X-Ray Labels — Implementation Plan

**Status:** approved
**Date:** 2026-10-08

## Goal

X-ray mode today only draws outlines (solid green containers / dashed sky leaves) on the first real child of each `display: contents` wrapper — components with no box (fragments, text-only roots, `display: contents` descendants), zero-area elements (thin borders, empty placeholders), and visually quiet elements (beige-on-beige stacks) are effectively invisible, and even drawn outlines carry no identity. This feature adds always-on **key+type chips** plus forced **footprint markers** for boxless elements, so every spec element is findable in x-ray mode — the annotated-callout metaphor from the user's reference image, scoped to identity labels (not style facts).

## Scope

### In scope

- New `components/editor/xray-labels.tsx`: an overlay layer (same clipping-overlay pattern as the selection-ring fix) rendering, per `[data-jr-key]` wrapper in the canvas:
  - a chip `key · Type` (font-mono 10px, HoverBadge aesthetic) positioned above the element's measured box (fallback: below), clamped to the overlay
  - a 4px corner dot at the exact box origin (precise anchoring in dense areas)
  - a forced 10px amber diamond **marker** when the element has no measurable box (zero-area, `display: contents` root, or `hidden`) — positioned at the parent's box + depth offset so it is always visible
- Box measurement = union of the wrapper's direct element children's rects (contents spans contribute nothing; fragments union correctly); empty union → wrapper `getBoundingClientRect`; still empty → parent-box cascade offset
- Update triggers: spec/xray toggles, passive container scroll, `ResizeObserver` on the container (covers docked-drawer shifts + panel enter animation), coalesced into one rAF per frame — not a continuous rAF loop
- Mount point: `app/[locale]/page.tsx`, as a sibling **after** the scroll container (inset-0 overflow-hidden clipping overlay — decorations must never join the scroller's scrollable overflow; invariant re-asserted in e2e)
- e2e: chips visible with key text in x-ray; marker for a `hidden` (boxless) element added to the carousel fixture; `scrollWidth == clientWidth` invariant while labels are shown

### Out of scope

- Leader lines connecting chip to target (image style) — chips sit adjacent to the box; revisit on request (descoped 2026-10-08: ~30 simultaneous lines read as spaghetti; proximity suffices)
- Style-fact callouts ("beige bg", "italic serif", "side-tab border") — user picked key+type chips (descoped 2026-10-08)
- Auto-thinning / overlap-resolution heuristics — chips are pointer-events-none and small; tune later if density complaints arrive (descoped 2026-10-08)
- i18n — chip content is spec data (keys/types), not UI copy (descoped 2026-10-08)
- Changing the existing outline CSS (container/leaf colors) — chips complement outlines (descoped 2026-10-08)

## Design decisions

1. **Overlay component, not CSS pseudo-labels** — rejected: `::after { content: attr(data-jr-key) }` on wrappers, because wrappers are `display: contents` (no box to anchor against) and adding `position: relative` to them would change the containing block of generated absolutely-positioned content (same hazard class the selection ring documented); rejected: mutating the wrapper DOM with label nodes, because React owns the tree
2. **Clipping overlay sibling of the scroll container** (inset-0, overflow-hidden, pointer-events-none, z-10) — rejected: mounting inside the scroller, because absolutely-positioned decorations there inflate the container's scrollable overflow (measured live 2026-10-08: ring inflated scrollWidth 543→vs 437; fixed in `pick-selection-ring` decision 7)
3. **Event-driven measurement (scroll passive + ResizeObserver + dep changes) with rAF coalescing** — rejected: continuous rAF (the ring's pattern), because labels exist only while x-ray is on and typically number 20–80 elements; RO already fires per animation frame during the panel's enter transition, so no tracking gap
4. **Union of direct element children as the anchor box** — rejected: `firstElementChild`-only (the outline's rule), because fragments render multiple roots and the chip would misanchor; rejected: full descendant union, because nested wrappers would double-count children into the parent's box
5. **Always-visible amber diamond for boxless elements, cascaded from the parent box by depth** — rejected: hiding unlabeled elements (status quo), because the whole point is finding what paints nothing; rejected: forcing a min-size on the element itself (would perturb generated layout)
6. **Corner dot at the exact box origin** — cheap precision aid when chips float above crowded regions; 4px, same color family as the chip border

## Verification

- [ ] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build && bun run test:e2e`
- [ ] e2e: x-ray test extended — chip with key text visible for a normal element; marker present for the `hidden` (boxless) element in the carousel fixture; canvas `scrollWidth == clientWidth` while labels render
- [ ] MCP: x-ray on the live Hydra-Barrier carousel — chips for `carousel-section`, `product-card`, `info-stack`, `product-name` etc.; thin/quiet elements (price stack, side rules) identifiable; no phantom canvas overflow (`scrollWidth == clientWidth`); fresh screenshot

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-08 | plan drafted (user-approved scope: key+type chips, always-on, markers + union rects) |
| 2026-10-08 | approved (user via question tool) |
