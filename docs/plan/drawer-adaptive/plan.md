# Drawer Adaptive — Implementation Plan

**Status:** implemented
**Date:** 2026-10-08

## Goal

Move the editor drawer's desktop threshold from `sm` (640px) to `md` (768px), keeping the JS hook (`useIsDesktopDrawer`) and the CSS flex switch (`<main>` row direction) in lockstep — the invariant the original edit-panel-drawer plan pinned (decision 3: JS and CSS must never disagree). On mobile, the bottom sheet currently caps at `80vh` and only supports swipe-down dismiss; make it adapt to the screen (`dvh` units, so mobile URL-bar collapse doesn't clip it) and add a swipe-up gesture that grows it to full screen, with swipe-down collapsing back — full-screen sheets are the standard mobile pattern for long property forms.

## Scope

### In scope

- `components/editor/edit-panel.tsx` — `useIsDesktopDrawer` queries `(min-width: 768px)` (extracted `DESKTOP_QUERY` const); mobile sheet: `max-h-[80dvh]` content-hugging default (kept per user clarification 2026-10-08: the expand action is what grows it), `h-[100dvh]` full-screen when expanded; expand/collapse animates height via WAAPI (250ms, same layout-driven approach as enter/exit; inline `max-height` neutralized during the animation so the cap cannot clamp the full-screen start frame); touch handlers: swipe-up (>80px, from scrollTop 0) expands, swipe-down collapses when expanded / dismisses when not; mobile-only expand/collapse toggle button in the header (chevron up/down, next to close); expanded resets when the breakpoint flips to desktop (reset lives in the matchMedia subscription callback — `react-hooks/set-state-in-effect`)
- `lib/i18n/locale/{en,es}.json` — `editor.sheet.expand` / `editor.sheet.collapse` (parity)
- `e2e/constants.ts` — `EDITOR.expandSheet` / `EDITOR.collapseSheet`
- `app/[locale]/page.tsx` — `<main>` `sm:flex-row` → `md:flex-row`
- `e2e/helpers.ts` — `swipeVertical(page, selector, fromY, toY)` helper (constructed TouchEvents)
- `e2e/editor.spec.ts` — two tests: (1) md threshold — pick at 700px → bottom sheet + `main` column; resize 800px → docked 448px + `main` row + expand button absent; (2) mobile sheet — 375px, default height content-hugging (settled < the 560px cap), expand button grows to full screen and collapses back, swipe-up grows, swipe-down collapses, swipe-down dismisses

### Out of scope

- Panel width (448px) and desktop dock behavior — unchanged (descoped 2026-10-08)
- Overlaying full-screen sheet above the stage — expansion still *pushes* (stage shrinks to 0 via flex), consistent with the push-not-overlay requirement (descoped 2026-10-08)
- Other `sm:` usages (e.g. dialog footer) — unrelated components (descoped 2026-10-08)

## Design decisions

1. **md (768px) on both sides** — rejected: CSS-only change (swipe handler needs the axis from JS); rejected: JS-only change (flex line would still switch at 640px, JS and CSS disagree in the 640–767px band).
2. **Swipe gestures reuse the existing 80px threshold and scrollTop-0 guard** — same feel as dismiss; rejected: separate threshold per direction, because inconsistent gestures read as bugs.
3. **Expanded = `h-[100dvh]`, default = content height capped at `max-h-[80dvh]`** — user clarification 2026-10-08: the default stays content-hugging; the expand action is what grows the sheet, so a short form should not fill the screen on its own. `dvh` so the full-screen target tracks the live viewport (URL-bar collapse). (An earlier same-day revision to a fixed `h-[80dvh]` fill was reverted here.)
4. **Expand/collapse animates height with WAAPI (250ms)** — same layout-driven approach as enter/exit: the class switches instantly and keyframes interpolate from the captured pre-toggle height to the new `offsetHeight`. Inline `max-height: none` during the animation prevents the 80dvh cap from clamping the full-screen start frame on collapse. Rejected: CSS transitions, because the from-state is `auto` (content height), which CSS cannot interpolate.
5. **Safelist untouched** — `{sm:,md:,lg:,xl:}flex-row` already force-compiled; new arbitrary classes (`h-[100dvh]`, `max-h-[80dvh]`) come from source scan of edit-panel.tsx.
6. **Mobile-only expand button in the sheet header** (chevron up/down beside close, i18n-labeled) — added 2026-10-08 after the gesture shipped, so full-screen growth is discoverable and accessible without a swipe; rendered only when `!isDesktop` so the docked drawer keeps its existing header.

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build && bun run test:e2e`
- [x] New e2e: 700px → sheet + column main; 800px → docked + row main
- [x] New e2e: 375px expand button + swipe up → full screen; swipe down → default; swipe down → closed
- [x] Manual MCP: content-hugging default (340px at 724 viewport), expand/collapse animates (9 intermediate frames each way, no clamp jump), 885px emulation → docked 448 flush right + row main + no expand button

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-08 | plan drafted (md threshold preview) |
| 2026-10-08 | approved with scope addition: mobile sheet adapts to screen + swipe up/down full-screen expand |
| 2026-10-08 | scope addition: mobile-only expand/collapse button in the sheet header (user ask) |
| 2026-10-08 | scope revision: default height reverted to content-hugging `max-h-[80dvh]` (user: the expand action is what grows it); expand/collapse now animates via WAAPI |
| 2026-10-08 | implemented — chain green (202 unit / 618, build ok, 38 e2e); live MCP: 340px content default, animated expand/collapse (no clamp jump), 885px docked 448 + row |
