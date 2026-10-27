# Component States — See & Edit Conditional Components — Implementation Plan

**Status:** implemented
**Date:** 2026-10-26

## Goal

Conditional and state-driven elements (`visible`, `watch`, `repeat`, state-bound props)
are first-class spec citizens but invisible to the editor: in the Pokedex, the loading
state component (`dex-loading`) cannot be viewed or edited — it never renders (query not
`loading`), it carries no badge in Structure, and the Properties tab has no condition
editor. This feature gives the playground a **States tab** in the edit panel: discover
which elements are conditional, inspect live state values, force-preview hidden
components by overriding state, and edit the `visible` conditions themselves.

## Context (researched 2026-10-26)

- `demo/pokedex-keyed-spec.json`: 19 elements, 7 state-driven — `dex-loading`,
  `dex-error`, `dex-empty` (`visible` on `/queries/pokedexList/status`),
  `dex-prev`/`dex-next` (`visible` on `/page`, `hasNext`), `dex-grid`/`dex-types`
  (`repeat`), `dex-root` (`watch`)
- Editor (`components/editor/`): tabs = properties / structure / actions; **no handling
  of `visible`/`watch`/state paths anywhere** (grep-verified)
- Hidden elements render nothing → absent from DOM → unpickable (`PickOverlay` /
  `HoverBadge` / `instance-dom` are DOM-driven)
- Canvas state: `canvasState` (`playground.tsx:576`) = `spec.state` + `mergeI18n` +
  locale + `urlSync` overlay; `QueryLoader` mirrors query status into
  `/queries/<name>/status` live; `JSONUIProvider` owns runtime state + visibility
- json-render skill loaded: `visible` forms (eq/neq/gt/gte/lt/lte/not, `$or`, arrays),
  `watch` top-level, `useIsVisible`, state JSON Pointers — all documented API

## Scope

### In scope (user answers 2026-10-26: all four recommended options)

1. **Discovery badges** — Structure tab rows (and the pick hover badge) mark elements
   carrying `visible` / `watch` / `repeat` so state-driven components are findable
2. **State inspector** (States tab) — live list of state paths + current runtime values
   (`/queries/pokedexList/status = "success"`, `/page = 0`), read from the provider's
   runtime state. Rows are split into **two independent accordions** — "Used by this
   element" (open by default) and "Other state" (collapsed) — so relevance is
   structural, not color-only (refinement 2026-10-27, user suggestion)
3. **State override / force-preview** — edit a state value in the inspector → the real
   `VisibilityProvider` re-evaluates → hidden conditional elements render authentically
   and become pickable/editable. Overrides are **session-only** (runtime state, never
   written into `spec.state`). **UX refinement 2026-10-27**: `…/status` paths edit
   through a select of `QUERY_STATUSES` (idle/loading/success/error — object constants
   from `lib/data-sources/types.ts`); all other paths keep the free-text input
4. **Condition editing** — structured form for the selected element's `visible`:
   state-path field (with suggestions from known paths) + operator dropdown
   (`eq, neq, gt, gte, lt, lte, truthy, not`) + value; supports the single-condition
   form, the array/AND form (Pokedex `dex-empty` = 2 conditions), and — **scope
   addition 2026-10-27**, discovered on the user's real spec — the explicit
   `{ $and: [...] }` wrapper, which round-trips back to the same wrapper so an
   unchanged condition is never rewritten
5. **`watch` read-only display** — the States tab lists an element's `watch` keys
   (editing watch action lists stays out of scope)

### Out of scope

- Editing `watch` action lists — display only; action editing already lives in the
  Actions tab (descoped 2026-10-26, keeps this plan focused on `visible` + state)
- Ghost mode (rendering hidden elements regardless of condition) — rejected 2026-10-26;
  state override exercises the real condition instead
- Raw-JSON condition editing — rejected 2026-10-26 (structured form covers all
  conditions in the Pokedex + repo specs; revisit if a spec needs `$or`-complexity)
- State-store architecture changes (`JSONUIProvider` / `QueryLoader` internals)
- Published/live pages — editor-only feature (`spec-page`/`live-page`/`preview-client`
  untouched)
- Editing `repeat` / `watch` target structures themselves

## Design decisions

