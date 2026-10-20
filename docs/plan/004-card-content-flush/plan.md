# Card Content Flush (`p-0` on Card) — Implementation Plan

**Status:** implemented
**Date:** 2026-10-05

## Goal

A generated spec sets `className: "... p-0 ..."` on a `Card` (`gallery-item`),
but the card still shows 24px gutters. The root padding *is* zeroed
(tailwind-merge drops base `py-6`); the visible inset comes from
json-render's internal `data-slot="card-content"` wrapper, which hard-codes
`px-6` (`cn("px-6", className)`) and is unreachable from the spec's
root-only `className`. Make spec-level `p-0`/`px-0` on a Card also flush that
wrapper.

## Scope

### In scope

- One static rule in `app/globals.css`: an explicit horizontal root padding
  on a Card (`p-*`/`px-*`, safelist tokens 0–16) → `padding-inline: 0` on its
  direct `card-content` child, so root and content padding never stack
  (generalized 2026-10-06 after `p-1` review: rule originally keyed on
  `p-0`/`px-0` only, which left `p-1` = 4px root + 24px content = 29px inset)
- Live verification via MCP computed styles (p-1 items → content 0px;
  cards without explicit root padding keep 24px)

### Out of scope

- Catalog/`contentClassName` prop — rejected: json-render `Card` accepts only
  root `className`; package-level change (descoped 2026-10-05)
- Runtime arbitrary variant `[&>[data-slot=card-content]]:px-0` from specs —
  rejected: classes invented at runtime are not in the compiled stylesheet →
  silent no-op (descoped 2026-10-05)
- Changing json-render's `CardContent` base in `node_modules` — rejected:
  not our package, lost on install (descoped 2026-10-05)

## Design decisions

1. Scope rule to explicit horizontal root padding only —
   `:is([class^="p-"], [class*=" p-"], [class^="px-"], [class*=" px-"]) >
   [data-slot="card-content"]` — space-delimited token-prefix match covering
   every safelined `p-*`/`px-*` value in one line (class+attr specificity
   beats `.px-6` regardless of CSS order); cards with no root `p-*`/`px-*`
   keep shadcn's default gutters, and `py-*`/`pt-*` alone don't suppress (no
   horizontal intent). Rejected: blanket
   `[data-slot="card-content"] { padding-inline: 0 }`, because it would strip
   padding from every card in every generated app (2026-10-06).
2. Token-prefix match rather than enumerating the 22 safelist values —
   rejected: verbose, and dropped values like `p-0.5`; rejected
   `[class*="p-"]` substring — also matches inside `gap-4`
   (2026-10-06). Registry-level `Card` override (clone `CardContent` with
   `px-0` from JS) considered instead — rejected: touches the render
   pipeline for a styling concern (2026-10-06).

## Verification

- [x] `bun run format:check && bun run lint && bunx tsc --noEmit && bun run test`
- [x] `bun run build` → compiled CSS contains the `:is([class~="p-0"]…)` rule
- [x] MCP on live gallery: `p-1` items → root 4px, `card-content` computed
      `padding-inline: 0px` (screenshots: images flush, titles untruncated);
      `gallery-root` (no root `p-*`) keeps `24px`

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-05 | plan drafted + approved (chat preview) |
| 2026-10-05 | implemented (p-0/px-0 scope) — chain green, MCP verified |
| 2026-10-06 | generalized to all safelisted `p-*`/`px-*` root tokens after live `p-1` review (scope updated same turn) — chain green, build rule present, MCP computed styles + screenshot verified |
