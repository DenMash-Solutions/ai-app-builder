# Cache Components Adoption — Implementation Plan

**Status:** approved
**Date:** 2026-10-25

## Goal

Turn on Next's Cache Components (`cacheComponents: true`) and walk every route
to a prerenderable state — static shells where possible, `<Suspense>`-streamed
request-time data where not — as promised by plan 055 (decision 3: "Cache
Components adoption is the NEXT plan (056)"). Today all 15 routes render `ƒ`
(dynamic, fully request-time) because four server files `await params` at the
page top; adoption converts them to `○ (Static)` or `◐ (Partial Prerender)`,
which is the prerequisite for the follow-up skills (static-shell optimizer,
Partial Prefetching) and gives published pages an instant shell.

## Scope

### In scope

- **Phase 1 — checkpoint**: `cacheComponents: true` in `next.config.ts`
  (preconditions verified 2026-10-25: Next 16.3.8, no `dynamic`/`revalidate`/
  `fetchCache` exports anywhere in `app/`, no `experimental.dynamicIO`, zero
  sync-IO (`Date.now()`/`Math.random()`/`randomUUID`) in `app/`, all layouts
  are server components). Run `npx @next/codemod@latest
  cache-components-instant-false ./app` to insert `export const instant =
  false` + the adoption comment (codemod 2026-10-25 emits
  `// @next-codemod-ignore Cache Components adoption: …` — NOT the older
  `// TODO: Cache Components adoption` the skill documents; the work-queue
  grep is therefore `grep -rn "Cache Components adoption" app/`) into every
  server route file (`"use client"` pages are skipped by design and inherit
  ancestor opt-outs), get `next build` green, **checkpoint commit**
  (reviewable/revertible; the comment markers double as the work queue)
- **Phase 1 blockers the codemod can't cover** (all discovered by the build,
  fixed 2026-10-25 to reach green — client pages/layouts can't export
  `instant`, and sync-IO/param validation ignore opt-outs anyway):
  - root-param `generateStaticParams` in `app/[locale]/layout.tsx` (this
    layout IS the root layout → `locale` is a root param → E622 without it)
  - `<Suspense>` around the `useParams` reader in `ui/[ref]/page.tsx` (no
    `generateStaticParams` for arbitrary refs → params are runtime data →
    the hook suspends during prerender; documented in `dynamic-routes.md`
    "Without generateStaticParams")
  - `<Suspense>` around `NavItems` in `components/shell/app-shell.tsx`
    (`usePathname` suspends on unknown-param routes; fallback uses fixed
    widths — `SidebarMenuSkeleton` calls `Math.random()`, which is itself
    flagged in a prerendered fallback)
- **Phase 1 — e2e adaptation to Activity parked routes** (discovered
  2026-10-25 by the first full e2e run: 59/112 failed; breakdown confirmed
  all 59 share one mechanism). With `cacheComponents: true`,
  `layout-router.js` wraps route children in React's `<Activity>` (gated on
  `process.env.__NEXT_CACHE_COMPONENTS` — no config opt-out exists) so a
  navigated-away route stays mounted **hidden** (`display: none !important`)
  instead of unmounting, to preserve state across navigations (documented in
  `migrating-to-cache-components.md` "UI state preservation" and
  `preserving-ui-state.md`). Playwright locators then match parked copies →
  strict violations (38), `toBeVisible` failing on a duplicate (8), doubled
  `toHaveCount`/`toHaveText` (8), hidden-only matches (3), click timeouts
  (2). **Fix is test-side** — scope the failing locators
  with `.filter({ visible: true })` (Playwright 1.63) at failing call sites
  plus shared helpers (`data-sources` `count`/`row`, shared `generate*`
  helpers), iterating run → fix → run until 112/112
