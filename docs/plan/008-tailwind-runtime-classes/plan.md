# Tailwind Runtime Classes — Implementation Plan

**Status:** implemented
**Date:** 2026-10-06

## Goal

Spec `className` values only ever exist at runtime (model output, localStorage history, edit-panel input) — Tailwind v4's source scan never sees them, so any utility not also written in repo source silently no-ops. The gallery experiment proved it: `gemini-3.1-flash-lite` emitted `h-48 h-64 object-cover bg-gradient-to-t from-black/80 to-transparent bg-white/20 backdrop-blur-sm bottom-0 w-fit text-white/80` and **11 of 11 were missing** from the compiled CSS, producing a broken render (image not covering, no scrim, white-on-white text). This feature extends the project's existing `@source inline(...)` coverage (the v4 safelist replacement, already used in `app/globals.css`) so model-favored utilities actually render.

## Scope

### In scope

- `app/globals.css`: extend inline-source coverage with the observed gaps + high-probability model favorites:
  - heights: `h-{40,48,56,64,72,80,96}`
  - object-fit: `object-{cover,contain,fill,none,scale-down}`
  - insets: `top-0 bottom-0 left-0 right-0` (explicit, regardless of source-scan accidents)
  - sizing: `w-fit`, `min-h-{40,64,80}`
  - alpha colors: `text-white/{50,60,70,80,90}`, `text-black/{40,50,60,70}`, `bg-white/{10,20,30,40,50,60,70,80,90}`, `bg-black/{30,40,50,60,70,80}`
  - blur: `backdrop-blur-{xs,sm,md,lg}`
  - gradients: `bg-gradient-to-{t,b,l,r}` (verified: installed Tailwind 4.3.3 rewrites `bg-gradient-to-*` → `bg-linear-to-*` compat in `node_modules/tailwindcss/dist/lib.mjs`), plus `from-{black,white}/{50,60,70,80,90}`, `via-transparent`, `to-transparent`
- New e2e spec `e2e/runtime-classes.spec.ts`: `page.evaluate` probe-div asserting every targeted class computes its effect (regression guard for the whole set)

### Out of scope

- Runtime "unknown class" warning in the edit panel — useful but separate UX feature (descoped 2026-10-06, needs its own plan)
- Changing `STYLING_RULES` / teaching the model v4-only names — unnecessary while the v3-style gradient alias compiles; revisit if model output drifts (descoped 2026-10-06)
- Arbitrary/动态 classes (`h-[23px]`, `bg-[url(...)]`) — cannot be enumerated; out of coverage by design (descoped 2026-10-06)

## Design decisions

1. Extend the existing `@source inline(...)` list (same pattern as `app/globals.css:10-13`) — rejected: per-class `@utility` hand-aliases (duplicates definitions, drifts from real utilities), because inline generates the canonical rule with zero maintenance
2. Probe-div e2e over CSS-text grepping — rejected: grep of built `.next` CSS (brittle path/structure), because computed-style probes assert what users actually see
3. Explicitly list insets/`w-fit` even if some currently pass via source scan — because spec-only usage must not depend on incidental source usage

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build && bun run test:e2e`
- [x] New e2e: every class in the target set computes as expected on a probe div (catches future Tailwind renames)
- [x] MCP spot-check (live probe: h-64 → 256px, object-cover → cover): manually set `photo-image` style back to class form (`h-64 object-cover`) in the live gallery and confirm computed `height: 256px` / `object-fit: cover`

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-06 | plan drafted |
| 2026-10-06 | approved |
| 2026-10-06 | implemented — chain green: format/lint/tsc, 103 unit, build, 26 e2e (incl. new runtime-classes probe) |
