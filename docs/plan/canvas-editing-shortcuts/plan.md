# Canvas Editing Shortcuts — Implementation Plan

**Status:** implemented
**Date:** 2026-10-08

## Goal

Make canvas editing direct: double-click any rendered element to jump straight into its editor (Pick + instance-scoped selection + EditPanel), and give the recurring editor actions single-keystroke shortcuts (mode toggles, delete, duplicate, move) so authoring does not round-trip through the tool rail and panel buttons.

## Scope

### In scope

- **Double-click to edit**: capture `dblclick` on the canvas container; resolve `closest("[data-jr-key]")` + `computeInstanceChain` (same path as pick-click) → enable Pick mode + select the instance + open EditPanel; `preventDefault` + `stopPropagation` so generated-UI dblclick effects never fire; works whenever a spec is on canvas (Pick off or on), no-op on the empty state / streaming / non-element targets
- **Keyboard shortcuts** (window `keydown`; ignored while typing in `INPUT`/`TEXTAREA`/`SELECT`/contentEditable — same guard as the existing Cmd+Z handler; ignored while streaming for mutating actions):

| Key | Action |
| --- | --- |
| `P` | toggle Pick |
| `X` | toggle X-ray |
| `G` | toggle Drag & drop |
| `Escape` | EditPanel close (exists) → else Pick off (cascade; panel's handler keeps precedence via `defaultPrevented`) |
| `Delete` / `Backspace` | remove selected element (undoable structural revision, same `handleRemove` path) |
| `Cmd/Ctrl+D` | duplicate selected (`handleDuplicate`; `preventDefault` — browser bookmark) |
| `Alt+↑` / `Alt+↓` | move selected sibling up/down (`handleMove`) |
| `Cmd+Z` / `Cmd+Shift+Z` | undo/redo (exists, unchanged) |

- Discoverability: ToolRail toggle tooltips gain the shortcut suffix (`(P)`, `(G)`, `(X)` — en/es parity via message updates) and `aria-keyshortcuts` attributes; removal/duplicate/move have no persistent chrome (panel buttons keep their labels)
- e2e regressions: dblclick opens the panel on a repeated instance (instance-scoped, not the first); `P`/`X`/`G` toggle; Delete removes + Cmd+Z restores; `Delete` ignored inside a focused input; Escape cascade (panel first, then Pick off)

### Out of scope

- Panel Actions-tab shortcuts (Bolder/Quieter/Polish/Colorize/Distill/Layout) — descoped 2026-10-08: user chose the app-actions set only
- Confirm dialog before Delete — descoped 2026-10-08: direct + undoable (matches the panel's Remove button)
- Customizable/keybinding configuration UI — descoped 2026-10-08: fixed scheme
- Arrow-key (non-modified) navigation between elements — descoped 2026-10-08: `Alt+arrows` only moves siblings; spatial focus navigation deferred
- On-canvas shortcut cheat-sheet / command palette — descoped 2026-10-08: tooltips only
- Double-click-to-edit on x-ray chips/dots (decorations are `pointer-events-none`) — descoped 2026-10-08: dblclick hits the element itself

## Design decisions

1. **dblclick lives in PickOverlay** — it already owns canvas hit-testing, `computeInstanceChain`, and the click capture listener; a new `onActivate` callback (invoked with key+chain) lets the Playground both select *and* `setPickMode(true)`, reusing `handlePick` for the chain-aware selection. Rejected: a separate overlay component, because listener registration order and chain logic would duplicate; rejected: handling dblclick in the generated-canvas React tree, because the Renderer owns that DOM
2. **Shortcuts in one Playground-level effect** — a single `keydown` listener next to the existing Cmd+Z handler (extended in place, not duplicated), calling the existing `handleRemove`/`handleDuplicate`/`handleMove`/toggle handlers; mode toggles are pure `setXMode` flips; Delete/Duplicate/Move guard on `effectiveKey` + `!isStreaming` + active entry. Rejected: per-component listeners, because scoping (inputs, streaming, panel precedence) would fragment; rejected: a global hotkeys library, because three keys and two chords do not justify the dependency
3. **Escape cascade order** — EditPanel's existing listener (registered when the panel is mounted) runs first and marks `defaultPrevented` while closing; the Playground listener only turns Pick off when the panel did not consume the key and no panel exit is in flight (`panelTarget || panelClosing` counts as "panel still open"). Rejected: moving Escape entirely into the Playground, because the panel's nested-layer `defaultPrevented` contract (component picker) must keep working
4. **Single-letter shortcuts never fire in text contexts** — the shared target guard (INPUT/TEXTAREA/SELECT/contentEditable) covers prompt bar, edit-panel fields, and the import dialog; letter keys also skip when a Radix layer has focus? No — Radix traps mark `defaultPrevented` for its own keys (Escape/arrows); letter keys in an open Select popover are safe because focus is not in an input and `P` while a popover is open is a rare enough edge to accept. Rejected: `event.composedPath()` layer sniffing, because it over-fits Radix internals
5. **`Cmd+D` and `Alt+arrows` require a selection; `P`/`X`/`G` do not** — toggles are global authoring affordances (like Cmd+Z's availability rules); mutating shortcuts no-op without `effectiveKey` or while streaming, exactly like the panel buttons they mirror

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build && bun run test:e2e` — all green; 202 unit / 618 assertions; **49 e2e** (43 baseline + 6 new)
- [x] e2e `e2e/shortcuts.spec.ts`: dblclick heading → panel + Pick armed; dblclick 3rd repeat instance → scope chip `3/6 · /items/2`; P/X/G toggles + letters ignored inside the prompt input; Delete removes + Cmd+Z restores (head/revision checks); Cmd+D duplicate then Alt+ArrowUp reorder (children-array checks); Escape cascade (panel first, Pick stays armed; second Escape disarms)
- [x] MCP spot-check (carousel restore, 8 repeated `product-name`): dblclick 3rd product → Pick armed, panel open, scope chip `elemento 3/8 · /products/2`, ring on the right instance; `X` toggled x-ray (35 chips → 0); Delete removed the instance + Cmd+Z restored; Escape cascade (panel out → Pick off); ToolRail titles `Seleccionar (P)` / `Rayos X (X)` / `Arrastrar y soltar (G)` + `aria-keyshortcuts` present
- [x] en/es parity: no new message keys (shortcut suffixes appended to existing labels, language-neutral); `aria-keyshortcuts` on all three toggles

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-08 | plan drafted (research: no dblclick anywhere; keyboard surface = Escape-in-panel + Cmd+Z; PickOverlay chain capture reusable) |
| 2026-10-08 | approved — three clarifying answers: dblclick always-on (auto-enables Pick), app-actions shortcut set (no panel Actions keys), Delete direct + undoable |
| 2026-10-08 | implemented — lint clean (0 warnings; keydown listener uses latest-value `shortcutsRef` pattern so it never re-subscribes), 49/49 e2e, MCP spot-check all green |