1. **State override, not ghost mode** — rejected: rendering hidden elements
   unconditionally — override runs the real `VisibilityProvider` logic, so the preview
   is exactly what a user would see; it also needs no render-path changes. Rejected:
   both (scope), ghost-only (doesn't exercise conditions)
2. **States as a 4th edit-panel tab** — rejected: canvas-chrome drawer (new layout
   region to manage on mobile bottom-sheet) and top-bar popover (too little room for a
   path/value list); the tab pattern already exists (`PANEL_TAB_ORDER`, i18n label keys)
   and opens contextually: element selected → its condition/watch; nothing selected →
   the global state inspector
3. **Overrides live in runtime provider state, not the spec** — `JSONUIProvider`'s
   `onStateChange` already diffs runtime state without touching stored spec
   (`playground.tsx:1476` comment proves this is the sanctioned path); a session-only
   "Reset overrides" affordance restores mirror/query-driven values
4. **Structured condition form with array support** — covers every `visible` form the
   repo contains (single comparison + AND-array); form ↔ spec serialization is
   round-trip-tested; invalid states are prevented by construction (dropdown operators,
   path suggestions from `spec.state` + `/queries/*` + `urlSync` keys)
5. **Badges derive from the spec, not the DOM** — Structure is already spec-driven
   (`spec.elements[childKey]`), so `visible`/`watch`/`repeat` markers need no render
   hooks; pick-hover badge adds the same marker for canvas-first workflows
6. **Kebab-case, feature-colocated files** — new editor components live under
   `components/editor/` beside their siblings; object constants for operators/badge
   kinds; i18n keys under `editor.states.*` (en/es)
7. **The container is data, not decoration (added 2026-10-27)** — parse returns
   `container: "single" | "array" | "and"` and serialization reproduces it, so the
   real spec's `$and` wrapper survives an edit byte-identical (rejected: always
   emitting the plain array — would silently rewrite the user's spec on the first
   unrelated edit; rejected: keeping `$and` read-only — it is the shape their
   `empty-state` actually uses). Rejected alternatives for out-of-scope shapes
   (`$or`, `$item`/`$index`, negated comparisons, multiple operators,
   non-primitive operands) remain a read-only `<pre data-condition-raw>` block.
8. **Operand type hints, with one escape hatch** — a parsed operand pins its kind
   (`string`/`number`/`boolean`) so unchanged text round-trips byte-exact
   (`"123"` never becomes `123`), **except** an empty string (`eq: ""`), which is
   the placeholder an operator switch commits: it parses as `auto` (still
   round-tripping to `""`) so a subsequent `true`/`123` the user types coerces
   instead of committing as text. Rejected: pinning `eq: ""` to `string` — it made
   `truthy → eq → "true"` write a string that can never match a boolean state.

## Implementation steps (each keeps lint/tsc/tests green)

1. **Discovery**: badge helpers + Structure-tab markers + pick-hover marker
   (object-based constants for the 3 kinds), i18n strings, unit tests
2. **States tab shell**: register the 4th panel tab (order, labels, contextual
   empty/selected states), read-only state-path list from runtime state
3. **State override**: editable value per path → provider state (session-only) +
   "Reset overrides"; verify `dex-loading` renders on the Pokedex after setting
   `status = "loading"`
4. **Condition editor**: structured form bound to the selected element's `visible`
   (path + operator + value, array = row list), serialization round-trip, apply to spec
5. **Watch display**: read-only `watch` keys in the States tab for the selected element
6. **Verification**: full gate chain + targeted e2e + MCP spot-check

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test`
      — all green; unit **728 pass / 0 fail** (+27 over step 3)
- [x] Unit: condition form ↔ `visible` serialization round-trip (single + array +
      `$and` wrapper), badge-kind derivation, override seeding (session-only —
      `spec.state` unchanged), operator constants coverage, `replaceVisible`
      immutability
- [x] e2e (stateful fixture, `e2e/states-tab.spec.ts`): Structure shows
      `state-greeting` with the `visible` badge → States tab → override
      `/revealed = true` → greeting renders → pick it → edit `variant` → reset
      override → greeting hides again; `spec.state` byte-identical before/after
      (head 0 → 1 from the prop edit only). Second test: `truthy → eq` → type
      `true` → spec reads `{ $state: "/revealed", eq: true }` → undo ×2 restores
      the original condition (head back to 0)
- [x] e2e: existing 112 stay green — full suite **114/114 passed (50.7s)**
- [x] MCP spot-check (real spec, live browser): `loading-state` Structure row
      carries `data-marker="visible"`; status override
      `/queries/pokemonList/status = loading` rendered "Loading Pokémon…" on the
      canvas (verdict hidden → shown, row marked overridden, "Reset 1 override");
      reset closed the gate again (grid back, verdict hidden) with `spec.state`,
      condition, head (0) and revision count (3) untouched. Screenshot captured.
- [x] i18n: en/es strings present for every new key (`editor.states.*`)

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-26 | plan drafted (draft) — research done (editor grep, Pokedex spec analysis, json-render skill loaded) |
| 2026-10-26 | 4 clarifying questions answered: all 4 layers, structured form, States tab, state override; scope/out-of-scope/design decisions finalized |
| 2026-10-26 | plan **approved** — commit plan, then implement step by step |
| 2026-10-27 | step 1 (discovery badges) `6afec70`, step 2 (States tab shell) `cd5216e`, step 3 (override + status select) `7c3f843` |
| 2026-10-27 | **scope addition** — the real spec's `empty-state` uses the `{ $and: [...] }` wrapper: parse/serialize carry `container` so it round-trips (decision 7); `eq: ""` parses untyped so `truthy → eq` commits are coercible (decision 8) |
| 2026-10-27 | plan **implemented** — verification: format/lint/tsc ✓, unit 728/0, e2e 114/114 (50.7s), MCP spot-check on the real spec ✓ |
| 2026-10-27 | bugfix: status + operator `<Select>` triggers rendered a plain span instead of `<SelectValue>`, so Radix's item-aligned positioning never ran (popup at viewport 0,0) — both now render `SelectValue`; re-verified in browser + gates (unit 728/0, e2e 114/114) |
