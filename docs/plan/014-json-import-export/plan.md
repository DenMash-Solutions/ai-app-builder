# JSON Import/Export — Implementation Plan

**Status:** implemented
**Date:** 2026-10-07

## Goal

Let users move UI specs in and out of the playground as raw JSON: **export** any history entry's spec (pretty-printed, incl. `state`) to the clipboard from its row with one click, and **import** a pasted spec through a dialog — the imported spec becomes a normal history entry so pick/steer/edits keep working. This unblocks sharing specs between sessions/browsers and manual patching without the API round-trip.

## Scope

### In scope

- **Import button in the history drawer footer** *(scope change 2026-10-07, user: "must be inside the history drawer")* — replaces the earlier ToolRail placement (see design decision 2); the History button in the top bar is already always visible (only its count badge is conditional), so the drawer is reachable on an empty canvas. **Refined same day**: the footer Export button was dropped as redundant — export lives on each row only (decision 2, decision 10)
- **Per-entry export**: every history row gets an export button (next to delete, same hover/focus reveal) copying **that entry's** spec; aria-label embeds the entry title (`"Export JSON: {title}"`) so multiple rows stay uniquely addressable
- Import dialog: shadcn Dialog + monospace textarea, Cancel/Import actions, inline validation error (dialog stays open, text preserved)
- **Textarea fixed-height and scrollable** (`h-64 field-sizing-none`) — never grows unbounded pasted specs *(scope change 2026-10-07)*
- Validation helper `parseSpecJson` (`lib/playground/json-io.ts`) — unit-tested: valid JSON, object, string `root`, `elements` object, `elements[root]` present, every element an object with string `type`
- Import commits a new history entry (`createEntry` + `addEntry` + activate), activates it, and closes the drawer — steer/pick/edits require `activeId`
- Shared serialization/copy primitives in `lib/playground/json-io.ts` (`serializeSpec`, `copySpecToClipboard`) — used by the per-row export
- `components/playground/json-import-button.tsx` — footer Import button + paste dialog + validation error, owns its i18n keys
- en/es parity for all new strings (`lib/i18n/locale/*.json`)
- e2e: drawer flow — open History → import dialog → invalid error → valid paste renders + history entry → per-row export copies the right JSON (incl. `state`); textarea scrollability; drawer stays open while the nested dialog is up

### Out of scope

- File download / file upload — user decision: clipboard copy + paste dialog only (2026-10-07)
- Merge/diff of imported spec with current — import replaces the view entirely (2026-10-07)
- Import into the active entry as a revision — imported JSON is its own entry, never a revision of another (2026-10-07)
- Export of revisions other than the head of an entry — per-row export mirrors that entry's stored spec; there is no export of superseded revisions (2026-10-07)
- Import/export buttons in the ToolRail — superseded by the history-drawer placement (scope change 2026-10-07); ToolRail reverted to its pre-feature state (always-gated on `displayedSpec && !isStreaming`, no json props)

## Design decisions