- **Phase 1 — app-side reset for the restored landing canvas** (discovered
  2026-10-25 after the locator fix: 4 failures left, all control-verified
  against pre-056; fix design reviewed with an external model, user relayed
  the brief). Parking also breaks "unmount clears state": the landing
  `/ui` instance that streamed a generation is parked **holding its spec**,
  and `handleClearCurrent` (`clear()` + `router.push("/ui")`) restores it —
  `displayedSpec = routeEntry?.spec ?? spec` falls back to the stale stream
  spec (`playground.tsx:510`), so the visible canvas shows the old spec
  while the correctly-cleared empty state lands hidden (example chips are
  empty-state-only → 3 e2e tests fail; fresh `page.reload()` confirms the
  empty state is correct). The migration guide's remedy applies verbatim:
  "if your code relied on unmounting to clear state, add explicit reset
  logic." **Fix (per brief §4 — two complementary safeguards):**
  1. **Explicit handoff state** — `handoffPending` local state, set in the
     generate-completion branch before `router.push(/ui/{id})`, and the
     display rule becomes `isStreaming ? spec : (routeEntry?.spec ?
     (handoffPending ? spec : null))` — a retained local spec can never
     paint unless streaming, entry-backed, or in a legitimate handoff frame
     (replaces the implicit `?? spec` fallback that caused the bug)
  2. **Activity lifecycle reset** — `useLayoutEffect` whose cleanup runs
     when Activity parks the route and whose body re-runs on restore
     (documented pattern: `preserving-ui-state.md` dropdown example);
     clears completed transient stream state + resets `handoffPending`,
     guarded by `!isStreaming` and a pending-completion check (a completion
     waiting to commit must navigate first — declared before the
     completion effect so the handoff frame never blanks)
  **Rejected**: pathname-departure detection (attempt 1 — hidden trees
  never observe the intermediate pathname; proven empirically), DOM
  visibility signals, `bfcacheId` keying (brief §6). **Also in scope**:
  verify (brief §5) whether a parked completion can navigate — probe via
  `delayMs` mock + park-mid-stream test; `useUIStream.clear()` confirmed
  local-only (`setSpec(null); setError(null)` — no abort). Scope:
  `components/playground/playground.tsx` only. The 10 `data-jr-key`
  locators in `editor.spec.ts` additionally re-scope from per-element
  visibility to the visible `.dot-grid` canvas (a `display: contents`
  empty container has a 0×0 box, so `visible` wrongly excludes it)
