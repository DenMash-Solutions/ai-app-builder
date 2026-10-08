# Drawer Adaptive — Implementation Plan

**Status:** approved
**Date:** 2026-10-08

## Goal

Move the editor drawer's desktop threshold from `sm` (640px) to `md` (768px), keeping the JS hook (`useIsDesktopDrawer`) and the CSS flex switch (`<main>` row direction) in lockstep — the invariant the original edit-panel-drawer plan pinned (decision 3: JS and CSS must never disagree). On mobile, the bottom sheet currently caps at `80vh` and only supports swipe-down dismiss; make it adapt to the screen (`dvh` units, so mobile URL-bar collapse doesn't clip it) and add a swipe-up gesture that grows it to full screen, with swipe-down collapsing back — full-screen sheets are the standard mobile pattern for long property forms.

## Scope

### In scope

- `components/editor/edit-panel.tsx` — `useIsDesktopDrawer` queries `(min-width: 768px)` (extracted `DESKTOP_QUERY` const); mobile sheet: `max-h-[80dvh]` default, `h-[100dvh]` full-screen when expanded; touch handlers: swipe-up (>80px, from scrollTop 0) expands, swipe-down collapses when expanded / dismisses when not; expanded resets when the breakpoint flips to desktop
- `app/[locale]/page.tsx` — `<main>` `sm:flex-row` → `md:flex-row`
- `e2e/helpers.ts` — `swipeVertical(page, selector, fromY, toY)` helper (constructed TouchEvents)
- `e2e/editor.spec.ts` — two tests: (1) md threshold — pick at 700px → bottom sheet + `main` column; resize 800px → docked 448px + `main` row; (2) mobile sheet — 375px, default height ≈ 80dvh, swipe-up → full height, swipe-down → back, swipe-down → closed

### Out of scope

- Panel width (448px) and desktop dock behavior — unchanged (descoped 2026-10-08)
- Visible drag-handle affordance / chevron button — gesture-only per user ask (descoped 2026-10-08)
- Overlaying full-screen sheet above the stage — expansion still *pushes* (stage shrinks to 0 via flex), consistent with the push-not-overlay requirement (descoped 2026-10-08)
- Other `sm:` usages (e.g. dialog footer) — unrelated components (descoped 2026-10-08)

## Design decisions

1. **md (768px) on both sides** — rejected: CSS-only change (swipe handler needs the axis from JS); rejected: JS-only change (flex line would still switch at 640px, JS and CSS disagree in the 640–767px band).
2. **Swipe gestures reuse the existing 80px threshold and scrollTop-0 guard** — same feel as dismiss; rejected: separate threshold per direction, because inconsistent gestures read as bugs.
3. **Expanded = `h-[100dvh]`, default = `max-h-[80dvh]`** — `dvh` so the sheet tracks the live viewport (URL-bar collapse); rejected: percentage heights, because the flex parent's height chain makes `vh`/`dvh` the reliable full-screen unit here.
4. **Expansion is state, not a WAAPI concern** — enter/exit animations keep animating `offsetHeight` (live value), so an expanded sheet exits from full height with no extra code.
5. **Safelist untouched** — `{sm:,md:,lg:,xl:}flex-row` already force-compiled; new arbitrary classes (`h-[100dvh]`, `max-h-[80dvh]`) come from source scan of edit-panel.tsx.

## Verification

- [ ] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build && bun run test:e2e`
- [ ] New e2e: 700px → sheet + column main; 800px → docked + row main
- [ ] New e2e: 375px swipe up → full screen; swipe down → default; swipe down → closed
- [ ] Manual MCP: 700/800px threshold, swipe up/down at 375 via dispatched touch events

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-08 | plan drafted (md threshold preview) |
| 2026-10-08 | approved with scope addition: mobile sheet adapts to screen + swipe up/down full-screen expand |
