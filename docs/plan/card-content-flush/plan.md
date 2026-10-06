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

- One static rule in `app/globals.css`: `.p-0`/`.px-0` card root →
  `padding-inline: 0` on its direct `card-content` child
- Live verification via MCP computed styles (p-0 cards → 0px; others keep 24px)

### Out of scope

- Catalog/`contentClassName` prop — rejected: json-render `Card` accepts only
  root `className`; package-level change (descoped 2026-10-05)
- Runtime arbitrary variant `[&>[data-slot=card-content]]:px-0` from specs —
  rejected: classes invented at runtime are not in the compiled stylesheet →
  silent no-op (descoped 2026-10-05)
- Changing json-render's `CardContent` base in `node_modules` — rejected:
  not our package, lost on install (descoped 2026-10-05)

## Design decisions

1. Scope rule to `.p-0 >`/`.px-0 > [data-slot="card-content"]` with
   class+attr specificity — beats `.px-6` regardless of CSS order; cards
   without `p-0` keep shadcn's default gutters. Rejected: blanket
   `[data-slot="card-content"] { padding-inline: 0 }`, because it would
   strip padding from every card in every generated app.

## Verification

- [x] `bun run format:check && bun run lint && bunx tsc --noEmit && bun run test`
- [x] `bun run build` → compiled CSS contains the rule
- [x] MCP on live gallery: p-0 item's `card-content` computed
      `padding-inline: 0px`; outer (non-p-0) card keeps `24px`

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-05 | plan drafted + approved (chat preview) |
| 2026-10-05 | implemented — chain green, build rule present, MCP computed styles verified |
