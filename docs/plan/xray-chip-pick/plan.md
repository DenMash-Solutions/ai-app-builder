# X-Ray Chip Pick — Implementation Plan

**Status:** implemented
**Date:** 2026-10-08

## Goal

Make x-ray chips clickable while the picker (select mode) is active, with the exact same semantics as clicking the canvas: click selects the element for editing, shift+click toggles that instance in the prompt scope, shift+alt+click toggles the shared template (all instances). Chips carry per-instance wrapper identity, so repeat-instance chips target the clicked instance — the same disambiguation the canvas pick provides.

## Scope

### In scope

- `XrayLabels` props: `interactive` (host gates on pick mode + not streaming + spec present), `onSelect(key, chain)`, `onToggleScope(key, chain, template)` — same signatures as `PickOverlay`
- Chip div: when interactive — `pointer-events-auto cursor-pointer select-none`, click handler with the canvas modifier mapping (`shiftKey` → `onToggleScope(..., altKey)`, else `onSelect`); chain from `computeInstanceChain(spec, label.wrapper)`
- Chip hover preserves hover-focus while the pointer is over a chip (the chip otherwise blocks the canvas `mouseover`): enter/leave wire the existing `hoverKey`/`hoverWrapper` state from `label.wrapper`
- Playground wiring: pass the three props (gating mirrors `PickOverlay`'s `enabled`)
- e2e: chip click opens the editor for that key; chip shift+click adds an instance scope; chip shift+alt+click adds a template scope (stateful repeat fixture)

### Out of scope

- Clicking dots/markers (still canvas-through) — chips are the affordance; dots stay decorative (descoped 2026-10-08)
- Chip double-click → activate (enter pick + edit) — canvas dblclick already covers the gesture; chips are pointer-events-none when pick is off (descoped 2026-10-08)
- Clickable chips while pick mode is OFF — request was "if picker is active" (descoped 2026-10-08)

## Design decisions

1. **Chip click handled in `XrayLabels` via React `onClick`, not by extending `PickOverlay`'s container listener** — rejected: PickOverlay's capture listener is attached to the scroll container, and the x-ray overlay is a deliberate sibling of that container (overflow invariant), so container listeners never see chip events; the chip already holds `label.wrapper` for chain computation
2. **Hover wiring from the chip into the existing hover state** — rejected: leaving hover dead over chips, because `pointer-events-auto` would silently kill the hover-focus dim/highlight experience whenever the pointer rests on a chip

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build && bun run test:e2e` — all green; **210 unit / 643 assertions**, **60 e2e** (59 + 1 new chip test)
- [x] e2e (`prompt-scope.spec.ts` "x-ray chips pick and scope like the canvas"): pick-on chip `pointer-events: auto`; chip click → editor opens for `state-item`; chip shift+click → instance scope `Text 3/6` + one `[data-jr-scope]`; chip shift+alt+click → template `Text ×6` + six marks, selection unmoved; pick-off chip `pointer-events: none`
- [x] MCP: live carousel — pick armed + chips `pointer-events: auto`/`cursor: pointer`; chip click → panel opens for `product-card` instance 1/8; chip2 shift+click → scope `Card 2/8` (one mark, panel still open); shift+alt+click → `Card ×8` + 8 marks; pick off → chips `pointer-events: none` again

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-08 | plan drafted — overlay is a sibling of the scroll container (overflow invariant), so chip clicks need their own handler; canvas modifier mapping reused verbatim |
| 2026-10-08 | approved |
| 2026-10-08 | implemented — interactive chips + hover stickiness (`relatedTarget` guard on container mouseleave so hover-only chips survive the pointer crossing onto them); 210/643 unit, 60/60 e2e; live click/shift/alt verified both ways |
