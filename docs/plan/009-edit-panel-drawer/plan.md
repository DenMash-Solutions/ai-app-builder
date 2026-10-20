# Edit Panel Drawer — Implementation Plan

**Status:** implemented
**Date:** 2026-10-06

## Goal

The editor's EditPanel currently renders as an absolutely-positioned floating panel anchored next to the picked element (`panelPos` + resize tracking). Replace it with a docked side sheet: **right edge on desktop** (≥640px, 448px wide) and a **bottom sheet on mobile** (<640px, full width, max 80vh with swipe-dismiss). The panel must **push** the view instead of overlaying it (user requirement 2026-10-06): on desktop the stage (top bar, tool rail, canvas, prompt bar) shrinks and shifts left; on mobile the stage shrinks upward so the bottom chrome — especially the **prompt input** — moves above the sheet and stays visible/usable.

## Scope

### In scope

- `components/editor/edit-panel.tsx`: hand-rolled non-modal dock (`role="dialog"`, no Radix Dialog)
  - flex-flow layout: desktop `h-full w-[448px] border-l`, mobile `max-h-[80vh] w-full rounded-t-xl border-t`; live direction via existing `matchMedia("(min-width: 640px)")` hook (drives class branch + swipe gating)
  - close paths: X (existing `onClose`), Escape (window listener, skipped when a nested layer already handled the key via `event.defaultPrevented`), swipe-down on the mobile sheet (touch handler gated on body `scrollTop === 0`), pick-toggle-off → all funnel to `beginPanelClose()` (sets `panelClosing`, keeps the selection alive) → `clearSelection()` runs only in `onExited` after the out animation; canvas Clear / history switch stay instant closes
  - content fills the panel (`flex-col`), tab bodies get `min-h-0 flex-1 overflow-y-auto`
  - keep `data-editor-panel`, `aria-label`, dark zinc-950 island styling (theme-safe, per `mcp-verification` lesson); no shell `key` (persists across re-picks), `key={elementKey}` on `PropertyForm`/`StructureTab`/`ActionTiles` resets element-scoped state
  - **enter/out animation**: both directions via **WAAPI box resize** (mirrored fix, 2026-10-06) — enter: grow from `0` (or the exit's recorded in-flight size after a reopen mid-exit) to the measured size; exit: collapse to `0` with `fill: forwards`; mobile animates `height`, desktop `width`, 200ms, exit easing `cubic-bezier(0.4,0,1,1)`, enter easing `cubic-bezier(0,0,0.2,1)`; the stage resizes frame-by-frame with the box (no mount-time jump, no end-of-exit jump); `data-state="open|closed"`; exit completion via `animation.finished` (exited-guarded) + 300ms timeout fallback → `onExited()`; no-WAAPI environments open/close instantly
- `app/[locale]/page.tsx`:
  - remove `panelPos` state, `updatePanelPos`, resize listener, `PANEL_WIDTH`, and the `position` prop
  - **exit lifecycle**: close is *delayed*, not the unmount — `panelClosing` widens visibility (`pickMode || panelClosing`) so the panel keeps rendering from **live props** during the exit animation; `onExited={clearSelection}` performs the real close; `handlePick`/`handleSelectKey` reset `panelClosing` (reopen mid-exit cancels the exit); render-phase reset when `panelTarget` goes null mid-exit (stream/clear) so the flag cannot stick
  - **push layout**: `main` becomes `flex flex-col sm:flex-row`; TopBar/ToolRail/canvas/PromptBar move into a `relative min-h-0 min-w-0 flex-1` **stage** wrapper; `EditPanel` becomes its flex sibling → desktop: stage shrinks left of the 448px dock (rail/prompt/top-bar stay reachable); mobile: stage shrinks upward (prompt bar rides above the sheet)
- e2e: disambiguate `getByRole("dialog")` picker locators → `page.locator("[data-component-picker]")` (panel is also `role=dialog` — strict-mode collisions in insert/group flows)
- new e2e: desktop → docked right (bbox flush to viewport right, full height); mobile 375×700 → flush bottom, full width; re-pick while open swaps content without closing; Escape closes
- MCP spot-check both breakpoints + light theme

### Out of scope

- ComponentPicker (insert/group) stays a centered dialog — user chose EditPanel only (2026-10-06)
- Modal scrim / outside-click-to-close — user chose no overlay; outside click must not close (2026-10-06)
- Widths other than 448px desktop — user chose `max-w-md` (2026-10-06)
- Restyling the panel for light theme — keep the dark island look (visual parity)

## Design decisions

1. **Push layout via flex siblings** (amended 2026-10-06, user requirement) — `main` is `flex-col sm:flex-row`, stage + panel are siblings; rejected: overlay (`fixed`/`absolute` panel), because it covered the tool rail (`absolute right-4 top-1/2` — proven by e2e interception failure), the top-bar right cluster, and the prompt bar's right edge; rejected: manual `margin`/`right-inset` offsets on an overlay, because the prompt bar is centered (`left-1/2 max-w-2xl`) and cannot be rescued by a gutter
2. Non-modal by construction (plain `role="dialog"` div, no focus trap, no `aria-hidden` of siblings) — rejected: `ui/drawer.tsx` (vaul) with `modal={false}`: **vaul 1.1.2 (latest) never forwards `modal` to Radix `Dialog.Root`** (verified in `node_modules/vaul/dist/index.mjs`), so Radix takes the modal path — `hideOthers(content)` aria-hides `<main>` while the panel is open (proven: role-locators for the Pick rail button stopped resolving) and the focus scope would trap Tab/click-focus inside the panel, making the prompt input unusable; rejected: patching/undoing Radix side-effects post-hoc, because the focus trap has no prop opt-out
3. Responsive direction through the existing `matchMedia` state hook — used for the class branch + swipe gating; rejected: pure CSS switching, because the swipe handler needs to know the axis; the flex breakpoint itself is CSS (`sm:flex-row` / `sm:` panel classes share the 640px threshold, so JS and CSS never disagree)
4. Panel shell has no `key` and persists across re-picks; `key={elementKey}` on `PropertyForm`/`StructureTab`/`ActionTiles` — rejected: `key={effectiveKey}` on `EditPanel` (original implementation), because remounting the shell replays the slide-in on every re-pick, so the drawer visibly reopens (user-reported); the shell key originally existed to reset `PropertyForm` drafts (`controlled-input-drafts` lesson) — reset semantics are preserved by keying only the stateful children, while the slide-in now runs only on open
5. Desktop dock width `w-[448px]` (user-chosen `max-w-md` size) as a fixed flex basis; mobile sheet `max-h-[80vh]` with the stage taking `flex-1` — rejected: fixed-height sheet (`h-[60vh]`), because content-sized + clamp keeps small sheets compact and lets the body scroll for long Structure tabs
6. Outside click never closes (no overlay listener at all) — rejected: outside-click-closes, because every re-pick would unmount/remount-bounce the panel; Escape honors `event.defaultPrevented` so a nested ComponentPicker dialog consumes the key first
7. **Out animation via delayed close** (user requirement 2026-10-06): instead of keeping a prop *stash* alive after close, keep the *selection* alive — `beginPanelClose()` sets `panelClosing`, visibility widens to `(pickMode || panelClosing)`, the panel renders live props with `closing`, and `onExited` runs the real `clearSelection()` — rejected: stashed-props unmount delay (first attempt), because value-guarded render-phase stash still looped when `displayedSpec` identity churned per render → e2e crash "This page couldn't load"; rejected: shadcn/vaul `Drawer` ("has enter/out by default"), because vaul content is a **fixed portal overlay** (breaks the push-layout requirement) and forces modal side effects (decision 2); rejected: EditPanel-internal two-phase close, because it only covers panel-initiated closes — pick-toggle would still pop instantly; rejected: framer-motion, a new runtime dep for what ~30 lines of native CSS + one flag covers
   **Amended 2026-10-06 (close-flicker fix, user-reported):** the transform exit (`animate-out slide-out-to-*`) was replaced by a **WAAPI box collapse** (mobile `height: content → 0`, desktop `width: 448px → 0`, 200ms, `cubic-bezier(0.4,0,1,1)`, `fill: forwards`, `animation.finished` → `onExited`) because frame-sampling the mobile close measured three artifacts: the layout box stayed put while the sheet slid (blank strip grew above it, stage frozen), the transform released ~1 frame before unmount (sheet **snapped back into view**), and the stage/prompt **jumped +262px in a single frame** at unmount; the collapse runs on the flex line so the stage grows every frame and the box is already `0` at unmount — rejected: keeping the transform exit and animating the stage separately, because two animations must be kept in lockstep by hand; rejected: CSS `height: auto → 0` transition, because `auto` is not interpolable (WAAPI reads the concrete size at close time instead). **Amended again the same day (open-flicker, user-reported after the close fix):** the enter CSS transform (`animate-in slide-in-from-*`) had the mirror defect — the panel mounted at full layout size (stage snapped up in one frame) while only the sheet visuals slid — so enter now **grows the box** back (`0 → measured`, or the exit-cleanup-recorded size when reopening mid-exit, ease-out `cubic-bezier(0,0,0.2,1)`); rejected: keeping transform enter plus a manual stage-height animation, because same lockstep problem as the exit; rejected: mounting the panel collapsed (CSS) and growing via class toggle, because `auto`-based sizes are not animatable and the measured WAAPI path reuses the exit's capture point

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build && bun run test:e2e` — all green (118 unit, 28/28 e2e)
- [x] New e2e: desktop right-dock + mobile bottom-dock + re-pick-without-close + Escape close
- [x] Existing editor/state e2e green after picker-locator disambiguation (incl. drag test — rail clickable while panel open)
- [x] Re-pick fix re-check (MCP): shell persists across re-pick (same element, no animation replay), content + instance scope swap in place (item 1/6 → 2/6), close→reopen runs `enter` animation once (5s probe), test edit undone via Undo
- [x] MCP spot-check: desktop push measured (panel x=832..1280, rail right=809, prompt right=752, `main` not aria-hidden), mobile sheet 375×262 with prompt bottom=414 above sheet y=438, light-theme island screenshot, re-pick swaps content (count stays 1), outside click keeps panel, swipe-down dismiss, Escape closes (pick stays armed), structure-tab scroll container verified

- [x] Out-animation verification: chain green (118 unit, 28/28 e2e) + MCP probes — desktop Escape: `exit` running `animate-out slide-out-to-right` t=17→206ms, gone t=218, pick armed; pick-toggle-off: same exit, pick disarmed; mobile: `animate-out slide-out-to-bottom` t=22→211, gone; reopen mid-exit: exit canceled → `enter:running`, panel never unmounted; stale `selected` reading was a same-evaluate commit race (fresh read = 0) — *(transform exit since replaced by box resize)*
- [x] Box-resize animation verification (mirrored fix): chain green (118 unit, 28/28 e2e) + MCP frame samples — mobile open: panel 1→262, stage 699→438, prompt 675→414 stepwise over ~180ms, no mount flash, no jump at completion; mobile reopen mid-exit: collapse 262→209 → grow resumes **from 209** (recorded size, no snap) → 262 monotonic; desktop open: width 1→448, stage right 1279→832 frame-locked every sample; desktop close: width 448→1, `finished` t=214, unmount settles stage right 1279→1280 (1px)

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-06 | plan drafted |
| 2026-10-06 | approved |
| 2026-10-06 | amended: push layout (stage flex sibling) + hand-rolled dock replacing vaul (vaul 1.1.2 never forwards `modal` to Radix → `hideOthers`/focus-trap break the non-modal requirement); user: mobile must push view up so bottom chrome/prompt stay visible, desktop must push left |
| 2026-10-06 | implemented — chain green (118 unit, 28/28 e2e) + MCP spot-check both breakpoints |
| 2026-10-06 | re-pick fix: EditPanel shell persists (slide-in only on open); element state reset via inner `key={elementKey}` (user-reported reopen on re-pick) |
| 2026-10-06 | out animation: delayed close (`panelClosing` keeps selection alive → live props during exit, `onExited` → `clearSelection`) on X/Escape/swipe/pick-toggle; shadcn Drawer rejected — fixed portal overlay vs push layout, modal side effects; first stash attempt crashed (spec identity churn → render loop) |
| 2026-10-06 | close-flicker fix (user-reported): transform exit replaced by WAAPI box collapse (height/width → 0) — frame sampling showed blank strip during slide, snap-back at animation end, single-frame stage jump at unmount |
| 2026-10-06 | open-flicker fix (user-reported after close fix): mirrored — enter replaced by WAAPI box grow (0 → measured / recorded in-flight size), CSS `animate-in`/`slide-in-*` classes dropped |
