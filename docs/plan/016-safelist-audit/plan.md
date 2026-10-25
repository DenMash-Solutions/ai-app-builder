# Safelist Audit — Implementation Plan

**Status:** implemented
**Date:** 2026-10-08

## Goal

The `@source inline` safelist in `app/globals.css` (17 sources, ~25–30k expanded candidates) is the app's L1 static class coverage — it guarantees first-paint styling before the on-demand `/api/tailwind` endpoint responds, and resilience if that endpoint fails. It has been hand-maintained and has already rotted once silently (`aspect-portrait` shipped for weeks and compiled nothing, discovered only via live probing). This feature turns the safelist into a CI-enforced invariant: a unit test that expands every inline pattern and runs the real Tailwind compile engine, failing whenever any safelist entry produces no rule.

## Scope

### In scope

- `lib/runtime-classes/safelist.ts` — `extractInlineSources(css)`, `expandCandidates(pattern)`, `expandGlobalSafelist(css)`
- `lib/runtime-classes/safelist.test.ts` — expander unit tests (empty alternatives, sequential/adjacent brace groups, slash-opacity groups, whitespace splitting, literal passthrough, loud failure on nested braces or embedded quotes)
- `lib/runtime-classes/safelist-audit.test.ts` — reads the real `app/globals.css`, expands all sources, one `buildForCandidates()` call, asserts `missing` is empty (failure message caps the listing); sanity floors so extraction rot fails loudly
- Removing/correcting any currently-rotten safelist entries the first run discovers

### Out of scope

- Slimming the safelist — declined; it stays as first-paint + failure-resilience layer (descoped 2026-10-08, user decision) — **REOPENED 2026-10-25**: plan 055 measured the 3.1 MB sheet as the DevTools-open resize-FPS cause (17.2 FPS / 217 ms worst frame vs 64 / 75 ms after the cut), and plan 057 shipped an evidence-backed slimming (17 → 10 sources, ~17.7k → 1,083 candidates, 3.1 MB → 197 KB raw) that keeps the first-paint + endpoint-failure guarantee for observed tokens
- Bundle/payload size optimization of the ~3.1 MB raw static CSS (descoped 2026-10-08 — gzip already ~232 KB, immutable-cached) — **REOPENED 2026-10-25** by the same stall evidence; delivered as part of plan 057 (197 KB raw / 30.7 KB gzip)
- Auditing `app/theme-tokens.css` — contains no `@source inline` directives (descoped 2026-10-08)
- Client-side filtering of endpoint requests against the static stylesheet (already rejected by runtime-class-compile design decision 5)

## Design decisions

1. **Audit through the real `compile()`/`build()` engine** — rejected: mocked or string-snapshot assertions, because they reproduce the exact blind spot being fixed (a pattern that parses but compiles nothing); rejected: a standalone script outside `bun test lib`, because it would not run in the standard verification chain.
2. **One bulk `buildForCandidates()` call for all expanded candidates** — rejected: sampling (misses rot), rejected: per-source builds (17× slower for the same coverage). If runtime proves unacceptable the split is a mechanical follow-up change.
3. **Expander validates before expanding** — nested braces or embedded quotes throw with the offending source text instead of silently producing wrong candidates, so future exotic safelist syntax surfaces as a loud test error.
4. **Sanity floors in the audit test** (≥17 sources, ≥2,000 candidates) — guards against the extraction regex rotting (e.g. a comment rewording the directive) into a vacuous pass.
5. **Test lives in `lib/runtime-classes/`** next to the engine it drives, matching `compile.test.ts` (tests must be under `lib/` because `bun run test` = `bun test lib`).

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build` — all green; unit suite 202 pass / 618 assertions / 858 ms, e2e 35/35
- [x] Audit test passed after fixing the 27 rotten entries its first run exposed (see status log); re-run clean
- [x] Manual break check: temporarily added `aspect-portrait` to an inline source → test failed listing it → reverted
- [x] Chain baselines hold (unit 188 → 202, build ✓, e2e 35 ✓)

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-08 | plan drafted in implementation preview |
| 2026-10-08 | approved (user "ok") |
| 2026-10-08 | audit first run found 27 rotten candidates: 18 × `*destructive-foreground` (theme lacked `--destructive-foreground` — every other semantic pair had one, so the token was added to `app/theme-tokens.css` instead of deleting the vocabulary), `translate-y--2/--1` (negative-prefix form is what v4 compiles — pattern rewritten), `auto-cols-{xs…3xl}` (only `min,max,fr` exist — pattern narrowed) |
| 2026-10-08 | design decision 2 follow-up applied: `hasRule` per-token scans (5.3 s over 4.5 MB) replaced by single-pass selector-Set `findMissingTokens` in `lib/runtime-classes/escape.ts` (hex-escape aware, `)`-terminating); audit now runs in <1 s, endpoint shares the path |
| 2026-10-08 | implemented — chain green (202 unit / 618 assertions, 35 e2e), break check confirmed the audit catches injected rot |
| 2026-10-25 | reopened both descoped slimming/size items (stall evidence, plan 055 findings 1–8) → superseded by plan 057, which shipped the curated cut and raised the audit-test floors to ≥10 sources / ≥1,000 candidates |