- **Phase 1 — proxy-side bare-segment status decisions** (discovered
  2026-10-25 by Test 6 in production: `ui-routes` asserts a real 404 for a
  renamed bare slug; control run against the pre-056 tree proved the
  regression). With Cache Components every dynamic route streams a static
  shell first, so a status decided during render is already fixed at 200 by
  the time `notFound()`/`redirect()` fire (`x-nextjs-postponed: 1`, docs:
  `streaming.md` "Status codes", `loading.md` "Status Codes",
  `not-found.md` — "With Cache Components, every dynamic route streams a
  static shell first, so run that check in proxy instead"). Measured
  prod matrix: bare unknown `/xx` + `/totally-unknown-slug-xyz` → 200
  soft-404 (pre-056: 404); published bare slugs `/denmash` +
  `/e2e-landing` → 200 client-side redirect (pre-056: 307); `/fr`,
  `/en*`, `/fr/ui` unaffected. Note: the codemod's `instant = false` is a
  **validation-only** export (segment "allowed to block" for nav
  validation) and never affected runtime status. **Fix (docs-prescribed)**:
  move the decision-12 bare-segment check (carried content language →
  serve / published slug → 307 / else 404) into `proxy.ts` for
  single-segment content paths, reusing `resolveRootServing` + the
  projection reads (client injected so the proxy can read without
  `next/headers`), and serve the miss via rewrite to the prerendered
  `/_not-found` route (real 404 + Next's default 404 UI) or an equivalent
  real-404 response. Page-level logic stays as defense in depth; `/fr/ui`
  (shape-only gate in `(app)/layout.tsx`) already returns a real 404 and
  is untouched. **Perf tuning (same turn)**: proxy fetches bypass the RSC
  data cache (repeat reads stay cold — measured ~500ms proxy time per bare
  content request), so the decision uses slim reads — featured
  `spec->state` only (`getFeaturedLanguagesFrom`, no elements/artifacts
  payload) + `slug` existence only (`publishedSlugExistsFrom`) — started in
  parallel while `resolveRootServing` keeps the decision order (measured
  down to ~190-260ms: `/xx` 349→189ms, `/fr` 536→256ms). Sharing the RSC
  projection cache with the proxy is left as a follow-up (no documented
  API). Scope: `proxy.ts`, `lib/publish/featured.ts`,
  `lib/i18n/spec-languages.ts` (state-level `availableLanguagesOfState`),
  `lib/supabase/proxy.ts`
- **Phase 2 — full adoption**, feature by feature (top-down, layouts before
  pages, one feature finished before the next starts), removing opt-outs and
  resolving each blocking read per the per-error `/docs/messages/` recipes:
  - **F1 locale shell**: `app/[locale]/layout.tsx` + `app/[locale]/page.tsx`
    (`await params` + `getTranslations`/`getMessages`)
  - **F2 published surface**: `app/[locale]/[slug]/page.tsx` (two `await
    params` sites) — the money route: static shell with baked CSS, spec data
    streamed. **Settled 2026-10-26 after measurement** (scope refined
    same-turn): (a) the decision-11 canonical-tag 404 gate moves upstream to
    `proxy.ts` for multi-segment content paths (pure-CPU check → rewrite
    `/_not-found` → real 404 status before the body streams); (b) the page
    was restructured to suspend `SlugPage` behind a deterministic fallback
    and that **measured incompatibly with the zero-JS baked-serve contract**
    — the `javaScriptEnabled: false` assertion in `e2e/authed.spec.ts`
    "publishes an entry and serves its live URL" failed 3/3 runs, because
    post-flush Suspense content is delivered behind React swap scripts that
    never execute without JS. The page therefore keeps a **reason-commented
    `instant = false`** (same pattern as F1): complete blocking HTML for the
    no-JS contract, with the page's canonical-tag gate retained as defense
    for dot-paths the proxy matcher excludes (`.*\..*`) — it sets a real 404
    again now that the render blocks
  - **F3 playground/app group**: `(app)/layout.tsx`, `ui`, `ui/[ref]`.
    **Settled 2026-10-26** (scope refined same-turn): the `(app)/layout`
    locale gate (`notFound()` for content-only locales — `/fr/ui` 404)
    moved to `proxy.ts` alongside the F2 canonical-tag guard (content path
    whose `second` ∈ `APP_SEGMENTS` → rewrite `/_not-found`), because the
    parent's throw **poisoned every child segment's validation** —
    validation's prefetch render trips the gate and reports "an error
    prevented the target segment from rendering" for `ui` (measured), which
    would have forced meaningless `instant = false` opt-outs onto the
    pure `ui/layout` and `ui/page`. With the gate upstream,
    `(app)/layout` lost its params entirely (pure sync shell) and all
    three F3 segments validate clean with **zero opt-outs**; the only
    behavior delta is matcher-excluded dotted refs
    (`/{content-locale}/ui/{dotted.ref}`: real 404 today → renders the
    `[ref]` page's own handling — refs never carry dots)
  - **F4 auth/admin**: `login`, `signup`, `admin`
- Verification per feature via `next-dev-loop` (installed) + build gates;
  known risk to handle when hit: client hooks (`usePathname` in
  `components/shell/app-shell.tsx`, `components/locale-switcher.tsx`,
  `admin/page.tsx`) rendered in server trees can raise
  `blocking-prerender-client-hook` — fix per that error's Suspense recipe
- Route files that legitimately stay blocking keep a **reason-commented**
  `instant = false` (no bare TODOs at the end)
- Same-turn `docs/plan/INDEX.md` updates; full project gate chain per phase

### Out of scope

- **Partial Prefetching** (`partialPrefetching: true`) — its own follow-up
  skill after adoption completes (descoped 2026-10-25; requires this plan's
  passing build first)
- **Static-shell growth / optimizer pass** (`next-cache-components-optimizer`)
  — pure optimization after adoption; not part of getting the flag on
  (descoped 2026-10-25)
- **Rewriting 055's fetch-tag caches** into `"use cache"` — the migration
  guide says existing caches stay; `projection-cache.ts` force-cache + tags
  composes with Cache Components as-is (descoped 2026-10-25)
- **`app/api/*` route handlers** — not part of the route-prerender validation
  surface (they keep their current runtime behavior)
- **`instant()` e2e regression tests** — offered by the skill as post-adoption
  hardening; decide at the check-in if wanted (descoped 2026-10-25)
- **Any change to `app/globals.css` / runtime-classes behavior** — plan 057's
  verified CSS stays untouched

## Design decisions

1. **Checkpoint-first sequencing** (user choice 2026-10-25) — rejected:
   all-in-one-pass, because the flag flip + codemod lands as one reviewable,
   revertible commit and the TODO comments become an explicit work queue for
   the adoption loop.
2. **Full adoption, no stopping at key routes** (user choice 2026-10-25) —
   rejected: home/`[slug]`-only, because the skill's definition of done is
   zero bare `TODO: Cache Components adoption` grep hits; a half-adopted tree
   leaves validation latent and the next session guessing.
3. **Fix `await params` by forwarding the promise into a `<Suspense>` child**
   — rejected: keeping `await params` at page top (that IS the blocking read),
   rejected: `instant = false` as the permanent answer (defeats the plan).
4. **Keep the current fetch-tag cache layer untouched** — rejected:
   migrating `projection-cache.ts` to `"use cache"`, because the migration
   guide explicitly preserves existing caches and rewriting verified 055
   behavior adds churn without a measured benefit.
5. **`next-dev-loop` as the primary per-route verifier, build as the gate** —
   rejected: build-only loop, because `◐` proves *a* shell exists, not that it
   contains useful content (empty-shell `◐` is the classic false positive;
   browser check catches it).
6. **Stop dev + wipe `.next` before every build** (mistake #23) — rejected:
   interleaving `next build` with a live dev on the same `.next`, because
   Turbopack's cache poisons and replays dead errors.

## Verification

- [ ] Phase 1: `next build` green with every server route file opted out;
  `grep -rn "Cache Components adoption" app` lists all 7 (the 4 `"use client"`
  pages inherit ancestor opt-outs); checkpoint committed after `bun run format
  && bun run lint && bunx tsc --noEmit && bun run test`
- [ ] Phase 2, per feature: dev overlay clean on the feature's routes,
  `next build` passes, browser (next-dev-loop) shows real content in the
  shell → fallback resolves (capture shell + final states)
- [ ] Full chain per phase: `bun run format && bun run lint && bunx tsc
  --noEmit && bun run test && bun run build && bun run test:e2e` (dev stopped,
  `.next` wiped before build; dev :3000 + wrapper :4100 restored after;
  dev-log scan attributable-errors = 0)
- [ ] Done state: `grep -rn "Cache Components adoption" app` → 0 hits (any
  surviving `instant = false` carries a reason comment in place of the
  codemod marker); route
  table shows `○`/`◐` for the adopted routes (or `ƒ` only behind a documented
  escape hatch)
- [ ] Behavior pins: published `/en/<slug>` still serves baked CSS with zero
  `/api/tailwind` requests (057-C), anonymous vs owner preview request counts
  unchanged, 112/112 e2e green, sync `uis` slim selects unaffected
- [ ] No regression in plan 057's FPS result is expected (no CSS changes) —
  spot-check one prod FPS sample if any client-tree change touches rendering

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-25 | plan drafted — preconditions verified (16.3.8, no incompatible exports, no sync-IO); strategy + depth confirmed with user (checkpoint-first, full adoption) |
| 2026-10-25 | approved (user "ok") — Phase 1 checkpoint starts now |
| 2026-10-25 | scope added (same-turn): e2e adaptation to Activity parked routes — first full run failed 59/112, all traced to hidden parked route copies (no framework opt-out); test-side `.filter({ visible: true })` fix, no app change |
| 2026-10-25 | scope added (same-turn, user-approved option 1): app-side reset in `Playground` — locator fix left 4 failures, all control-verified as 056-caused; 3 are the stale restored landing canvas, 1 was a zero-box `display: contents` locator re-scoped to the canvas |
| 2026-10-26 | fix approach superseded (user relayed external-model brief): pathname-departure attempt replaced by `handoffPending` display rule + `useLayoutEffect` Activity lifecycle reset; probe verified cleanups run at park/restore, no parked-completion hijack (library aborts mid-stream at park — pre-existing behavior), StrictMode idempotent; Test 1 8/8, handoff probe 0 empty-state flashes in 55 landing frames |
| 2026-10-26 | scope added (same-turn): proxy-side bare-segment status decisions — Test 6 in prod exposed soft-404 (bare unknown 200 vs control 404) and lost 307s for published slugs; `notFound()`/`redirect()` fire after the streamed shell fixes the status at 200; docs-prescribed fix = decision in `proxy` + rewrite to prerendered `/_not-found` |
| 2026-10-26 | **Phase 1 verified** — gate chain: format ✓ lint ✓ tsc ✓ 647 unit ✓ build (PPR ◐) ✓ full e2e **112/112** (dev, StrictMode) ✓ prod status matrix exact pre-056 parity (404+UI / 307 / untouched 200s) ✓ Test 6 prod **21/21** ✓ dev-log scan: only plan-known `blocking-prerender-current-time` diagnostics on authed `Home`/`SlugPage` (Phase-2 F4) + 1 self-recovering theme hydration mismatch in untouched theme code (no test impact). Phase 2 (full adoption) pending — plan stays `approved` until the adoption-marker grep hits 0 |
| 2026-10-26 | **F1 locale shell adopted** — both F1 files now carry **reason-commented** `instant = false` (allowed by plan): root layout because `<html lang>` + next-intl messages derive from the locale param and a document root can't sit in `<Suspense>`; root page because decision-12 status gates must run **before** the response streams (`loading.md` Status Codes) — a `<Suspense>` wrap was implemented and measured: the shell flushed at 200 and dev `/xx` soft-404ed (200 + 404 UI) until reverted, validating both reasons empirically. Real adoption wins: cookie-free public projection reads (`createPublicReadClient` — `cookies()` was the page's runtime-data blocker; `/en`,`/es` went ◐ PPR → **○ fully static**), next-intl request-config clamp on the synthetic `/_not-found` param + layout metadata/messages clamped to canonical tags (zero `invalid locale` warnings). Gates: format ✓ lint ✓ tsc ✓ 647 unit ✓ build ✓ 112/112 e2e (dev) ✓ prod matrix + prod log clean ✓. Work queue 7 → **5** |
| 2026-10-26 | **F2 published surface adopted** — `proxy.ts` gains the decision-11 canonical-tag guard for multi-segment content paths (pure-CPU → rewrite `/_not-found`, real 404 before the body streams; verified `/en_US/foo` 404 in `proxy.ts: 1.2ms`); `[slug]/page.tsx` codemod marker → **reason-commented `instant = false`**: the streaming (`<Suspense>`) restructure was implemented and **measured incompatible with the zero-JS baked-serve contract** — the `javaScriptEnabled: false` assertion in `e2e/authed.spec.ts` "publishes an entry and serves its live URL" failed 3/3 runs (post-flush content ships behind React swap scripts that never execute without JS), so the route serves complete blocking HTML by decision. Page gate retained as dot-path defense (matcher excludes `.*\..*` — real 404 again under blocking). Gates: format ✓ lint ✓ tsc ✓ 647 unit ✓ build (29/29, `/en`,`/es` ○ static) ✓ 112/112 e2e (dev) ✓ prod matrix (404+UI incl. dot-path, 307s, published 200s, correct `lang`) ✓ prod log clean ✓. Work queue 5 → **4** |
| 2026-10-26 | **F3 app group adopted** — `(app)/layout.tsx`, `ui/layout.tsx`, `ui/page.tsx` all carry **zero opt-outs**: markers removed, all three validate clean (dev log: no `blocking-prerender-runtime`, no `Could not validate instant`). The `(app)/layout` locale gate (`notFound()` for content-only locales — `/fr/ui` 404) moved to `proxy.ts` (content path with `second` ∈ `APP_SEGMENTS` → rewrite `/_not-found`) after **measuring** that the parent's throw poisoned child validation: `ui` reported "an error prevented the target segment from rendering" with the gate as `[cause]`, which would have forced meaningless opt-outs onto two pure sync components. The layout lost its `params` entirely; behavior parity verified for every case (`/fr/ui`, `/xx/ui`, `/fr/admin|login|signup`, `/fr/ui/xyz` → 404+UI; content paths `/fr/pokedex`, `/xx/pokedex` still serve; F2 guard + bare-segment decisions intact). Gates: format ✓ lint ✓ tsc ✓ 647 unit ✓ build (29/29) ✓ 112/112 e2e (dev, incl. the now proxy-owned `/fr/ui` 404) ✓ prod matrix ✓ prod log clean ✓. Work queue 4 → **1** (only F4's `admin/layout`) |
