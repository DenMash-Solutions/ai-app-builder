# Prop List Inputs (className/style) — Implementation Plan

**Status:** implemented
**Date:** 2026-10-06

## Goal

The element editor's `className` and `style` properties are edited as free-text blobs — `className` as one whitespace-separated string, `style` as `prop: value; prop: value` text — which is error-prone (typos in separators, no per-entry removal, invisible structure). Replace both with structured list editors: `className` becomes a list of class tokens, `style` becomes a list of property/value rows, each supporting add / edit / remove, while keeping the existing patch, undo/redo, and draft-commit semantics.

## Scope

### In scope

- `className` → token list: one class per row (text input + × remove), `+ Add class` appends a focused empty row; split on `/\s+/` (normalizes whitespace), join with single spaces; paste containing spaces splits into multiple tokens on commit; empty list commits `""`
- `style` → key/value row list: `[property | value | ×]` rows in insertion order, `+ Add property` appends a focused row; empty value row dropped on blur; all rows removed → `null` (existing empty semantics); value keeps `PURE_NUMBER` coercion (`"100"` → `100`); keys pass through `toCamelCase` (kebab → camel, `--custom` untouched); duplicate keys → last row wins (object semantics)
- Commit timing: row text commits on blur/Enter; add/remove commit immediately (pending row drafts are folded in first); no per-keystroke patches *(user-confirmed 2026-10-06)*
- Draft discipline: row inputs are controlled with `draft ?? fromProps` precedence (lesson `controlled-input-drafts.md`), drafts live in the list component
- `PropField` gains `variant?: "classNameTokens" | "stylePairs"` set in `buildFields` via an object-based constant map keyed by prop name (only `className` and `style` — other string/record props keep today's controls)
- Pure helpers in `lib/editor` with unit tests: `class-tokens.ts` (`toClassTokens`, `joinClassTokens`) and additions to `style-text.ts` (`styleRecordToRows`, `rowsToStyleRecord`)
- New components `components/editor/class-token-list.tsx` + `components/editor/style-prop-list.tsx` (kebab-case)
- **shadcn-first rule** *(user-directed 2026-10-06)*: use shadcn components as the first option; raw elements only when no shadcn component is a better fit (e.g. the full-width dashed add button may stay raw if no variant fits)
- **Legacy control migration in the same pass** *(user-confirmed 2026-10-06)*: the existing raw text/number inputs, enum `<select>`, and boolean `<checkbox>` in `PropertyForm` are swapped to shadcn `Input` / `Select` / `Checkbox` (installing `select` + `checkbox` via the shadcn CLI)
- **Dark-island scoping for all panel components** *(user-directed 2026-10-06)*: the editor drawer is a fixed-dark island — a `dark` class on the panel root scopes token vars (and the `dark` Tailwind variant) for everything inline; portaled popups (`SelectContent`, `ComboboxContent`) get their own `dark` class because portals render outside the panel subtree (lesson `mcp-verification.md`)
- **Full-width fields for non-list props** *(user-directed 2026-10-06)*: label above, control below spanning the panel width (`w-full`) for string/number/record inputs and the enum `Select`; boolean checkbox stays intrinsic-size, left-aligned under its label
- **`className`/`style` sections wrapped in shadcn `Collapsible`** *(user-directed 2026-10-06)*: each list editor sits inside a `Collapsible`, **collapsed by default** with a trigger showing the prop name + a value summary *(user-confirmed 2026-10-06)*
- i18n keys added to **both** `en.json` and `es.json` (add buttons + row remove aria-labels with `{name}` param, key/value placeholders, collapsible summaries)
- **shadcn `Combobox` autocomplete** *(user-directed 2026-10-06, replaces native `<datalist>`)*: class-token row inputs and style-key row inputs become Comboboxes with free-entry typing + filtered suggestion dropdown; suggestion sources unchanged — classes already used anywhere in the current spec ∪ curated `COMMON_TAILWIND_CLASSES`, curated `COMMON_STYLE_KEYS` for style keys (both via `lib/editor/suggestions.ts`)
- `docs/plan/prop-list-inputs/plan.md` (this file)

### Out of scope

- Native `<datalist>` autocomplete — superseded by shadcn `Combobox` per user direction (descoped 2026-10-06)
- Drag / keyboard reordering of rows — YAGNI; insertion order + remove/re-add covers current needs (descoped 2026-10-06)
- Tailwind autocomplete as originally scoped (custom filtered popup with keyboard nav, positioning, a11y) — the shadcn `Combobox` in scope above covers this; no bespoke popup component (descoped 2026-10-06)
- Per-style-property **value** hints (e.g. `display → flex/grid/…`) — per-property value domains are a rabbit hole; datalist covers keys only (descoped 2026-10-06)
- Converting other string props (e.g. `alt`, `src`) to token lists — only `className` is a list by nature (descoped 2026-10-06)
- Live per-keystroke patch commits — would spam the undo stack; blur/Enter + explicit add/remove only *(user-confirmed 2026-10-06)*
- Fixing pre-existing stale-draft vs external prop updates (undo while editing keeps winning draft) — unchanged behavior, out of this feature's scope (descoped 2026-10-06)
- Keeping a free-text fallback editor for `className`/`style` alongside the lists — one editing mode per prop (descoped 2026-10-06)

## Design decisions

1. **List UI keyed by prop name via `variant` on `PropField`** — rejected: switching on `field.kind` alone, because `className` shares `kind: string` with every other string prop and `style` could collide with future record props; rejected: special-casing names inside `PropertyForm` render logic, because field metadata belongs where fields are built (`buildFields`) and must stay object-constant-based (no string literals)
2. **Two small components instead of one generic list** — rejected: a single configurable `list-field.tsx`, because token rows (one string) and style rows (key+value) have different commit/parsing rules; over-abstracting now would obscure both (KISS)
3. **Helpers in `lib/editor` with unit tests** — rejected: splitting/joining inside components, because parsing is business logic already covered by `style-text.test.ts` conventions and needs edge-case tests (whitespace, numbers, `--custom`, duplicates)
4. **Commit on blur/Enter + immediate structural actions** — rejected: per-keystroke commits, because each commit buffers a patch (undo/redo noise + validation overhead from `78210e6`); matches the existing draft pattern the form already uses
5. **Rows derived from props, overridden by drafts (`draft ?? fromProps`)** — rejected: mirroring rows into props on every keystroke, because props are the patch-committed source of truth and the `controlled-input-drafts` lesson forbids the inverse precedence
6. **Duplicate style keys resolve last-wins on commit** — rejected: blocking duplicates with validation UI, because records inherently dedupe and an error state for a transient intermediate edit adds complexity without data loss (later row wins deterministically)
7. **shadcn `Combobox` for autocomplete** *(user-directed 2026-10-06, revised from native `<datalist>`)*: proper filtered dropdown with keyboard nav + consistent styling; supports free-entry typing so custom classes outside the suggestion set still work — rejected: native `<datalist>` (initially chosen for zero-dependency simplicity), because its browser-rendered popup is unstyled/inconsistent and the user directed shadcn-first; rejected: spec-only suggestions, because early edits on a sparse spec would show nothing; rejected: per-property value hints, because value domains vary wildly per CSS property (out of scope)
8. **shadcn `Collapsible` wraps each list section** *(user-directed 2026-10-06)*: `className`/`style` lists are secondary, potentially long editors — hiding them behind a collapsible trigger (prop name + value summary) keeps the property panel compact — rejected: always-expanded rows (initial implementation), because it pushes primary props (text, level) out of view
9. **shadcn components before raw elements** *(user-directed 2026-10-06, standing rule)*: row inputs → shadcn `Input`, section wrappers → `Collapsible`, autocomplete → `Combobox`; raw elements only where no shadcn component fits better — rejected: keeping raw `CONTROL_CLASS` inputs for visual consistency with the legacy form fields, because project direction is shadcn-first
10. **`.dark` class scopes the island, including portals** *(user-directed 2026-10-06)*: `dark` on the panel root covers all inline content; portaled `SelectContent`/`ComboboxContent` each carry their own `dark` class, since Radix/Base UI portals render at `document.body` and would otherwise resolve light-theme vars — rejected: hardcoding zinc colors inside shadcn components, because the `dark` class is the established pattern (lesson `mcp-verification.md`) and keeps components token-driven

## Verification

- [x] Unit: `lib/editor/class-tokens.test.ts` (empty/multi-space/paste-split/join round-trip) + `style-text.test.ts` additions (rows round-trip, number coercion, kebab→camel, `--custom` passthrough, duplicate keys, empty → `null`) + `lib/editor/suggestions.test.ts` (spec classes ∪ curated, dedupe/sort, null spec)
- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build && bun run test:e2e` — all green (136 unit / 29 e2e, baselines grew with this feature's new tests)
- [x] e2e (editor.spec): expand the className `Collapsible` → add token → present in canvas `class`; remove → gone; expand style `Collapsible` → add row (`opacity` + `0.5`) → `toHaveCSS`; remove row → gone — `editor.spec.ts:65` "className and style are edited as structured add/edit/remove lists" passes
- [x] MCP: add/edit/remove flows verified live on both lists — typing opens+filters the Combobox (6/4/1 matches), Enter commits (spec + canvas + revision), mouse-pick commits immediately, remove reverts spec + DOM, style flow `opacity`/`0.5` → inline `opacity: 0.5` on canvas; screenshots of collapsed/expanded triggers with value summaries, filtered dropdown, style row, and light-theme shots (panel + portaled Select/Combobox popups stay dark); i18n keys present in en + es; two MCP-found bugs fixed en route — focus-after-add targeted Base UI's injected hidden input (now `data-slot="input-group-control"`), and Escape cleared the row via `onValueChange(null)` (now null ignored + `inputValue` controlled + drafts only accept `input-change` reasons)

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-06 | plan drafted (preview shown to user, awaiting approval) |
| 2026-10-06 | approved — blur/Enter commit timing confirmed; lightweight datalist autocomplete added to scope per user question |
| 2026-10-06 | scope revised per user — shadcn-first standing rule; datalist → shadcn Combobox; className/style sections wrapped in shadcn Collapsible — re-approval pending |
| 2026-10-06 | re-approved — Collapsibles collapsed by default; legacy raw controls migrated to shadcn in the same pass |
| 2026-10-06 | scope revised per user — `.dark` scoping added for panel root + portaled Select/Combobox popups (fixed-dark island) |
| 2026-10-06 | scope revised per user — non-list fields laid out full-width (label above, control below) |
| 2026-10-06 | implemented — chain green (136 unit / 29 e2e, build ✓); MCP verification complete incl. light-theme portal darkness; focus-after-add + Escape-clear bugs found via MCP and fixed (`data-slot` focus target, controlled `inputValue`, `input-change`-only drafts) |
