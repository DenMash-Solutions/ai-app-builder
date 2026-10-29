# Component Templates — Implementation Plan

**Status:** implemented
**Date:** 2026-10-28

## Goal

Build a **global, visitor-level component template library** (roadmap F14): the user
saves any selected element subtree as a named template, then inserts it anywhere —
same project or any other — from the editor's insert flow. Semantics are
**copy-expand + provenance** (decided 2026-10-27): inserting expands a full copy of
the saved subtree into the spec with fresh unique keys, and stamps `templateId` on
the expanded root so the origin stays discoverable; live-instance sync (edit a
template → update all inserts) is explicitly deferred to a later plan. json-render
has no composition primitive, so expansion happens entirely at our layer with key
prefixing/remapping.

## Scope

### In scope

- **Template store** — `lib/editor/templates.ts`, visitor-level, persisted in
  `localStorage` (same pattern as `lib/playground/device-preview.ts`: SSR-safe
  defaults, corrupt-value fallback). Template = `{ id, name, createdAt, subtree:
  { rootKey, elements } }` (an isolated mini-spec snapshot of the selection).
- **Save** — a "Save as template" row action in the structure tab (next to
  Duplicate, disabled for the root), name prompt dialog, snapshot of the selected
  subtree with its descendants.
- **Insert (copy-expand)** — `insertTemplate(spec, template, targetKey)` in
  `lib/editor/structure.ts` built on the `duplicateElement` key-remap machinery
  (`subtreeKeys` + `uniqueKeyFor`), placing a fresh-keyed copy under the chosen
  parent; root stamped with `props["data-template-id"] = template.id`.
- **Insert UI** — third picker mode `PICKER_MODES.templates` in
  `components/editor/component-picker.tsx` listing saved templates with the
  existing search/filter, wired in `structure-tab.tsx` like insert/group.
- **Library management** — rename and delete templates from the picker view;
  empty-state hint.
- **Provenance read-back** — `data-template-id` visible in the DOM/inspector and
  preserved by edit operations; documented in the picker tooltip/label where cheap.
- **i18n** — en/es keys for all new strings.
- **Tests** — unit (store persistence/fallback, key-remap uniqueness, provenance
  stamp, save/insert round trip) + e2e (save → insert → unique keys → stamp →
  survives reload → delete) + MCP spot-check per step.

### Out of scope

- **Live-instance sync** (editing a template updates existing inserts) — deferred;
  copy-expand keeps a migration runway (provenance stamp) per F14 decision
  (2026-10-27)
- **Project/namespace-scoped libraries** (per-project templates, sharing) — F14
  says visitor-level first, project namespace later (descoped 2026-10-28)
- **State binding merge on insert** (injecting referenced state paths into the
  target project) — see design decision 3; revisit after first use (descoped
  2026-10-28)
- **Multi-select save** — the editor has no multi-selection; save granularity is a
  single element subtree (same scope as Duplicate) (descoped 2026-10-28)
- **Template editing UI** (editing the saved subtree inside the library) — save
  comes from the canvas only (descoped 2026-10-28)
- **Server-side/supabase persistence & cross-device sync** — visitor-local per F14
  (descoped 2026-10-28)

## Design decisions

