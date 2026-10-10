# X-Ray Overlay Priority — Implementation Plan

**Status:** implemented
**Date:** 2026-10-10

## Goal

X-ray chips/markers and the pick selection/scope rings render in a stage overlay at `z-10`, which loses to the playground chrome (TopBar / ToolRail / PromptBar at `z-20`), so labels near the top of the canvas paint **under** the navbar (verified live: `main-layout` chip top 58 vs header bottom 60, header `z-index: 20` vs overlay `10`). Separately, with Pick armed + X-ray on, hovering an element shows both the hover-revealed x-ray chip and the picker's HoverBadge — two labels for the same item. Fix the stacking (decorations above all canvas chrome) and let the picker badge own the hovered label while picking.

## Scope

### In scope

- `components/editor/xray-labels.tsx` — overlay `z-10` → `z-[1000]`; hover-revealed chips suppressed while `interactive` (pick armed); permanent chips (containers + quiet leaves), dots/markers, hover outline unchanged
- `components/editor/pick-overlay.tsx` — overlay `z-10` → `z-[1000]`
- `components/editor/hover-badge.tsx` — `z-50` → `z-[1001]` so the picker label is never covered by the now-higher x-ray chips (today the badge wins against `z-10` overlays; bumping overlays alone would regress it)
- `components/playground/prompt-bar.tsx` — `z-20` → `z-[1002]` so the prompt input and its scope/mention chips stay above the x-ray markers (user request 2026-10-10, follow-up to the overlay bump)
- `components/playground/playground.tsx` — `isolate` on the stage div so the `z-1000` is scoped to the stage: decorations beat all canvas chrome, while HistoryDrawer / FailureDialog (`z-50`, siblings of the stage) still open above them
- `e2e/prompt-scope.spec.ts` — "x-ray chips pick and scope like the canvas" retargeted from the `state-item` hover chip (gone while pick is armed) to the permanent repeat-container chips (`state-list`, 6 instances); asserts hover shows no x-ray chip while pick is armed

### Out of scope

- Removing chip click-to-pick — permanent chips stay clickable (interactive path kept); repeat Text leaves are picked via canvas while pick is armed (descoped 2026-10-10, per user: picker owns the hovered label)
- Bumping the CanvasDnd drag badge (`z-50`) — dnd + xray overlap is rare and cosmetic (descoped 2026-10-10)

## Design decisions

1. **`isolate` on the stage instead of a bare `z-1000` in the root stacking context** — rejected: bare `z-1000`, because neither `main` nor the stage create a stacking context, so the overlays would paint above the HistoryDrawer/FailureDialog backdrops (`z-50`); isolate gives "above chrome, below dialogs" without coupling overlay z-values to the dialog layer
2. **Reuse `interactive` to suppress hover chips, no new prop** — rejected: a separate `showHoverChips` prop, because the host already gates `interactive` on pick mode, which is exactly when HoverBadge is on — one prop, one meaning ("pick armed")
3. **Retarget the chip e2e to a repeat container chip** — rejected: keeping `state-item` (Text leaf, hover-only chip), because hover chips intentionally no longer render while pick is armed; `state-list` is a repeated Stack with a permanent chip per instance, so instance-scoped shift+click still gets exercised

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test` — clean; **225 unit / 662 assertions**
- [x] `bunx playwright test` — **61/61 e2e**; chip test retargeted to a new `STATEFUL_ROWS_UI_LINES` fixture (renderer repeats the repeated element's children, not the element itself — the shared `STATEFUL` fixture has a single `state-list` wrapper, so it cannot carry per-instance permanent chips)
- [x] MCP live on `/es/ui/c8c7cdcb-…`: overlay `z-index: 1000` vs header `20` with `isolation: isolate` on the stage — `main-layout` chip (top 58, header bottom 60) paints above the navbar; pick+xray hover → badge `Heading · hero-title · 672×180`, no hover chip, dot stays; pick off → hover chip returns (`pointer-events: none`)

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-10 | plan drafted (MCP repro: chip under navbar; user: hide hovered x-ray label while picking) |
| 2026-10-10 | approved (user confirmed "hide current xray hovered item label, just show the picker label one") |
| 2026-10-10 | implemented — z-[1000] overlays + stage isolate + badge z-[1001] + hover-chip suppression while pick armed; 225/662 unit, 61/61 e2e, live MCP stacking/hover verified |
| 2026-10-10 | scope +: prompt bar `z-20` → `z-[1002]` (user: "prompt input must be over the xray markers"); MCP verified input readable above chips; 225/662 unit, 61/61 e2e re-run green |
