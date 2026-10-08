# X-Ray Labels — Implementation Plan

**Status:** implemented
**Date:** 2026-10-08

## Goal

X-ray mode today only draws outlines (solid green containers / dashed sky leaves) on the first real child of each `display: contents` wrapper — components with no box (fragments, text-only roots, `display: contents` descendants), zero-area elements (thin borders, empty placeholders), and visually quiet elements (beige-on-beige stacks) are effectively invisible, and even drawn outlines carry no identity. This feature adds always-on **key+type chips** plus forced **footprint markers** for boxless elements, so every spec element is findable in x-ray mode — the annotated-callout metaphor from the user's reference image, scoped to identity labels (not style facts).

## Scope

### In scope

- New `components/editor/xray-labels.tsx`: an overlay layer (same clipping-overlay pattern as the selection-ring fix) rendering, per `[data-jr-key]` wrapper in the canvas:
  - a chip `key · Type` (font-mono 10px, HoverBadge aesthetic) positioned above the element's measured box (fallback: below), clamped to the overlay
  - a 4px corner dot at the exact box origin (precise anchoring in dense areas)
  - a forced 10px amber diamond **marker** when the element has no measurable box (zero-area, `display: contents` root, or `hidden`) — positioned at the parent's box + depth offset so it is always visible
- **Significance tiers (redesign 2026-10-08, user-approved after live density review)**: chips are not for every element —
  - **containers** (spec children/slots) → always-on text chip (layout skeleton)
  - **leaves with rendered text** → type-colored **dot only** (they self-identify); full chip on hover
  - **quiet leaves** (no rendered text: images, overlays, empty spacers) and **boxless** elements → always-on text chip (+ marker if boxless) — the "hard to see" cases