1. **Copy-expand at our layer with `duplicateElement`'s key remap** — save an
   isolated `{ rootKey, elements }` mini-spec, remap every key through
   `uniqueKeyFor` on insert. — rejected: json-render composition/reference
   primitives (they don't exist — no `include`/`ref` in the schema), because
   expansion must be a plain spec mutation the existing editor understands.
2. **Provenance lives in `props["data-template-id"]` on the expanded root** —
   `UIElement` is a closed interface (`type/props/children/slots/visible/on/
   repeat/watch`, no index signature), so a top-level `templateId` field would be
   a type violation; `data-*` props are valid DOM attributes and pass through
   renderers without unknown-prop warnings, and `props` is the only open
   (`Record<string, unknown>`) slot. — rejected: top-level element field (type
   error + renderer may strip), because `props` is the sanctioned extension point.
3. **State bindings are copied verbatim** — a template that references `/todos`
   inserts those references unchanged; if the target project has no such path the
   binding simply doesn't resolve (json-render treats missing paths as empty).
   — rejected: auto-merging referenced state via `collectStatePointers`, because
   guessing initial values for a foreign project's state is wrong more often than
   helpful; revisit with real usage (descoped 2026-10-28).
4. **Library UI reuses `ComponentPicker` as a third mode** — the picker is already
   a pure, injected catalog view with search; a `templates` mode adds template
   rows (+ rename/delete affordances) with zero new dialog infrastructure. —
   rejected: a separate library dialog, because it duplicates search/filter/
   open-close plumbing for the same interaction shape.
5. **Store shape mirrors `device-preview.ts`** — module-level store with
   SSR-safe read (`typeof window` guard), `localStorage` persistence under one
   key, corrupt-value fallback to defaults. — rejected: zustand/React context,
   because templates are read/written by two unrelated panels and need no
   reactivity contract beyond a simple subscribe/refresh.
6. **Save captures an isolated mini-spec, not live references** — the snapshot
   detaches at save time; later edits to the original never affect the template.
   — rejected: storing key paths into the source spec, because the source project
   may change or be deleted.

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test` — all
      green at step 3: format/lint/tsc clean, **748 unit** (6 + 5 + 0 new)
- [x] Unit: store persistence (write → read → corrupt-value fallback), subtree
      snapshot isolation, key remap produces no collisions with existing spec
      keys, `data-template-id` stamped exactly on the expanded root, save/insert
      round trip preserves structure (children/slots/visible/on/repeat/watch) —
      `lib/editor/templates.test.ts` (6) + `insertTemplate` block in
      `lib/editor/structure.test.ts` (5, incl. `validateSpec`-clean expansion
      with slots/repeat preserved)
- [x] e2e: select an element → save as template → insert it into a different
      container → expanded keys are unique, structure matches the source, root
      carries `data-template-id`; insert the same template twice → two independent
      copies (editing one does not affect the other); reload → library survives
      (localStorage), delete → row disappears and insert is no longer offered —
      `e2e/templates.spec.ts` (2 tests)
- [x] e2e: existing suite stays green — **127/127** (125 pre-existing + 2 new),
      insert/group flows untouched
- [x] MCP spot-check per step: save a real selection from the structure tab,
      insert via the Templates picker mode, screenshot proving the copy landed with
      provenance attr; rename + delete in the live UI; console clean — steps 1–3
      each spot-checked (see status log); step 3 also verified the empty-state
      hint renders on first delete and after reopening, and the spec stayed
      untouched by library writes
- [x] i18n: en/es key sets identical for all new strings — 298 keys each, zero
      diffs (13 template-related keys)
- [x] No `progress.md` — plan.md + INDEX.md only (user call 2026-10-28)

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-28 | plan drafted (Step 0: lessons grepped, json-render skill loaded, F14 re-read, `structure.ts`/`component-picker`/`device-preview` patterns mapped) |
| 2026-10-28 | approved — clarifications answered per recommendation: state bindings copied verbatim (decision 3), save = structure-tab row action + insert = third picker mode (decision 4), library scope = save/insert/rename/delete |
| 2026-10-28 | **step 1 implemented + MCP-tested** — `lib/editor/templates.ts` visitor-level store (SSR-safe hydration, sanitizer drops junk entries, corrupt-JSON fallback, quota best-effort), `saveTemplate` snapshots the subtree detached via `subtreeKeys` + `structuredClone`, structure-tab **Save as template** row action (disabled for root) + `save-template-dialog.tsx` name prompt, `subtreeKeys` exported from `structure.ts`, en/es keys (6, identical); unit **743/743** (6 new — note: hydration test needed a cache-busted import because another test file loads `lib/editor/templates` via the `@/lib/editor` barrel first), full e2e **125/125**, MCP spot-check: saved a leaf (`pokemon-name`) and a container (`pokemon-card` → 8-element subtree) in the live UI, both persisted to `genui-component-templates`, dialog closed, console clean (only pre-existing a11y issues) |
| 2026-10-28 | **step 2 implemented + MCP-tested** — `insertTemplate` in `structure.ts` (copy-expand: `subtreeKeys` traversal of the detached snapshot, `uniqueKeyFor` key remap shared with `duplicateElement`, `data-template-id` stamped on the expanded root ONLY, optional clamped index, null guards), `PICKER_MODES.templates` third mode in `ComponentPicker` (two typed row memos — a union array defeats narrowing; element-count chip via ICU plural, empty-state hint), structure-tab **Templates** button + live library subscription, `onInsertTemplate` wired through EditPanel → playground (`structure:insert:<name>` revision), `TemplateSubtree` type moved to `structure.ts` (no import cycle), en/es keys (5); unit **748/748** (5 new insertTemplate tests incl. validateSpec-clean expansion, independent double-insert, root-only stamp, index clamp, guards), full e2e **125/125**, MCP spot-check: picker lists 2 templates with counts, search filters, insert into `pokemon-card` → 27→35 elements, **0 key collisions**, exactly one stamp matching the template id, appended, revision `structure:insert:Pokemon card block`, REPEAT marker preserved; post-refactor picker re-verified (rows + filter + close), console clean |
| 2026-10-29 | **step 3 implemented + MCP-tested — feature complete** — `ComponentPicker` templates rows gained inline rename (Pencil → input with `draft ?? template.name`, Enter commits trimmed value, Escape cancels) + direct delete (Trash2, no confirm — matches the structure-tab Remove pattern); `onRenameTemplate`/`onDeleteTemplate` wired from the structure tab to `renameTemplate`/`removeTemplate`; en/es keys (4). **Escape-in-rename bug found + fixed**: React `event.stopPropagation()` cannot stop Radix — its Escape handler is registered **capture-phase on `document`** (runs before React's input handler) and React's synthetic `stopPropagation` doesn't reach it, so the whole dialog closed instead of cancelling the rename; fixed with `onEscapeKeyDown` on `DialogContent` calling `event.preventDefault()` while a rename is active (Radix honors `defaultPrevented`). New `e2e/templates.spec.ts` (2 tests): save → insert ×2 → level-edit independence → reload persistence; rename Enter/Escape → delete → empty hint → spec untouched. Gates: format/lint/tsc green, unit **748/748**, e2e **127/127** (125 + 2). MCP spot-check: rename Enter commits live (`Renamed live`), Escape cancels without touching the library, 2nd Escape closes the picker, delete removes the row + empties the library while the spec stays `structure:remove`/27 keys, empty-state hint visible on first delete and after reopening (a11y snapshot prunes non-option `listbox` children — DOM probe is ground truth), library restored afterwards (both templates rehydrate on reload) |
