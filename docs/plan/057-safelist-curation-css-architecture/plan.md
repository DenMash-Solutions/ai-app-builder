# Safelist Curation + Hybrid CSS Architecture — Implementation Plan

**Status:** implemented
**Date:** 2026-10-25
**Number:** 057 (056 reserved for Cache Components per user directive 2026-10-24)
**Closes:** plan 055-B (resize-FPS degradation with DevTools open)

## Goal

The `@source inline` safelist in `app/globals.css` (17 patterns → **17,702 candidates**, 4.23 MB = 96% of the static CSS) causes ~1-second main-thread freezes under viewport resize with DevTools open (7.2 FPS / 883–992ms gaps), yet only **209 candidates (1.2%)** have any evidence of ever being used. This feature ships the measured **V5 cut** (9 patterns + 1 enumerated line, 238 KB raw / ~34 KB gzip, **0 frames >100ms**), adjusts the plan-016 audit floors deliberately, and removes the redundant preview `/api/tailwind` request when a version-matched bake exists — the first (immediate) half of the hybrid architecture: small evidence-backed shared sheet + runtime compile for drafts + per-app baked CSS for published apps.

## Evidence (measured 2026-10-24/25, DevTools open, control arm first each session)

| CSS served on `/en/pokedex` | raw | FPS | max gap | frames >100ms |
| --- | --- | --- | --- | --- |
| current (control, re-verified per session) | 4.23 MB | 7.2–8.4 | 883–992ms | 5–6 |
| V4 = V5 + white/black overlay family | 288 KB | 42.2–42.9 | 100–158ms | 1–3 ✗ |
| **V5 (this plan)** | **238 KB** | **45.5 / 44.2** | **67 / 93ms** | **0 / 0 ✓** |
| safelist-free reference | 176 KB | 65.4–71.6 | 50–58ms | 0 |
| no CSS | 0 | ~120 | ~10ms | 0 |

*Discarded runs (recorded, not evidence): 120 FPS swap reading and 119.2 FPS V5 reading — both taken with DevTools closed (user caught both).*

