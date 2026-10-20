# Aspect Ratio Suggestions — Implementation Plan

**Status:** implemented
**Date:** 2026-10-08

## Goal

The className combobox suggests almost no aspect-ratio utilities: `COMMON_TAILWIND_CLASSES` ships exactly one (`aspect-video`) and the spec currently contributes none, so typing "aspect" yields a single option or "No matches" — even though the compiled stylesheet pre-forces six working aspect tokens. Worse, the model prompt (`STYLING_RULES`) recommends `aspect-portrait`, which does **not** exist in this Tailwind v4 build (live probe: computed `aspect-ratio` stays `auto` despite the `@source inline` listing), steering both the model and manual edits toward a silent no-op class. Add the live-verified aspect tokens to the suggestion set, correct the model advice, and remove the dead `portrait` inline entry.

## Scope

### In scope

- `lib/editor/suggestions.ts` — add to `COMMON_TAILWIND_CLASSES` (alphabetical block after `antialiased`): `aspect-[16/9]`, `aspect-[3/4]`, `aspect-[4/3]`, `aspect-auto`, `aspect-square` (keeping `aspect-video`) — all live-probed as compiled and effective
- `lib/playground/styling-rules.ts` line 9 — replace the `aspect-portrait` advice with true guidance: named `aspect-square`/`aspect-video`; of the bracket forms only `aspect-[3/4]`, `aspect-[4/3]`, `aspect-[16/9]` are pre-compiled
- `app/globals.css` `@source inline` — drop `portrait` from `aspect-{auto,square,video,portrait}` (dead entry; Tailwind v4 has no `aspect-portrait` utility)
- Tests: `lib/editor/suggestions.test.ts` asserts the six compiled aspect tokens are suggested and `aspect-portrait` is not; `lib/playground/styling-rules.test.ts` asserts the prompt no longer mentions `aspect-portrait` and mentions `aspect-[3/4]`

### Out of scope

- Base UI combobox filter behavior (substring matching already works — only the item set was wrong) (descoped 2026-10-08)
- Broader audit of every `STYLING_RULES` claim beyond the aspect token (descoped 2026-10-08 — only `aspect-portrait` was probe-disproven)
- Compiling the bare v4 form `aspect-3/4` via `@source inline` (descoped 2026-10-08 — bracket forms cover the need; keeping one canonical spelling avoids split conventions)

## Design decisions

1. Extend the curated list rather than generating suggestions from the compiled CSS — rejected: stylesheet scraping, because it's runtime cost and fragile across dev/prod bundles; the curated list is the established pattern (test asserts uniqueness/sorting).
2. Keep bracketed `aspect-[3/4]` etc. in both suggestions and prompt instead of bare `aspect-3/4` — rejected: bare v4 syntax, because it is not compiled today (probe: `aspect-ratio: auto`) and neither source nor `@source inline` lists it; bracket forms are already forced through `@source inline` and verified by `runtime-classes.spec.ts:311`.
3. Fix the prompt's false claim in the same change — rejected: suggestions-only, because the prompt actively recommends the broken class; leaving it would keep producing no-op patches from the model.

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build && bun run test:e2e` green — **172 unit / 554 assertions / 33 e2e** (baselines +1 test)
- [x] New/updated unit assertions pass (six aspect tokens suggested; `aspect-portrait` absent from prompt)
- [x] Live MCP: Properties → className → Add class → type "aspect" → six options listed (`aspect-[16/9]`, `aspect-[3/4]`, `aspect-[4/3]`, `aspect-auto`, `aspect-square`, `aspect-video`); picking `aspect-[3/4]` applied (computed `aspect-ratio: 3 / 4`), then Undo restored baseline (computed `auto`)

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-08 | plan drafted (code + live probe diagnosis: one curated aspect entry; `aspect-portrait` does not compile) |
| 2026-10-08 | approved — suggestions + prompt fix + dead inline entry removal |
| 2026-10-08 | implemented — chain 172/554/33 green; live combobox shows all six aspect tokens; apply + undo verified |
