# CSS Safelist Mass = Resize-FPS Killer (and How to Measure It)

> **Lesson source**: plan 055-B + 057 (2026-10-24/25) — with DevTools open, viewport resizing degraded to 7–17 FPS with ~1s main-thread stalls; root cause was the `@source inline` safelist in `app/globals.css` (3,053 KB / ~42k rules = 96% of the CSS bundle).

## Problem Description

- **Speculative Tailwind cross-products are invisible latency**: `@source inline("{red,green,…}-{50,…,950}")`-style palette patterns expand to thousands of *never-observed* candidates. Each viewport resize with DevTools open re-runs style recalc over every rule → main-thread tasks of ~800–1000ms (`duration ~830ms, blockingDuration: 0, scripts: []` = rendering-bound, not script-bound).
- **A "declined" decision is only as good as its evidence**: plan 016 (2026-10-08) explicitly declined slimming the safelist (first-paint + endpoint-failure resilience, "gzip already ~232 KB"). The stall measurements overturned both rationales — and the first-paint guarantee was preserved by keeping only *observed* tokens.
- **Size alone doesn't predict the stall**: gzip 230 KB looked fine; the pathology tracks **rule count × recalc**, not transfer size. The 176 KB reference sheet ran at 65–72 FPS while the 3 MB sheet ran at 7.

## Solution Steps

1. **Bisect by causal isolation, not intuition** — control arm first, then binary splits:
   `about:blank` 120 → app CSS ON 7 FPS → app CSS OFF 120 → safelist-free compile 65 FPS.
   Each hypothesis (`dot-grid`, engine, images, DOM size, DevTools-emulation-only) got an ablation before being named the cause.
2. **Cut by evidence, not by taste** — five sources decide what stays: stored specs, picker datalist (`COMMON_TAILWIND_CLASSES`), generation prompt (`STYLING_RULES`), e2e-probe classes, server-injected fixup classes (`flex-nowrap w-full min-w-0`).
   Result: 17 sources / ~17,700 candidates → **10 sources / 1,083 candidates**; 3,053 KB → **197 KB raw / 30.7 KB gzip**.
3. **Route the cut's cost through the runtime path that already exists**: drafts style cut classes via async `/api/tailwind` (~200ms), published apps via the publish-time bake, preview pages skip the round-trip entirely when `bakedCss` covers the spec (`precovered` seeding).
4. **Guard the cut in CI** — audit-test floors (`≥10 sources / ≥1,000 candidates`) + an exact-token regression check (e2e tokens ∩ old safelist = 0 lost).

## Measurement Protocol (non-negotiable)

- **DevTools must be open** — it is the reported condition. DevTools-closed reads ~120 FPS *on every variant*, including broken ones; two runs were invalidated by exactly this (user caught both).
- **Control arm first, every session** — re-measure the baseline before each variant; never compare against a number from a previous session.
- **Match the surface**: measure on the real build (`next start`), not only a swap harness — and confirm the page actually exercises the path (a blocked-endpoint check run against a route with no spec recorded "0 attempts" and proved nothing).
- Reference values (this repo, DevTools open, viewport-cycling protocol): broken 7.2–17 / 217–992ms; curated **64 / 75ms / 0 frames >100ms**; no-CSS ≈ 120.

## Tooling Gotchas

- `@source inline("…")` lines must end **exactly `");`** — a trailing comment makes `extractInlineSources()` throw. Put prose on its own `/* … */` line.
- The safelist block can contain **interleaved section comments** — a "replace the contiguous run" splice silently leaves the lines after each comment behind. Always re-derive the counts after a bulk edit (`sources / candidates / unique`), don't trust the replace script's success message.
- Rule-presence checks in the browser must **recurse grouping rules**: `if (rule.cssRules) scan(rule.cssRules)` — top-level iteration misses everything inside `@layer`.

## Verification

- Gate chain green + e2e exact-token check: **0 of 53 covered tokens lost**
- Endpoint blocked → 1 rejected attempt, all kept rule families live, full render (first-paint + resilience, plan 016's two guarantees preserved)
- Prod FPS with DevTools open: 17.2 / 217ms / 22 frames >100ms → **64.0 / 75ms / 0**

## Memory Triggers

- FPS/resize complaints with DevTools → suspect the CSS rule count before the renderer; check `@layer utilities` size
- About to add another palette/variant cross-product to the safelist → is the token in any of the five evidence sources? No → it belongs in `/api/tailwind`, not the sheet
- About to measure FPS → control arm first, DevTools state identical, real build
- Reading a splice script's "success" output → re-derive the counts it claims to have changed
- Plan 016-style "declined/slimming rejected" note → revisit when new measurement evidence exists (016 was reopened 2026-10-25)