Evidence extraction (`tmp-css-evidence.ts`, temp): 17,702 candidates ∩ 5 evidence sources = **209 covered**; palette hue family (#1,2,3,11,12) = 15,972 candidates with **26 covered**; top-4 patterns = 86% of all candidates.

## Scope

### In scope

- **A. Safelist cut in `app/globals.css`** — replace the 17 `@source inline` lines with V5 (**10 sources, 1,083 candidates / 1,055 unique**, measured):
  - keep 8 non-hue patterns: semantic tokens base + variants (plan 012 core/B2), layout, heights/objects, gradients, responsive grid/col/text (B2), typography/aspect (B2), scroll/snap (013)
  - restore plan 013's carousel scale forms as their own line (`{group-hover:,dark:group-hover:}scale-{90,…}` — token-level split of old pattern #16, decision 3)
  - drop: 5 palette hue cross-products (15,972 cands) + white/black overlay family #8/#9/#13 (172 cands, 50 KB CSS) + the hue half of #16
  - add 1 enumerated line: **33 observed tokens** (stored specs ∩ safelist, `COMMON_TAILWIND_CLASSES`, prompt `STYLING_RULES`, e2e-probe classes, fixup-injected `flex-nowrap w-full min-w-0`, plus the 4 white/black opacity forms #8 covered)
- **B. `lib/runtime-classes/safelist-audit.test.ts`** — lower the sanity floors deliberately, with comments citing this plan: sources ≥17 → **≥10**, candidates ≥2,000 → **≥1,000** (actual ≈1,045); audit still fails on any empty candidate (rot guard unchanged)
- **C. Preview bake-coverage seeding** — when `bakedCss` is present it is already version-matched (`servingArtifact()` guards `artifact.version === page.version`), so the hook accepts a `precovered` option that seeds the session `requested` set instead of fetching → **zero `/api/tailwind` requests** for version-matched surfaces; the owner path (local history entry ≠ `published.spec`) still requests (its spec may be newer than the bake). Touches `use-runtime-classes.ts` (option param), `preview-client.tsx` (seed iff `spec === published?.spec`), and — same pattern, added to scope 2026-10-25 — `live-page.tsx` (featured page passes `featured.spec` + its version-matched artifact together)
- **D. Decision: `app/probe/*` control pages** — recommend delete (they were 055-B isolation controls; compile/apply guarantees live in `e2e/runtime-classes.spec.ts`); confirm at implementation
- **E. Plan records (same-turn rule)** — reopen plan 016's declined slimming descope with date + stall evidence; record V5 decision + table in 055 (Status → `implemented` after verification); INDEX rows/statuses updated same turn

### Out of scope

- `/api/tailwind` hardening — persistent/disk cache, concurrency dedupe, missing-only diffs, rate limiting — separate plan after this one (descoped 2026-10-25; endpoint unchanged here)
- Per-app precompiled CSS beyond existing `bakedCss` (themes in the cache key, artifact regeneration on spec change) — needs per-app theme design first (descoped 2026-10-25)
- Semantic-token vocabulary expansion (`bg-primary`-centric prompt rewrite, option 3) — prompt-behavior change, its own plan (descoped 2026-10-25)
- Finite utility catalog / restricted generation vocabulary (option 4) — rejected: limits what models may emit (descoped 2026-10-25)
- Closing the residual 45 FPS vs 65 FPS gap (kept patterns' own cost) — bar is "0 frames >100ms", met (descoped 2026-10-25)

## Design decisions

1. **V5 over V4** — rejected: V4 (keeps `text-{white,black}`/`border-{white,black}` overlay variants, 288 KB): measured 1–3 frames >100ms, fails the bar; those 172 candidates cost 50 KB (priciest per candidate in the sheet).
2. **Five evidence sources**: stored specs, picker list, prompt vocabulary, e2e-probe classes, server-injected fixup classes — rejected: scanning plan docs for evidence (docs quote aspirational examples; `globals.css` itself bans scanning docs), rejected: spec-only (4 published specs ⇒ 165 tokens, too thin; prompt-taught forward vocabulary would be lost).
3. **Token-level hue filtering, not pattern-level** — pattern #16 mixes carousel `group-hover:scale` (plan 013 evidence) with a hue cross-product; whole-pattern filtering would have dropped 013's guarantee. Regression gate enforced: *every evidence token covered today must remain covered* → 0 lost.
4. **Enumerated extras over pruned patterns** — observed palette tokens re-added as one literal line (+226 bytes) instead of narrower `{blue,zinc,…}` patterns: exact, auditable, no speculative re-growth.
5. **Cuts degrade to async, by design** — unobserved cut classes style after the `/api/tailwind` round-trip in drafts (or stay unstyled if the endpoint fails); published apps unaffected (`bakedCss` compiles exact classes). This accepts plan 016's risk in narrowed form: only zero-evidence classes lose first-paint guarantee — the architecture direction the user set 2026-10-24 (small shared sheet + on-demand + per-app bake).
6. **Preview seeding keyed on version-match, not on spec identity heuristics** — `bakedCss` non-null already implies `artifact.version === page.version`; owner-local entries bypass seeding (they render `entry.spec`, possibly newer).

## Verification

- [x] Gate chain: `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build && bun run test:e2e` (stop dev + wipe `.next` before build; restart dev :3000 + wrapper :4100 after; dev-log scan) — all green 2026-10-25: format/lint/format:check ✓, `tsc` exit 0, **647 unit tests**, build clean (`/probe` gone; built CSS **197 KB raw / 30.7 KB gzip**, was 3,053 KB / 230 KB), **112/112 e2e**. Dev-log scan: 0 errors attributable to this change; 3 hydration errors = pre-existing theme-preference mismatch, recorded as plan 055 finding 9 (descoped to a future plan)
- [x] `safelist-audit.test.ts` green at new floors (≥10 sources / ≥1,000 candidates — plan-057 comment); every enumerated candidate produces a rule; runtime-classes unit suite 30/30
- [x] First-paint/resilience (016's two guarantees for kept classes): `/api/tailwind` fetch rejected via initScript block → **1 attempt, rejected gracefully**, recursive `cssRules` scan found all 4 probe families (`bg-stone-100\/50`, `bg-card`, `group-hover:scale-95`, `lg:grid-cols-4`) across 2,706 rules, page rendered **319 elements** with themed computed styles; block flag cleared on next navigation
- [x] Preview network: anonymous visitor load of `/en/pokedex` issues **zero** `/api/tailwind` requests (baked style 20,033 chars, Geist fonts intact, 2 stylesheet links = 3.6 K + 197 K); owner preview with a local entry (spec ≠ published) still requests — **exactly 1 POST** (identity guard verified both ways)
- [x] FPS on the **production build** with the real pipeline (not swap harness): control-arm-first protocol — control 17.2 FPS / 217ms / 22 frames >100ms → **64.0 FPS / 75ms max / 0 frames >100ms / 88 resize calls, DevTools open (user-confirmed)** — beat the ≈45 expectation, ≈ the 176 K harness reference
- [x] e2e `runtime-classes` probes green (evidence tokens incl. `dark:bg-stone-900/90`, `lg:grid-cols-4`, fixup classes; carousel + chrome-row tests in the 112/112 run); e2e exact-token regression check: **0 of 53 covered tokens lost**
- [x] Repo clean: `tmp-css-evidence.ts`, `tmp-css-variants.ts`, `app/__v{3,4,5}.css`, `public/__fps-test.css`, probe pages (per D) removed; trace artifacts (`resize-devtools.json.gz`, `.devin/`) never committed

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-24 | plan drafted — evidence extraction + causal isolation done (055 findings 1–8); V4/V5 measured |
| 2026-10-25 | approved (incl. scope D = delete `app/probe/*`, font-integrity check added to verification) |
| 2026-10-25 | **implemented** — all 7 verification boxes green: chain (format/lint/tsc/647 unit/build/112 e2e), audit floors, endpoint-blocked first-paint (1 attempt rejected, 4 rule families live), zero-GET visitor + 1-POST owner preview, prod FPS 64/75ms/0 (DevTools open, user-confirmed), e2e 0/53 tokens lost, repo clean. Built CSS 3,053 KB → 197 KB (230 KB → 30.7 KB gzip) |