1. **Import creates a history entry** — rejected: transient `restoredSpec` render, because steer (`handleSteer`), pick-edit (`handleAction`), and structure edits all bail without `activeId`, leaving a half-functional canvas; rejected: appending a revision to the current entry, because pasted JSON is not a delta of it. Confirmed via question tool 2026-10-07
2. **Import button in the history drawer footer; export is per-row only** *(2026-10-07 scope change, user directive — supersedes the original "ToolRail above Clear" decision)* — import/export move specs in/out of the *history* store, so the drawer is their natural home; the canvas rail stays a canvas tool. **Footer Export dropped the same day as redundant**: `displayedSpec` always mirrors the active entry's stored spec (every edit path calls `updateEntry` + `setRestoredSpec` together), so a footer Export would copy the exact bytes of the active row's export button. Rejected: ToolRail placement (superseded); rejected: footer Export (duplicate path, user decision 2026-10-07)
3. **Export = pretty-printed full spec incl. `state`** — rejected: elements-only, because state-driven content (`repeat` over `$item`) re-imports to defaults without it. Confirmed via question tool 2026-10-07
4. **Validation lives in a pure lib function with object-based error constants** — rejected: parsing inside the component, because it must be unit-tested and the error keys cross i18n via a constant map (no string-literal conditionals)
5. **ToolRail visible when empty, disabled instead of hidden** — *(superseded 2026-10-07 by decision 2)* — the rail is back to its original `displayedSpec && !isStreaming` gate with no json props; the drawer (reachable via the always-visible History button) carries import
6. **Dialog state resets on open** — text and error clear each time the dialog opens, so a failed attempt never leaks stale content into the next session of the dialog
7. **Fixed-height scrollable textarea (`h-64 field-sizing-none`)** *(2026-10-07 scope change)* — rejected: the base `field-sizing-content` auto-grow (a pasted multi-KB spec expands the dialog without bound); fixed height + native scrollbar keeps the dialog stable. E2e pins height ≤ ~412px with overflow (`scrollHeight > clientHeight`)
8. **Literal braces in ICU messages are quote-escaped (`'{'`/`'}'`)** *(found during live verification)* — rejected: doubled `{{ }}` (still `MALFORMED_ARGUMENT` under next-intl), rejected: dropping the braces from the placeholder. next-intl logs `IntlError` + renders the key-path fallback in dev (no crash), so the e2e placeholder assertion (`constants.ts: JSON_IO.placeholder`, rendered form) is the regression guard — a parse failure makes it fail
9. **Clipboard prompts are a verification-env concern only** — Export calls `writeText` (no prompt on user click); the MCP permission dialog came from the test script's `readText()`. Playwright pre-grants `clipboard-read`/`clipboard-write` via `test.use({ permissions })`, so e2e never prompts
10. **Per-entry export names embed the title** — `aria-label = "Export JSON: {title}"` (next-interpolated) keeps every row's button uniquely addressable for tests and screen readers; same hover/focus reveal as the existing delete button

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build && bun run test:e2e` — all green (**166 unit / 33 e2e**, build OK)
- [x] Unit: `parseSpecJson` — invalid JSON, non-object, missing/rootless elements, valid round-trip incl. state block, element-without-type rejected (8 tests)
- [x] e2e (`e2e/json-io.spec.ts`): drawer flow — empty-drawer state; placeholder renders real braces (ICU regression guard); invalid JSON → inline error + preserved text + drawer stays open while the nested dialog is up; textarea fixed-height/scrollable for a big spec; valid spec closes dialog + drawer, renders heading, history entry (`prompt` = "Imported spec"); per-row export copies pretty JSON with root `page` incl. `state`
- [x] MCP manual *(drawer build, post scope changes)*: footer = **Import JSON only** (Close + Clear all; no Export);6 rows each expose unique `Export JSON: {title}` + `Delete entry`; nested dialog opens over the still-open drawer (Radix layer stack keeps the drawer's outside-click inert), textarea fixed at **256px** (`h-64`), placeholder renders real braces; trusted row-export clicks → clipboard 319 chars (`root: "page"`, pretty) then 6697 chars (`root: "main-container"`), toast lifetime measured **4204ms** via MutationObserver (sonner default), dev console clean; `readText()` now permitted without prompting
- [x] MCP manual *(ToolRail-era pass, superseded for placement by decision 2)*: dialog (title, description, placeholder, Cancel/Import/Close); invalid → error + preserved text; import of the captured 3.1-lite spec → renders, "Imported spec" entry saved, Pick/Steer enable (activeId set); export → clipboard readback; **caveat**: MCP `fill` does not fire React `onChange` on controlled textareas (trusted CDP keystrokes do) — Playwright e2e is the fidelity check for the fill path (see decision 9)

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-07 | plan drafted — preview shown, 3 scope questions answered via question tool (all recommended options) → approved |
| 2026-10-07 | implemented — chain green (166 unit / 33 e2e); live bug found & fixed during verification: ICU placeholder braces malformed → quote-escaped (decision 8), now e2e-pinned; MCP fill desync + clipboard permission prompt documented (decision 9, verification) |
| 2026-10-07 | **scope change (user)**: import/export moved into the history drawer, per-entry export added, textarea made scrollable → ToolRail reverted, plan decisions 2/5/7 updated (166 unit / 33 e2e re-verified) |
| 2026-10-07 | **scope change (user)**: footer Export dropped as redundant → `JsonIoButtons` → `JsonImportButton`, `exportJson` i18n key removed; e2e row locators anchored via new `entryRowName` helper (strict-mode collision with export aria-labels); chain green (**166 unit / 33 e2e**), MCP drawer pass recorded above |
