# Performance — Implementation Plan

**Status:** implemented
**Date:** 2026-10-24

## Goal

Three reported performance issues: (1) every page load for a signed-in user
fires `GET …/rest/v1/uis?select=*` — a full-row, full-table pull whose payload
is every revision of every entry; (2) with DevTools open, resizing the
viewport degrades FPS on any screen (investigate preview mode first);
(3) every UI load should hit a cache to cut loading time. Fix 1 is a precise
query-shape change; 2 is measurement-driven; 3 needs a cache-model decision
(see open questions — awaiting user answers before implementation).

## Scope

### In scope

**A. Sync query slimming (issue 1) — `lib/history/sync.ts`**

- `push()` selects only `id, owner_id, updated_at` — the only columns it
  reads (owner guard, LWW compare, deletion owner check); today it pulls
  full `revisions` payloads to compare timestamps
- `pull()` filters `.eq("owner_id", ownerId)` server-side (the client
  filters by owner already; today an admin's SELECT downloads every
  user's rows + revisions — recorded lesson
  `.agents/lessons/dev-server-e2e-triage.md` §3: 92 rows → ~7s sync
  cycle); `push()` deliberately keeps its unfiltered select so the F7
  ownership guard can still SEE foreign rows (decision 5)
- `pull()` becomes two-phase: slim compare pass
  (`id, owner_id, updated_at`) → fetch full rows via `.in("id", …)` only
  for remote-newer / unknown-local ids — LWW semantics identical
- Unit-test pins in `sync.test.ts`: column lists, owner filter, two-phase
  merge (remote-newer adopted, local-newer kept, foreign owner skipped)
- **Mount scoping (scope + 2026-10-24, user-approved option B)**: move
  `<SyncEngine />` + `<UploadNudge />` from the root layout
  (`app/[locale]/layout.tsx`) into the app group
  (`app/[locale]/(app)/layout.tsx`) — sync only starts where history can
  actually change (editor/admin surfaces). The preview/published routes
  (`/`, `/en/<slug>`) then fire **zero** sync requests; the sync dot is
  unaffected (it renders only in the playground top bar and subscribes to
  module state). Mounting in the (app) layout rather than inside
  `Playground` keeps one mount across `/ui` → `/ui/[id]` navigation (no
  re-sync cycle per editor navigation)

**B. Resize-FPS investigation → fix (issue 2)**

- Measure first on the preview route (`/en/<slug>`): rAF frame-count FPS
  sampling while cycling viewport sizes via MCP emulation, plus a
  performance trace if exposed; compare against the playground and a bare
  route to isolate surface vs global
- Hypotheses to confirm/refute: `dvh`-unit continuous style recalc,
  `dot-grid` background repaint, renderer re-layout per frame, devtools-
  emulation-specific (device-mode sends repeated viewport events)
- Fix lands only after the hot path is identified (no speculative fixes);
  if the cause is app-chrome/global rather than preview, check in with
  findings before fixing (per protocol)

**C. UI load cache (issue 3)**

- Cache the server-side reads behind every published UI:
  `getPublishedPageBySlug` (`published_pages` by slug) and
  `getFeaturedPage` (`site_settings` + `published_pages`) — today both hit
  Supabase REST on every request (no `revalidate`/tags anywhere)
- Invalidation wired at the mutation points: publish/unpublish
  (`lib/publish/publish.ts`), artifacts route, feature change
- Cache model: **lightweight fetch-tags** (decision 1) — table-scoped
  tags on the world-readable reads, immediate expiry at every mutation
- Verification: repeat load of `/en/<slug>` serves from cache (network
  log shows no second REST read); publish → next load sees the new version

### Out of scope

- Cache Components app-wide adoption as a standalone project — unless the
  user picks it as the cache model, in which case it becomes its own plan
  (056) and this item rides on top of it (descoped 2026-10-24 pending
  decision)
- Client-side (SWR/IndexedDB) caching of published specs — pending the
  same decision; server cache is the reported pain (descoped 2026-10-24)
