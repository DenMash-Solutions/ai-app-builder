# Instance-Scoped Editing (Granular Selection) — Implementation Plan

**Status:** implemented
**Date:** 2026-10-05

## Goal

Picking an element that renders inside a `repeat` (e.g. the Metropolis Twilight image in the gallery) currently edits the **shared template** — the panel either changes all instances at once or displays bindings as `[object Object]`, and the selection ring marks the first instance instead of the clicked one. This feature makes selection instance-aware: data-bound props on a picked instance edit **that item's state** (`spec.state.images[2].url`), while literal props and structure ops stay template-level — with an explicit note — so manual editing becomes granular where granularity is meaningful and honest where it isn't.

## Scope

### In scope

- **Instance resolution on pick** (`pick-overlay.tsx` + new pure lib):
  - walk DOM ancestors to the nearest ancestor whose spec element has `.repeat`; count same-key wrappers preceding the clicked one inside that repeat container's DOM instance → DOM position → **filter-remap** through the container's `visible` itemFilter (`splitRepeatVisibility` + `evaluateVisibility` from `@json-render/core`, same call `RepeatChildren` makes) → exact array index; compose outward for nested repeats (`resolveRepeatStatePath` / `resolveRepeatItemStatePath`)
  - selection ring marks the **clicked instance**, not the first same-key wrapper
- **Binding-aware property panel**:
  - per-prop target resolution: `{$item: f}` → instance path; `{$state}`/`{$bindState}`/`{$bindItem}` → state path; literal → template; `{$template}`/composites → resolved preview, **read-only**
  - display resolved data values (eliminates `[object Object]`; unresolvable values fall back to JSON text); header scope chip when instance-scoped: `item 3/6 · /images/2` (JSON-pointer base path of the picked item)
  - commit data edits via `setByPath(spec.state, path, value)` on a cloned spec → existing `commitRevision` pipeline (undo/redo free; revisions already deep-clone state)
  - literal props on an instance pick still edit the template (all instances) — the uniform rule
- **Structure tab note** when the picked element is inside a repeat: "Structure edits apply to all N items (shared template)" — ops stay functional
- i18n `en`/`es` for scope chip, structure note, read-only hint
- Tests: unit (pure resolution logic) + e2e (instance edit touches one item only)

### Out of scope

- Per-item override migration for literal props ("Override on this item": convert template literal to `$item` binding + initialize all state items) — phase 2, discussed 2026-10-05
- Detaching an instance from the repeat — kills repeat semantics (rejected 2026-10-05)
- Template↔Instance toggle UI (Figma-style) — layer later if needed (rejected 2026-10-05)
- Per-instance structure/DnD operations — structurally impossible without detach (descoped 2026-10-05)
- Editing `$template`/composite expressions — write target ambiguous; read-only v1 (descoped 2026-10-05)

## Design decisions

1. **Uniform write rule**: binding → data path, literal → template. Rejected: graying out literal props on instance picks (over-restrictive — `className` edits are usually meant globally); rejected: per-instance literal overrides in v1 (needs template+state migration op, phase 2).
2. **Index = DOM position + filter remap**, computed in our code. json-render exposes no index in the DOM (`data-jr-key` carries only the element key; `repeatIndex` lives in React context only — verified in dist). Rejected: DOM-order-only (silently edits the wrong item on filtered/kanban lists — the renderer's own `evaluateVisibility` makes remapping exact); rejected: patching/depending on renderer internals.
3. **Structure tab stays functional + explicit note** (Q3 option a). Rejected: disabling (blocks legitimate template edits); rejected: silence (today's "Remove on card 3 empties all 6 cards" trap).
4. **Commits reuse the revision pipeline**: data edits clone spec + `setByPath` → `commitRevision(entry, next, "property:…")`. Rejected: a separate state history (state is already snapshot with every revision; two histories would desync undo).
5. **Assumption**: element keys are placed at most once in the template tree (spec.elements is a tree; validation enforces orphan/missing checks) — so same-key wrappers within a repeat container map 1:1 to instances.

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build && bun run test:e2e` — all green: 0 lint errors, tsc clean, **101 unit** (25 new), build OK, **21 e2e** passed
- [x] Unit: binding analysis (template/data/readonly), filter remap (identity, filtered, out-of-range, nested `{$item}` paths), scope chip data, `chainForKey` breadcrumb filtering — `lib/editor/instance-path.test.ts` (25 tests)
- [x] E2E (`e2e/state.spec.ts`, 2 new tests): pick 3rd item → chip `item 3/6 · /items/2` → ring marks only Item C → bound `text` edit writes `items[2].label`, template prop stays `{$item}`, others untouched, undo restores, structure note visible; literal `className` edit hits all 6 + template prop only
- [x] MCP live (gallery entry, dev server): pick Metropolis heading → chip `item 3/6 · /images/2`, resolved value (no `[object Object]`), ring on card 3 only (`[data-jr-selected]` count 1, text = Metropolis) → edit `text` → DOM + `state.images[2].title` changed only, `item-title.props.text` still `{$item: "title"}`, rev `property:text` head 2 → Undo → restored, head 1; Structure tab shows "Structure edits apply to all 6 items (shared template)"

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-05 | plan drafted (after Q1/Q2/Q3 discussion: uniform rule, filter remap in, structure note) |
| 2026-10-05 | approved |
| 2026-10-05 | implemented — chain green (101 unit / 21 e2e), MCP live check passed (chip, correct-instance ring, data-path edit + undo, structure note) |
