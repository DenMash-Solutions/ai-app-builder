# Drag & Drop — Implementation Plan

**Status:** implemented
**Date:** 2026-10-05

## Goal

Let users rearrange components by dragging them directly on the rendered canvas: reorder siblings, drop into other containers, and move between containers — all as a single local spec mutation committed as one undoable history revision. Complements the existing Structure tab (one-level list + move up/down buttons), which only reorders within a single parent.

## Scope

### In scope

- **Core primitive** `moveElement(spec, { key, targetParentKey, index })` in `lib/editor/structure.ts`
  - detach from current parent (`children` array **or** named slot), attach into target's default `children` at clamped index
  - same-parent reorder with index correction (remove before insert)
  - guards: root not draggable, cycle guard (cannot drop a subtree into itself/descendant), missing keys → `null`
  - unit tests covering: cross-container move, same-parent reorder, cycle guard, move out of a named slot, clamping, root protection
- **Canvas drag interaction** (`components/editor/canvas-dnd.tsx`, pointer-events delegation on the existing `containerRef`)
  - hover: grab cursor + outline on `[data-jr-key]` wrappers (attributes already rendered via `markDevtoolsActive()`)
  - press + **5 px movement threshold** arms the drag (so plain clicks still select); pointer capture on the container suppresses generated-UI handlers while dragging
  - drag ghost following the cursor + drop indicator (insertion line / container highlight)
  - drop target resolution from `getBoundingClientRect()`s of wrappers (same measurement pattern as `hover-badge.tsx`)
  - drop zones: child rect top/bottom 30% → insert before/after; container middle (and empty containers) → append inside; canvas background / Esc / pointerup outside → cancel (no revision)
  - cross-container moves by hovering another container's middle zone
- **History integration**: one `commitRevision` per completed drag, label `structureRevisionLabel(STRUCTURE_OPS.move, detail)` → undo/redo works unchanged
- **page.tsx wiring**: `handleMoveTo(key, parentKey, index)` mirroring `handleMove`
- **i18n**: indicator/aria labels in `en` + `es` (parity)
- **E2E**: Playwright pointer drag (`mouse.down` → `mouse.move` → `mouse.up`) asserting (a) cross-container move reflected in `revs`/`head` storage and DOM order, (b) Esc cancels with no new revision

### Out of scope

- Structure-tree DnD (the Structure tab stays a one-level list with move up/down buttons; a full recursive tree + tree DnD is a separate feature) — descoped 2026-10-05, canvas drag is the headline interaction and the tree UI does not exist yet
- Multi-select / drag of multiple elements — single-element drag only (2026-10-05)
- Dropping **into named slots** (card header/footer etc.): drops always land in the target's default `children`; moving *out of* a named slot via drag IS supported (2026-10-05)
- Touch-only gestures beyond what Pointer Events give for free; haptics
- FLIP/animation polish beyond the drag ghost and indicator
- Drag-to-delete (dropping on a trash zone), drag from the component picker

## Design decisions

1. **Custom Pointer Events, no DnD library** — rejected: HTML5 native DnD (unstyleable indicators, poor touch support, fights React synthetic events), `@dnd-kit/core` 6.3.1 (canvas elements are rendered by `@json-render/react`'s component map — we don't own those component boundaries, so per-element `<Draggable>`/`useDraggable` hooks cannot be injected; its collision strategies don't cover our 30/40/30 zone math anyway), `@dnd-kit/dom` 0.5.0 (imperative DOM API would fit, but pre-1.0 API churn + 1.2 MB unpacked for what is mostly our own zone/indicator/ghost code). Pointer Events: no dependency, one code path for mouse/touch, directly scriptable in Playwright's mouse API, matches the existing container-delegation pattern (`pick-overlay.tsx`, `hover-badge.tsx`). Revisit dnd-kit if the feature grows to multi-select drag, sortable trees with FLIP animation, or primary keyboard-DnD (its a11y sensors) — until then structure-tab buttons (aria-labeled, keyboard-operable) cover the keyboard path.
2. **Drag on any element, not just the selected one** — rejected: drag-only-when-selected (extra click before every drag, easy to forget selection). 5 px threshold keeps click-to-select reliable.
3. **Zones by rect proportions** (30/40/30 for containers, 50/50 for leaves) — rejected: nearest-edge-only (cannot distinguish "inside container" from "between children"), center-of-leaf = inside (leaves have no children).
4. **`moveElement` as a pure primitive in `lib/editor/structure.ts`** — rejected: logic inside the React component (untestable, breaks the existing "all primitives are immutable local edits" contract at structure.ts:29-33).
5. **One revision per completed drag** — rejected: per-pick previews in history (noise), no revision (breaks undo contract).
6. **Cancel = no-op** (Esc, drop on background/outside) — rejected: fallback to nearest target (surprising drops).

## Decisions (resolved 2026-10-05, approved by user)

1. **Surface: canvas preview DnD (A)** — structure-tree DnD stays out of scope
2. **Draggable scope: any element** — 5 px threshold preserves click-to-select
3. **Named-slot drop targets: default `children` only** — dragging out of a named slot supported; per-slot zones descoped

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build && bun run test:e2e` — all green (76 unit, 18 e2e)
- [x] `bun test lib/editor/structure.test.ts` — 27 tests green (11 new for `moveElement`/`resolveMoveTarget`)
- [x] E2E drag test: reorder + cross-container + Esc-cancel + undo-after-drag (`editor.spec.ts`)
- [x] MCP live check: real Gemini sign-in spec — cross-container drop (`email-field` → `action-stack`, label `structure:move`, revs 1→2), Escape cancel (no revision), Cmd+Z restore (DOM + storage), ghost/indicator visually confirmed via screenshot
- [x] i18n `en`/`es` parity (`editor.dnd.grabbed`)

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-05 | plan drafted (awaiting answers to open questions) |
| 2026-10-05 | approved — canvas surface, any-element drag, children-only drops |
| 2026-10-05 | implemented — full chain green (76 unit / 18 e2e) + MCP live drag check passed |