- `/ui/[ref]` load path — resolves from localStorage, no network
- `/api/tailwind` compile caching (session-scoped `requested` set already
  prevents repeats within a session; server cache is a follow-up if the
  user wants it)
- Admin overview queries (`lib/admin/overview.ts`) — separate surface

## Design decisions

1. **Two-phase pull over watermark incremental sync** — rejected: an
   `updated_at > watermark` cursor for now, because deletions never flow
   down and a watermark adds failure modes (clock skew, backdated edits)
   on top of an unmeasured baseline; the two-phase + owner-filter change
   recovers the bulk of the payload with identical semantics. Revisit with
   measurements if the slim pull is still hot.
2. **Server-side owner filter in addition to the client guard** — the
   client guard (F7) stays (defense in depth); `.eq("owner_id")` removes
   the admin full-table download at the source.
3. **Cache model for published reads: lightweight fetch-tags now, Cache
   Components later** (user decision 2026-10-24) — pass a tagged fetch
   (`cache: "force-cache"` + `next: { tags }`, table-scoped) to the
   Supabase server client for the world-readable tables
   (`published_pages`, `site_settings`) and expire the tags
   (`revalidateTag(tag, { expire: 0 })` — next request blocks for fresh
   data, read-your-own-writes) at every publish/unpublish/artifact/
   feature mutation. Rejected now, scheduled next: `cacheComponents`
   adoption — becomes plan **056** after this plan lands (user directive).
4. **Resize fix decided by measurement, not intuition** — rejected:
   pre-emptively "optimizing" the dot-grid or dvh classes before a profile
   names the hot path (speculative; violates the measurement protocol).
5. **`push()` stays owner-UNFILTERED by design** (F7 refinement while
   drafting): its `remoteById` ownership guard must SEE foreign rows to
   refuse upserting them — a server-side `.eq("owner_id")` there would
   hide foreign rows and resurrect the silent ownership-transfer path.
   Push still slimms to 3 scalar columns (no revisions), which is the
   payload that mattered; only `pull()` gets the server-side owner
   filter (its semantics are "skip foreign", identical server- or
   client-side).
6. **Sync mounts on the app group, not the root layout** (user-approved
   option B): the root mount was a convenience — it gave every route a
   pull+push cycle while the preview/published surfaces are read-only and
   render no sync UI. Rejected: lazy-start (option C — sync only after
   the first local edit) because it delays cross-device downloads until
   an edit happens and keeps the root mount's surprise factor; rejected:
   mounting inside `Playground` because `/ui` → `/ui/[id]` navigation
   would remount and re-run the full cycle per editor hop. The
   `(app)/layout` covers every history-mutating surface with one mount;
   sign-out/end-of-session teardown is already handled by the
   `useEffect([user])` dependency, wherever the engine is mounted.

## Decisions (user, 2026-10-24)

1. Cache model: lightweight fetch-tags now; Cache Components adoption is
   the NEXT plan (056) after this one ships.
2. Staleness: next-request freshness (read-your-own-writes) — tag expiry
   is immediate (`{ expire: 0 }`), never stale-while-revalidate.
3. Sync depth: slim columns + owner filter + two-phase pull (no watermark
   incremental — revisit only with measurements).
4. Issue-2 protocol: investigate → report findings → fix after the
   checkpoint (per protocol; cause is unknown).

## Investigation findings — B (2026-10-24, checkpoint before fix)

Reproduced with the approved protocol (rAF sampling while cycling viewport
sizes via MCP emulation, DevTools open = the reported condition; ~4.6s
windows, identical method across variants):

