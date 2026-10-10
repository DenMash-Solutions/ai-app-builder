# Prompt Bar Mention Chips — Implementation Plan

**Status:** implemented
**Date:** 2026-10-08

## Goal

Restyle the prompt-scope chips like x-ray chips (mono, family-colored, `key · Type` labels), turn the prompt input into an auto-growing textarea (Enter submits, Shift+Enter inserts a newline), and let the user reference in-scope chips inside the text by typing `@` — an autocomplete over the **current scope chips** inserts a `@key` token that renders as a family-colored chip via a mirror overlay behind the textarea.

## Scope

### In scope

- **Scope chip row** (`prompt-bar.tsx`): replace the emerald Badge with the x-ray chip look (`rounded-md border bg-zinc-950/95 px-1.5 py-0.5 font-mono text-[10px] leading-3 text-zinc-200 shadow-sm` + family border color); label becomes `{key} · {type}` with the existing instance/template suffix (`product-card · Card 2/8`, `product-image · Image ×8`); still removable (click chip → remove from scope), still streaming-disabled
- **Family colors shared**: extract `TYPE_FAMILIES`/`DEFAULT_FAMILY` from `xray-labels.tsx` into `components/editor/type-families.ts`; both overlays import it
- **Textarea** (`prompt-bar.tsx`): `Textarea` (shadcn, exists) named `prompt`; auto-grow on input to `scrollHeight`, capped at `max-h-32` (~8 lines) then internal scroll; `KeyDown`: Enter (no shift, no IME composing) submits; Shift+Enter falls through to newline
- **`@` autocomplete**: while the caret sits in an `@query` token (regex on text before caret: `(?:^|\s)@([\w-]*)$`), a listbox opens above the input listing **scope chips only** whose key starts with the query (case-insensitive; empty query lists all). Rows show the mini `key · Type` chip. ↑/↓ navigate, Enter/Tab select, Esc closes; click selects. Selecting replaces the partial token with `@key` and places the caret after it. No scope → no dropdown
- **Mirror overlay**: absolutely-positioned `aria-hidden` div behind the textarea with identical font/padding/wrap metrics; renders the text with `@key` runs (matching a scoped key) as inline family-colored chip spans; textarea text is transparent with a visible caret; mirror scroll-synced. Selection/IME/undo stay native
- **Mentions do not mutate scope** — pure text references to already-scoped chips (per user decision); sent prompt carries the `@key` text as-is alongside the existing scope wrapper
- **Instance-indexed tokens** (scope added 2026-10-10): instance chips insert `@key#N` (1-based instance index, e.g. `@product-image#2`) so two scoped instances of the same key produce distinguishable tokens the model can map back to the listed "instance N of M"; template chips keep plain `@key`; autocomplete query `key#N` filters by index; mirror renders the full token
- **i18n** (en/es): chip label templates gain `{key}`; new `playground.mentionList` aria-label for the dropdown
- **Unit tests**: `lib/playground/mention-token.ts` — `findActiveMention(text, caret)` + `insertMention(text, mention, key)` pure functions with tests
- **e2e**: `SCOPE.chip/chipAll` helpers take key+type; textarea Shift+Enter inserts newline without sending; Enter submits; `@` dropdown lists scoped chips, selection inserts `@key`, mirror chip span renders with the family class

### Out of scope

- "Full card size" / image-covers-card — example-prompt content, not a UI feature (clarified 2026-10-08)
- `@` autocomplete over unscoped spec keys — user chose scope-only sources (descoped 2026-10-08)
- Mentions adding/removing scope targets — scope stays click/drawer-driven (descoped 2026-10-08)
- contenteditable real inline chips — textarea+mirror keeps native selection/IME (descoped 2026-10-08)

## Design decisions

1. **Textarea + mirror overlay for token styling** — rejected: contenteditable, because caret-across-chips, IME, and paste handling are disproportionately fragile for a POC; the mirror technique keeps the textarea fully native
2. **`@` sources from scope chips only** — rejected: all-spec-keys autocomplete, because the user explicitly wants `@` as shorthand for chips already in scope ("instead of typing the full key")
3. **Family colors reused via extracted `type-families.ts`** — rejected: duplicating the map in prompt-bar, because DRY and future family tweaks stay in one place
4. **Instance tokens carry `#N` suffix** — rejected: plain `@key` for instances, because the prompt wrapper lists targets as "instance 2 of 8" while identical `@key` mentions cannot be attributed to a listed target (found in live prompt 2026-10-10); rejected: full state path in the token (`@key@/products/1`), because it's noisy for the model and the index already matches the wrapper's "instance N"

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build && bun run test:e2e` — **218/653 unit, 61 e2e**
- [x] e2e: chip row shows `key · Type` x-ray styling; Shift+Enter → newline in textarea, no generate request; Enter → submit; `@` + scoped key → dropdown row, Enter inserts `@token`, mirror span has family border class; existing prompt-scope tests updated to new label format and green
- [x] MCP (live, skincare carousel): shift+alt+click scoped `product-name-overlay · Heading ×8` chip; `@` → dropdown lists the scoped option; Enter → textarea `mejora @product-name-overlay`, mirror span `@product-name-overlay` with `bg-zinc-400/20 outline-sky-500/60`; Shift+Enter → `\n`, textarea grew to 64px; Enter submitted (`POST /api/generate` 200)

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-08 | plan drafted — clarified: "full card size" was example-prompt text; mentions = scope-only shorthand; family colors; textarea+mirror |
| 2026-10-08 | approved |
| 2026-10-08 | implemented — 218/653 unit, 61/61 e2e; MCP spot-check passed (chip label, `@` autocomplete, mirror token, textarea expansion, Enter submit) |
| 2026-10-10 | scope+1: instance tokens carry `#N` — live prompt showed two identical `@product-image` tokens, unmappable to "instance 2/3" |