- **Component-family colors** on chips/dots (`TYPE_FAMILIES` map: Stack emerald, Card violet, Text/Heading sky, Badge amber, Image pink, Button rose, default zinc) and on canvas outlines via `data-jr-type` attribute set by the existing tagging effect + CSS type rules
- **Hover focus**: passive mouseover on the canvas container → hovered element's subtree (ancestors + self + descendants) stays full opacity with the hovered chip expanded; everything else fades to 30%; hovered box gets a bright outline rect in the overlay — overlay stays `pointer-events-none`, events come from the canvas
- **Overlap avoidance (2026-10-08, user-approved after live density review)**: greedy lane stacking in the measure pass — permanent chips (containers + quiet leaves) place in (y, x) order against already-placed chip rects; on collision shift up one lane (chip height + 2px gap, max 3 lanes), then try below the box (max 2 lanes), else accept; chip width estimated from `key · Type` length at `font-mono 10px` (≈6.2px/char + padding, capped at 160). Edge-anchored chips: `chipLeft = box x` always — no horizontal clamp (the clamp used to pull edge chips into their neighbors); `overflow-hidden` clips at the canvas edge instead
- Box measurement = union of the wrapper's direct element children's rects (contents spans contribute nothing; fragments union correctly); empty union → wrapper `getBoundingClientRect`; still empty → parent-box cascade offset
- Update triggers: spec/xray toggles, passive container scroll, `ResizeObserver` on the container (covers docked-drawer shifts + panel enter animation), coalesced into one rAF per frame — not a continuous rAF loop
- Mount point: `app/[locale]/page.tsx`, as a sibling **after** the scroll container (inset-0 overflow-hidden clipping overlay — decorations must never join the scroller's scrollable overflow; invariant re-asserted in e2e)
- e2e: container chips visible; text leaves render dots (no chips) and gain chips on hover; marker for a `hidden` (boxless) element added to the carousel fixture; `scrollWidth == clientWidth` invariant while labels are shown

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
7. **Significance tiers + hover focus (redesign 2026-10-08, user-approved via question tool)** — the v1 always-on-chips build rendered 110 chips on the live 437px carousel canvas (MCP screenshot): equal visual weight made the anatomy *harder* to scan, the opposite of the goal. Fix: containers keep always-on chips (the layout skeleton), text-bearing leaves become dots only (they self-identify), quiet/boxless leaves keep chips (they're the original "invisible" complaint), and hover expands + focuses a subtree — rejected: pure hover-only labels, because the user explicitly chose always-on in the original scope and the skeleton (containers + quiet leaves) should stay scannable without interaction; rejected: depth cap as primary thinning, because significance tiering already cuts ~50% and targets noise precisely (depth cap stays out of scope unless density complaints persist)
8. **Outline family colors via `data-jr-type` + static CSS rules** — rejected: inline `outlineColor` mutation in the tagging effect, because mutating generated element styles risks colliding with generated UI's own outline styles and needs careful cleanup; a data attribute + CSS attribute selectors keeps React out of the paint path; equal specificity with the base container/leaf rules, declared later, so type colors win without `:not()` gymnastics
9. **Greedy lane stacking + edge anchor for chip placement (2026-10-08, user-approved via question tool)** — v1/v1.1 placed chips independently, so nested same-top elements (card chip + its first-child overlay chip both anchored at the card's top edge) and carousel siblings fully overlapped (visible in the MCP screenshot). Placement is now a second pass in `update()`: permanent chips place in (y, x) order against placed rects, shifting up lanes then below-box before accepting overlap; hover-only chips (text leaves) skip placement — they're few and focused. Horizontal clamp removed entirely: chips stay anchored at their box's left edge and get clipped by the overlay at the canvas edge (scrolling reveals them) — rejected: post-render rect measurement + reflow (two-pass flicker), because `font-mono 10px` metrics are predictable enough to pre-estimate; rejected: cluster-collapse ("+N") chips, because lane stacking already resolves the observed collisions with zero new state; rejected: collision-hide of non-focused chips, because lanes leave no stragglers in the observed layouts

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build && bun run test:e2e` — all green (202 unit / 618, build, **40 e2e**)
- [x] e2e: x-ray test extended — chip with key text visible for normal elements; marker present for the `hidden` (boxless) element in the carousel fixture (`carousel-ghost`); canvas `scrollWidth == clientWidth` while labels render; chips unmount when x-ray toggles off
- [x] MCP: x-ray on the live Hydra-Barrier carousel (885×930) — 110 chips (`main-container · Card`, `carousel-section · Stack`, `product-card · Card`, …) including quiet/overlaid elements (`badge-overlay`, `dark-overlay`, `product-name-overlay`) that were previously invisible; `scrollWidth 437 == clientWidth 437`, `scrollLeft 0`; markers correctly absent (every live element paints a box); fresh screenshot shows the annotated-canvas anatomy — *(v1, superseded by the redesign below)*
- [x] Redesign (chips+dots+hue+hover): chain green (202 unit / 618, build, 40 e2e — lint caught ref-reads-during-render, restructured to spec-tree hover state); MCP — chips **110 → 68** (skeleton: containers + quiet overlays only), text leaves are family-colored dots, hover on the Hydra heading: its key's chip expands (8 repeat instances share the focus), amber outline rect sized exactly to the target box (134.6×24), subtree lit 43 / rest dimmed 33, `scrollWidth == clientWidth == 885`; fresh screenshot shows the scannable anatomy (violet cards, emerald stacks, sky text dots, amber badges, hover focus on `product-name-overlay`)

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-08 | plan drafted (user-approved scope: key+type chips, always-on, markers + union rects) |
| 2026-10-08 | approved (user via question tool) |
| 2026-10-08 | implemented — chain green (202 unit / 618, build, 40 e2e) + MCP: 110 chips on live carousel, no canvas overflow, previously-invisible overlays now labeled |
| 2026-10-08 | scope amended (user review of live density): significance tiers (container chips / text-leaf dots / quiet-leaf chips), component-family colors (chips, dots, outlines via data-jr-type), hover focus with subtree dim — redesign of always-on full chips (decision 7) |
| 2026-10-08 | implemented redesign — chain green (202 unit / 618, build, 40 e2e); MCP: 68 chips + family dots, hover focus verified (chip expand, exact-size outline, 43 lit / 33 dimmed), no canvas overflow |
| 2026-10-08 | overlap avoidance implemented (decision 9) — chain green (202 unit / 618, build, 40 e2e incl. carousel-tabs same-top collision regression asserting zero pairwise chip overlap); MCP: 51 chips, **0 overlapping pairs**, edge-anchor verified (every chip x == its card's x, 49…2121, no clamp), `scrollWidth == clientWidth == 885`; whitespace-only Text collapses to 0×0 so the collision fixture uses a padded Button with a space label |