| variant | emulate calls | avg FPS | max frame gap | frames >100ms |
| --- | --- | --- | --- | --- |
| `about:blank` (DevTools open) | 960 | 119.8 | 25ms | 0 |
| `/probe` (new control: no app CSS, no render engine, 46 nodes) | 793 | **119.9** | 18ms | 0 |
| `/probe` **+ render engine** ("Simple Title" spec, 48 nodes, 30 scripts, 0 stylesheets) | 810 | **119.9** | 17ms | 0 |
| `/en/login` (app CSS, no render engine, 188 nodes) | 11 | 17.0 | 258ms | 21 |
| `/en/imported-spec-…` (app CSS + engine, 64 nodes) | 9 | 10.0 | 200ms | 22 |
| `/en/pokedex` (app CSS + engine, 194 nodes) | 3–4 | 7.1 | 850ms | 6 |
| `/en/pokedex` with app CSS bundle disabled | 424 | **120.1** | 9ms | 0 |
| `/en/pokedex`, DevTools closed (reported baseline) | 504 | 120.0 | 17ms | 0 |

Findings:

1. **Trigger = DevTools open, cause = the app CSS bundle**
   (`[root-of-the-server]__0cbk-n2._.css`), not DevTools: binary split on
   the same page — bundle ON → 8.1 FPS / 817ms; bundle OFF (inline styles
   kept) → 120.1 FPS. All-styles-off → 120.2 FPS.
2. **Content- and engine-independent**: the trivial "Simple Title" import
   (64 nodes) collapses the same way as the full pokedex; the render
   engine on the CSS-less `/probe` (same spec, 48 nodes, 30 scripts) runs
   at **119.9 FPS** — identical to the engine-less probe (119.9) and
   `about:blank` (119.8). With the bundle present the engine amplifies
   (7 vs login's 17 FPS) but without CSS it costs nothing measurable.
3. **Rendering-bound, not script-bound**: Long Animation Frame entries show
   `duration ~830ms, blockingDuration: 0, scripts: []`; Chrome trace shows
   8 consecutive ~966–1022ms main-thread tasks (one per resize) containing
   only `AnimationFrame` instants — style/layout recalculation is the prime
   suspect; images, `dot-grid`, and DOM size are all innocent (ablations).
4. Hypotheses from this plan's scope section: `dot-grid` refuted,
   devtools-emulation-only refuted (`/probe` survives emulation), renderer
   re-layout per frame not corroborated as content-driven; `dvh`-unit and
   remaining CSS rules still open → next step is bisecting the bundle to
   the offending rule(s), **after this checkpoint**.
5. **Production confirmed (2026-10-24, user report + verification)**:
   `bun run build` (dev stopped, `.next` wiped) ships
   `.next/static/chunks/097qi7yql37ag.css` = **3053 KB raw / 230 KB
   gzip**, `@layer utilities` ≈ 3013 KB (~42k minified rules) — the dev
   bloat is not dev-only. `next start` + the same protocol: idle 120 FPS,
   resize-with-DevTools **17.2 FPS / 217ms gaps / 22 frames >100ms**;
   disabling that one `<link>` → **119.9 FPS / 457 calls**. Same culprit,
   milder than dev (dev: 7 FPS / 850ms — unminified 3.6MB + dev runtime).
6. **Causal isolation of the safelist (2026-10-24)**: Tailwind CLI
   ablation of `app/globals.css` — removing the `@source inline` block
   drops the compile 4.0 MB → **172 KB (96% of the CSS is that block)**;
   the `@json-render/shadcn` dist scan contributes only ~27 KB. Live A/B
   on dev `/en/pokedex`, **DevTools open, control arm re-verified first**
   (3 calls / 7.5 FPS / 992ms gap): swapping the 3.6MB bundle for the
   safelist-free compile (same page, same 195 nodes) → **88 calls /
   65.4 FPS / 50ms max gap / 0 frames >100ms**. All-CSS-off remains 120
   (747 calls), so the residual 65 vs 120 is the app's own ~176K CSS;
   the freeze pathology (≈1s stalls) is entirely the safelist mass.
   *Discarded run:* an earlier swap measurement showed 120 FPS but
   DevTools was closed at that moment (user caught it) — invalid, not
   evidence. Context: plan 016 (2026-10-08) explicitly declined slimming
   this block (first-paint + endpoint-failure resilience) and descoped
   payload size (gzip ~232 KB) — that decision predates this stall data.
7. Transient anomaly (not reproducible): one idle sample of the simple
   preview measured a steady 30 FPS with zero long tasks; repeated
   measurements since show 120 FPS on both pages. Recorded for honesty.
8. Control page added for the isolation test: `app/probe/{layout,page,engine}.tsx`
   (own minimal root layout, no `globals.css`, no engine) — keep or delete
   to be decided with the fix. **Resolved by plan 057 scope D (2026-10-25):
   deleted.**
9. **Theme hydration mismatch (2026-10-25, recorded — NOT a 057 regression)**:
   when a visitor's stored theme preference (localStorage, dark) differs
   from a preview page's spec default (light), the client's first render
   applies the preference while SSR commits the spec default → React
   hydration failure on `ThemeSwitcher` (`overrides.tsx:222`, sun vs moon
   `aria-label`/icon), tree regenerated client-side. Pre-existing since
   plan 042's theme persistence; plan 057 can't influence it (CSS curation
   + fetch-skipping only), and the spec-theme e2e only covers the
   fresh-visitor case (no stored decision) so it never fires there.
   **Fix descoped to a future plan (user decision 2026-10-25, "record for
   later").**

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test`
      (sync.test.ts pins: column lists, owner filter, two-phase LWW) —
      format/lint/format:check green, `tsc` exit 0, 647 unit tests pass
      (2026-10-25)
- [x] `bun run build` (dev stopped, `.next` wiped — mistake #23) &&
      `bun run test:e2e` — build clean, **112/112 e2e green** (2026-10-25)
- [x] Live MCP (signed-in): network log on a cold page load shows the
      slim `uis` selects — no `select=*`; payload shrinks (no `revisions`
      in push; pull fetches full rows only for actually-newer ids) —
      verified 2026-10-25: pull = `select=id,owner_id,updated_at &
      owner_id=eq.<me>`, push compare = same 3 columns unfiltered by
      design (decision 5), two-phase full fetch = `select=*&id=in.(4
      unknown-local ids)` only; zero full-table reads
- [x] Live MCP (cache, pending decision): repeat `/en/<slug>` load issues
      no second `published_pages` REST read; publish → immediate fresh
      read if read-your-own-writes was picked — verified 2026-10-25 via
      Supabase `query_logs`: **2 consecutive `/en/pokedex` loads → exactly
      1** `rest/v1/published_pages` read after the marker timestamp;
      freshness (read-your-own-writes) covered by the publish e2e below
- [x] Live MCP (fps): before/after frame-rate sampling during viewport
      cycling on the preview route; the identified hot path is gone (or
      the finding is recorded as "global, not preview" with evidence) —
      **prod `next start`, DevTools open (user-confirmed)**: control
      17.2 FPS / 217ms / 22 frames >100ms → **after plan 057: 64.0 FPS /
      75ms / 0 frames >100ms / 88 resize calls**; hot path = the safelist
      mass (finding 6), cut by plan 057 (197 KB raw / 30.7 KB gzip)
- [x] e2e regression: publish → slug load still serves fresh data under
      the chosen cache model (a stale-cache e2e pin if the model caches) —
      `authed.spec.ts` publish/live-URL + `live-pages.spec.ts` green in
      the 112/112 run (2026-10-25); decision 2's immediate tag expiry
      means no stale-while-revalidate window exists to pin

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-24 | plan drafted (three issues from user report; cache-model decision pending) |
| 2026-10-24 | approved — user answered all four questions: lightweight fetch-tags now + Cache Components as plan 056 next; next-request freshness; slim+filter+two-phase sync; investigate-report-fix for FPS |
| 2026-10-24 | scope +: mount-scoping (option B — move SyncEngine + UploadNudge to the app-group layout; zero sync traffic on preview/published routes), user-selected after the sync.ts explanation |
| 2026-10-25 | **implemented** — fix B shipped inside plan 057 (safelist cut): all six verification boxes ticked with evidence (chain green, 112/112 e2e, live slim-select + cache log proofs, prod FPS 64/75ms/0 with DevTools open); finding 9 (theme hydration) recorded and descoped to a future plan |
