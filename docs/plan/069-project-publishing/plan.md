# Project Publishing and Route Claims (closes F18)

**Status:** approved
**Date:** 2026-10-31

## Goal

Publish a project as one application under a globally unique handle with
multiple entry points, without breaking any existing published URL.

## Scope

### In scope

- Namespace registry as a single module shared by preview and live,
  implementing 062 decision 1 precedence
- Handle claim on publish: globally unique, lowercase, reserved-checked,
  atomic — separate from the name-derived `Project.slug`
- Handle change: reserve new → update routing → keep old as a redirect row →
  an active redirect blocks re-claiming it (no takeover); retention policy
  recorded in the plan when implemented
- Published projection keyed (project_id, route) with per-screen artifacts
- Project runtime: handle → route → screen spec → existing
  `bakeHtmlByLanguage` / `servingArtifact` path; dynamic params seed state
  exactly as preview does (`overlayPathState`)
- Publish validation: home screen set, every route resolves, data configs
  valid, no dangling references (source requirement checklist)
- Cache-tag invalidation for every new writer (decision 5)
- Zero-JS `content` contract preserved per screen (plan 056 F2), static
  routes only (decision 9 that ships in Slice B)

Moved out of scope (recorded as a follow-up, decision 8): featuring a
*project* at the bare root. `site_settings.featured_ui_id` stays screen-only.

### Out of scope

- Custom domains, deployment environments (prod/preview per project),
  BYO credentials

## Design decisions

1. One namespace registry for preview and live — rejected: separate
   namespaces, because there is a single URL space and the source document
   requires one resolution mechanism.
2. Existing `published_pages` slugs keep resolving unchanged, and a handle
   can never collide with them (shared unique constraint) — rejected:
   migrating old slugs under handles, because it breaks every URL already
   shared.
3. Per-screen artifacts reuse the existing bake/classify path — rejected:
   one monolithic bundle, because it breaks the per-screen zero-JS contract
   and cache granularity.
4. Redirect rows are exclusive: an active redirect blocks re-claiming the
   value, and a handle change never silently drops the old entry point.
5. Every new writer invalidates tags through the same helper — rejected:
   ad-hoc revalidate calls, because the `cache-invalidation-writers` lesson
   exists for exactly this.
6. Published state lives on the project (`status`) plus entry-point rows —
   rejected: deriving state from row existence, because unpublish must be
   atomic across routes.

## Scope guard (run 2026-11-04 against `dab5869`)

- **F1 — `published_pages` cannot express a route tree.** It is keyed by
  `ui_id` (one row per screen) with `slug` globally unique, `spec`, `version`
  and per-language `artifacts`. A project needs several routes pointing at
  screens, so it needs its own projection table (working name
  `published_entry_points`: project_id, screen_id, route, spec, version,
  artifacts, per-entry state) — screens stay the unit of content.
- **F2 — decision 2's "shared unique constraint" is not expressible.** Two
  tables cannot share a UNIQUE; a handle in `projects.handle` would happily
  collide with an existing `published_pages.slug`. The only way to keep one
  arbiter is a claims table (`route_claims.value` primary key, owner, kind),
  backfilled from today's published slugs, written by both publish paths.
  Without it, decision 2 is unimplementable as written.
- **F3 — preview project routing is client-side from localStorage.**
  `app/[locale]/[slug]/preview-client.tsx` resolves the project with
  `projectBySlug` and `resolveProjectRoute` over the local history store, and
  deliberately 404s a path when nothing local matches ("projects are
  device-local and publishing a namespace is follow-up F18"). The live path
  must resolve server-side. Good news: `projects` and `project_screens` are
  already synced (064/065), the resolution helpers in
  `lib/projects/screen-routes.ts` are pure and row-injected, and
  `overlayPathState` already seeds dynamic params — so the work is a server
  row source, not a second resolver.
- **F4 — the featured root is screen-only.** `site_settings.featured_ui_id`
  references `published_pages.ui_id` (`on delete set null`); there is no slot
  for a project handle. Featuring a project needs a schema change plus root
  serving semantics; Q2 asks whether that ships here or becomes a follow-up.
- **F5 — the cache tag allowlist is closed.** `PROJECTION_TABLES` in
  `lib/supabase/projection-cache.ts` is `["published_pages", "site_settings"]`
  and `sanitizeTags` silently drops anything else, so a new table that is not
  added there (and in `e2e/db.ts` writers) gets no invalidation at all — the
  exact failure mode the `cache-invalidation-writers` lesson documents.
- **F6 — bare handles have no rule.** `/{locale}/{handle}/{route}` already
  routes through `[slug]/[[...route]]`, but a bare `/{handle}` is decided by
  `resolveRootServing` in `proxy.ts`, which only knows published slugs and
  canonical language tags. A bare handle needs an explicit decision
  (recommendation: 307 to `/{default}/{handle}`, mirroring slugs).
- **F7 — the handle is not `projects.slug`.** `projects.slug` is per-owner
  (`unique (owner_id, slug)`) and re-derived on rename; the handle is global
  and stable across renames, so it needs its own column and unique index.
  Also, 062 F1 is still open: `uniqueSlug()` never consults `RESERVED_SLUGS`,
  and that list is now five entries (`ui`, `admin`, `login`, `signup`,
  `user`) — claims must check it before hitting the DB.
- **F8 — zero-JS is per published page today.** `servingArtifact(page,
  locale)` keys artifacts by language only, and the static-serving branch in
  `[slug]/[[...route]]` serves a single page's artifact. Per-route baking
  needs `(project, route, language)` artifacts, and a route with dynamic
  params cannot be baked ahead of time.
- **F9 — validation already half-exists.** `validateDataSources` plus the 067
  capability gate cover "data configs valid"; a project validator should call
  them instead of adding a second checker. `projects.home_screen_id` is
  nullable (`on delete set null`), so publish must refuse an unset home.

## Tasks

**Slice A** — tasks 1, 2, 3, 4, and the Slice-A halves of 6.
**Slice B** — task 5 and the bake/validation halves of 4 and 6.

### 1. Schema and claims (db/)

- [x] `route_claims(value text primary key, owner_id, kind, project_id)` with
      `kind in ('handle', 'screen', 'redirect')`, **backfilled from the
      existing `published_pages.slug` rows** (decision 2 / F2 — without it a
      new handle could take a value a live screen already serves), plus the
      trigger/upsert path so a screen publish also claims its slug
- [x] `projects.handle` + unique index, `projects.published_at`; keep
      `projects.slug` untouched (F7)
- [x] `published_entry_points` (project_id, route, screen_id, spec, version,
      artifacts, unique (project_id, route)) with world-readable SELECT for
      published projects only, owner-scoped writes (F1)
- [x] `route_redirects(from_value pk, project_id, owner_id)` — exclusive
      claims (decision 4)
- [x] RLS + grants per the file pattern; run `db/README.md` inventory counts
      (13 tables / 38 policies / 12 functions; `docs/security/rls-audit.md`
      inventory + addendum updated)
- [x] `PROJECTION_TABLES` gains `published_entry_points` (and the claims table
      if it is served) — otherwise invalidation silently no-ops (F5);
      `route_claims` is read through the RPC only, so it needs no tag

### 2. Namespace registry (lib/routes/)

- [x] One registry module implementing 062 decision 1 precedence: app
      segments > `/user` > claimed handles > published slugs > local entry
      slugs, with `RESERVED_SLUGS` consulted before any DB claim (F7) —
      **the reserved rung answers first on BOTH surfaces** (a local entry
      named `admin` never outranks `/admin`)
- [x] Precedence unit matrix over every claimant pair, ties included
      (all 8 claimant subsets × live/preview + a tie per app segment;
      mutation-checked: flipping the order or dropping the reserved rung
      each fail the matrix)
- [x] Claim paths (screen publish, project publish, rename) consult the
      registry, not each their own query — **screen publish + rename done**
      (`isReservedRoute` + the `route_available` probe, decision 11); the
      project-publish handle path landed with task 3's flow
      (`isReservedRoute` + `route_available(handle, handle)` in
      `components/publish/publish-site-dialog.tsx`)

### 3. Claim, change, redirect

- [x] Project publish: handle claim (atomic, lowercase, reserved-checked),
      snapshot of every entry point + home screen, `projects.status =
      'published'` (decision 6) — `publishProject` in
      `lib/publish/project-publish.ts` (entry points upserted → stale
      routes deleted → one `UPDATE projects` that claims the handle and
      flips status, decision 15); snapshot precedence in
      `buildProjectEntryPoints` (slug rung → configured pattern → `''`
      home; the `id` rung is preview-only and never published)
- [x] Handle change: claim new → rewrite entry points → old value becomes a
      redirect row; an active redirect blocks a foreign claim (decision 4) —
      claim + redirect ride the same `UPDATE projects` via the
      `claim_project_handle` trigger (task 1); **no entry-point rewrite is
      needed**: route values are handle-relative, so the snapshot from the
      publish that precedes the change already serves under the new handle.
      Covered by a `handleTaken` mapping in `publishProject` + unit tests
- [x] Unpublish: one transaction-ish sequence that clears entry points and
      redirects for the project and flips `status`, so no route half-serves
      — `unpublishProject` deletes entry points → deletes `route_redirects`
      (owner DELETE policy added at decision 16) → flips `status`, and
      keeps the handle claim (decision 14)

### 4. Live project runtime

- [x] Server resolution in `app/[locale]/[slug]/[[...route]]/page.tsx`:
      handle → entry point → screen spec — `live_project` RPC (decision 17,
      replaces the F3 `projects`/`project_screens` read; amended by
      decisions 17/18) → `getPublishedEntryPointsFrom` explicit-column
      snapshot read → `resolveLiveRoute` in `lib/publish/live-routes.ts`
      (mirrors `resolveProjectRoute` precedence: home rung, exact, dynamic;
      reuses `matchRoutePattern`)
- [x] Dynamic params seed state through `overlayPathState` exactly as
      preview — the server's match params ride the `liveProject` prop and
      initialise `pathParams` before SSR; local resolution overwrites them
      with its own captures when the device holds the project
- [x] Redirect resolution for a changed handle (permanent, one hop) —
      `permanentRedirect(/{locale}/{handle}{suffix})` when
      `live.handle !== slug`; `live_project` only answers published
      projects, so a dark site never receives a redirect hop
- [x] Bare `/{handle}` rule in `proxy.ts` / `resolveRootServing` (F6) — the
      injected callback is now "published slug OR live handle exists"
      (`publishedSlugExistsFrom` short-circuits before the `live_project`
      RPC), in `proxy.ts` and as defence-in-depth in `app/[locale]/page.tsx`
- [x] Publish validation: home set, every membership route resolves, data
      configs valid via the existing checkers (F9) —
      `lib/publish/validate-project.ts` (`validateProjectPublish`, decision
      20) runs first inside `publishProject` (zero writes on an issue),
      dialog toasts the issue code (4 new en/es keys)

### 5. Bake and cache

- [x] Per-route artifacts keyed (project, route, language); static routes
      bake at publish, dynamic-param routes client-render (F8, Q3)
- [x] Every new writer invalidates through `revalidateProjection` and the
      `PROJECTION_TABLES` allowlist (F5, decision 5)

### 6. Tests

- [ ] Unit: registry precedence matrix, atomic claim, redirect exclusivity,
      server route resolution incl. dynamic segments and 404 cases
- [ ] e2e: project publishes → home, static, dynamic and 404 routes resolve
      live; a second project is unaffected; a handle change redirects the old
      URL; a pre-existing published slug still serves
- [ ] Cache revalidation observable; full gate

## Verification

- [ ] `bun run lint && bunx tsc --noEmit && bun run test`
- [ ] `bun run test:e2e` full suite green
- [ ] Canary: an anonymous visitor resolves every published route of the
      project and cannot read another project's drafts or entry points
- [ ] A pre-069 published screen slug still serves byte-identically

## Decisions taken (approved 2026-11-04)

1. **Two slices inside 069** (Q1). Slice A: route claims, handle claim,
   publish, server-side live resolution (client-rendered), unpublish,
   redirects, e2e. Slice B: per-route zero-JS bake, validation polish.
   Each slice ends at a green gate and its own commit.
2. **The featured root stays screen-based** (Q2). A project serves at
   `/{locale}/{handle}`; "feature a project" is recorded in
   `docs/follow-ups.md` as F20, not implemented here (see F4).
3. **Bake static routes only** (Q3). Static routes keep the zero-JS contract
   per `(project, route, language)`; a route with `{param}` segments always
   client-renders with state seeded from the path. Slice B.
4. **Redirects are retained indefinitely** (Q4). A redirected value stays
   reserved for its owner and cannot be claimed by anyone else; the owner
   may reclaim it. No timers, no cleanup job.
5. **Entry points snapshot** the screen spec + version at publish (Q5, the
   user skipped the question and the recommendation stands): editing a
   screen after publishing changes nothing live until the next publish, the
   same contract `published_pages` already has.
6. **Claims are arbitrated by one table** (F1/F2). `route_claims.value` is
   the primary key; screens and handles both insert there before writing
   their projection, so decision 2's cross-table uniqueness becomes one
   constraint.
7. **Live project resolution reads the synced rows** (F3): `projects` +
   `project_screens`, reusing the pure helpers in
   `lib/projects/screen-routes.ts` and `overlayPathState`. No second
   resolver, no client-only fallback for anonymous visitors.
8. **A bare `/{handle}` redirects** to `/{default}/{handle}` through
   `resolveRootServing`, mirroring today's slug sugar (F6).
9. **The projection allowlist grows or nothing invalidates** (F5):
   `PROJECTION_TABLES` gains the new projection table in the same change as
   the first writer.
10. **A same-owner, different-kind collision is REFUSED** (Q1, 2026-11-04).
    A value already claimed as a project handle cannot become a screen slug
    and vice versa — by anyone, including the owner (23505). The single
    same-owner conversion kept is `redirect` → live (decision 4's "the owner
    may reclaim it"). Rejected: letting the owner flip the kind, because
    precedence (`handle > published slug`) would leave a published screen URL
    permanently unreachable while `route_claims` and `projects.handle`
    disagree about what the value is.
11. **One availability probe: `route_available(p_value, p_kind)`** (Q2,
    2026-11-04). The publish dialog stops reading `published_pages` for
    takenness and asks the arbiter, passing `screen` or `handle`. A claim is
    blocking unless it is the caller's **own claim of the same kind** (so a
    republish / handle re-check still reads "available"); a foreign claim or
    the caller's other kind reads "taken" — exactly what the trigger then
    enforces. Rejected: keeping the `published_pages` probe for screens,
    because two sources of takenness disagree (a handle-held value reads
    "available" and the publish dies at the trigger), which is the
    "each their own query" the plan's task 2 rejects. Requires the 069
    migration to be applied to the live project first.
12. **The publish affordance lives on the project group header in the
    history drawer** (Q3a, 2026-11-04) — beside the existing rename/delete
    buttons (`components/history-drawer.tsx`), with a Live badge when
    published. Rejected: the workspace panel header, because it is only
    visible when the panel is expanded, and "both surfaces", because it
    doubles the i18n and e2e surface for no new capability.
13. **`status` / `handle` are read on demand from the DB, never modelled
    locally** (Q3b, 2026-11-04). A small explicit-column reader
    (`getProjectPublishState`) answers when the drawer/dialog needs it.
    Rejected: adding the fields to `Project` + the sync spec — `status` is
    deliberately a server-side fact (`lib/history/sync.ts` drops it on push
    and `projectToRow` refuses to stamp it), and a client-writable status
    would let a device flip its own project live without the claim path.
14. **Unpublish keeps the handle claim reserved for its owner** (Q3c,
    2026-11-04). Entry points and redirect rows are cleared and `status`
    flips to `draft`, but the `route_claims` row stays: the owner's URL
    cannot be squatted while they are offline, and republish reuses it.
    Rejected: releasing the claim, because another account (or a screen
    slug) could permanently take a URL that used to be this project's.
15. **No new RPC — the client sequence is ordered fail-closed** (2026-11-04).
    Because `published_entry_points` SELECT is gated by
    `project_is_published(project_id)`, publishing writes the entry points
    *before* the status flip and unpublishing deletes them *before* it —
    a failure midway leaves the site dark, never half-serving. The claim
    itself cannot half-land: `claim_project_handle` runs inside the same
    `UPDATE projects` statement. Rejected: a `publish_project()` RPC, for
    an atomicity the ordering already provides (KISS), at the cost of a
    function + grants + audit rows + a live migration.
16. **`route_redirects` gets an owner DELETE policy**
    (`route_redirects_delete_own`, 2026-11-04). Task 3's unpublish clears
    the project's redirect rows, but the table shipped (task 1) with RLS on
    and SELECT only — the DELETE would have matched 0 rows and unpublish
    would silently leave redirects serving. Owner-scoped
    (`owner_id = auth.uid()`), matching the `published_entry_points` write
    pattern. Rejected: a definer function or doing nothing, because the
    rows are the owner's claim artefacts and the same owner DELETE shape
    already exists elsewhere. Counts move: `db/README.md` 38 → 39 policies
    (live 42 → 43), 069's policy count 5 → 6.
17. **Handle → project is a SECURITY DEFINER RPC `live_project(p_value)`**
    (Q4a, 2026-11-04). One function answers serve-or-redirect: the published
    project whose `handle = p_value`, else the published project behind a
    `route_redirects.from_value = p_value` row; `handle <> p_value` is how
    the caller detects the redirect. Rejected: a public SELECT policy on
    `projects` (`status = 'published'`), because it would newly expose every
    published project's full row — including `state` (the author's shared
    session, which SSR deliberately never seeds for visitors) and
    `owner_id` — to anonymous REST; and a `published_projects` projection
    table, because it duplicates a value the arbiter already owns for a
    cache we do not need at this traffic shape. `projects` stays owner-only
    and `route_claims` stays policy-less (reads keep going through a definer
    function, like `route_available`).
18. **The live surface serves the `published_entry_points` snapshot**
    (Q4b, 2026-11-04) — amends decision 7's row source. `project_screens` /
    `projects` stay the *publish-time* source (`buildProjectEntryPoints`);
    the live spec comes from the snapshot, so an edit never goes live before
    the next publish (decision 5) and no new read policy on `project_screens`
    is needed. Rejected: reading the synced rows live, because it contradicts
    decision 5 and widens RLS for no capability gain.
19. **An unmatched path under a published handle is a real 404**
    (Q4c, 2026-11-04): the server calls `notFound()` when the handle exists
    but no entry point matches. Rejected: the 200 + client not-found panel
    the slug path uses, because a live site's unknown URLs should carry a
    real status for crawlers and for task 6's "404 routes resolve live"
    check; the slug path keeps its existing behavior (unchanged).
20. **Publish validation hard-blocks all three checks before any write**
    (Q4d, 2026-11-04): home set (`projectHomeScreenId`), every membership's
    screen present + its configured route pattern well-formed, and
    `validateDataSources(spec, { inProject: true })` per entry point (F9 —
    the existing checkers, no second validator). Any issue answers
    `{ ok: false }` with an issue code and the dialog toasts it; zero rows
    are written (fail-closed, same as decision 15). Rejected: warn-only,
    because a missing home 404s the bare namespace the moment the site goes
    live.
21. **The bake runs client-side, in the dialog, right after the publish
    succeeds** (Q5a, 2026-11-05). `publishProject` threads the baked-source
    rows (`route, spec, version`) onto its success result and the publish
    dialog fires the project bake `void …` — best-effort, mirroring
    `go-live-dialog.tsx` and `bakeAndPersistArtifacts`. Rejected: a
    server-side bake, because the HTML render half (`lib/publish/bake.tsx`)
    is client-side React and restructuring it contradicts decision 3's
    "reuse the existing path"; the bake is best-effort either way, so the
    cheaper placement wins.
22. **One `/api/tailwind` call per static route, sequential** (Q5b,
    2026-11-05). Each route's artifact carries only the CSS its own spec
    needs, and the screen bake pipeline is reused verbatim per entry point.
    Rejected: one combined call for the whole project, because every
    artifact would carry the union CSS and diverge from the per-screen
    shape `lookupArtifact`/`servingArtifact` serve.
23. **The live case gets the `precovered` identity check too** (Q5c,
    2026-11-05): `spec === liveProject?.spec` joins `spec ===
    published?.spec` in `preview-client.tsx`, and the page passes the SAME
    spec object reference (from the matched `published_entry_points` row)
    into the client props, so the check is a reference identity that actually
    matches. An owner's local entry keeps `spec` pointing elsewhere, so the
    runtime compile never skips for a spec the bake does not cover.
    Tested, because a reference mismatch would silently disable the
    optimization instead of erroring.
24. **The live handle page serves the artifact's CSS + `precovered` seeding,
    nothing more** (task 5, 2026-11-05): `bakedCss` flows into the existing
    `<style>` injection. The `kind === "content"` static-HTML branch stays
    on the root page only — it is a published-PAGES surface (plan 056 F2's
    per-screen contract). Rejected: extending the static branch to handle
    routes in this plan — a zero-JS handle route needs its own page-level
    decisions (status code, caching, metadata) that Slice B's preview did
    not cover; it would be a new surface, not the reuse decision 3 asks for.

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-31 | plan drafted (F18 claimed here) |
| 2026-11-04 | scope guard run: F1–F9 recorded, tasks rewritten against `dab5869`; Q1–Q5 opened (claims table replaces the impossible cross-table unique, live resolution moves server-side, featured root and dynamic-route bake need decisions) |
| 2026-11-04 | approved — Q1 two slices, Q2 root stays screen-based (project featuring becomes F20), Q3 static routes bake / dynamic routes client-render, Q4 redirects retained indefinitely; Q5 skipped, snapshot-at-publish stands. Decisions 7–9 added (claims table, server row source, projection allowlist) |
| 2026-11-04 | Task 1 implemented (schema, RLS, grants, README/audit inventory, projection allowlist); Task 2 registry + precedence matrix green (10 tests, mutation-checked). Decisions 10–11 added: same-owner different-kind claim collision REFUSED (redirect reclaim only) and `route_available(value, kind)` replaces the `published_pages` takenness probe |
| 2026-11-04 | Task 2 done: registry wired into every claim path that exists today (go-live dialog, rename popover, `uniqueSlug`/`projectNameError`), `isSlugAvailable` switched to the `route_available` RPC with a `PublishClient.rpc` seam; live DB verified by a 17-assertion DO block (A1–A9 claims/refusals/redirects, B1–B8 probe matrix, fixture cleanup) — also caught and fixed the BEFORE-trigger FK bug (`projects_claim_handle` → AFTER). Gate: lint 0, tsc clean, 998 unit pass / 0 fail. The project-publish handle path stays open until task 3 |
| 2026-11-04 | Task 2 **verified**: targeted e2e green (`live-pages › reserved slugs`, `authed › publishes an entry and serves its live URL` — the latter proves the live `route_available` RPC because the probe fails closed), then **full e2e 144 passed / 0 failed** on a fresh server. The run surfaced a pre-existing 068 race (`ClaimForm` painted claim-mode before the profile load settled → a returning user's own handle read "taken"); fixed app-side by gating the dialog on `loading` — **outside 069 scope, committed separately as `fix(auth)`**. Also observed one known parallel-load flake in `catalog.spec.ts` (20 s `waitForRemoteProject` gate; green in isolation and in the next full run) — not raised, not a 069 regression |
| 2026-11-04 | Task 3 implemented: `lib/publish/project-publish.ts` (explicit-column state reader, `buildProjectEntryPoints`, fail-closed `publishProject`/`unpublishProject`), `components/publish/publish-site-dialog.tsx` (load-phase gated, lowercase + `isReservedRoute` + `route_available(handle, handle)`, `handleTaken`), `components/publish/slug-status.ts` shared with the go-live dialog, history-drawer Globe button + Live badge, 10 en/es keys. Decisions 12–15 (affordance, on-demand reads, unpublish keeps the claim, no-RPC ordering) and **decision 16** (`route_redirects_delete_own` — the table was SELECT-only, so unpublish's clear would have hit 0 rows) added; live migration applied (14 tables / **43** policies / 13 functions) and `db/README.md` + `rls-audit.md` counts bumped. **23 new unit tests** (`project-publish.test.ts`: op-order, version bump, stale-route scope, handleTaken, no-`handle` unpublish payload, explicit columns) → gate 1021 pass / 0 fail, **full e2e 144 passed / 0 failed** |
| 2026-11-04 | Task 4 implemented: `live_project` SECURITY DEFINER RPC (decisions 17, applied to live DB — 14 functions, ACL anon/authenticated/service_role, 5-assertion DO probe green with cleanup), `lib/publish/live-project.ts` + `live-routes.ts` + `validate-project.ts`, slug-first page/metadata read (share-cached slug short-circuits the RPC), `permanentRedirect` hop, `resolveRootServing` "slug OR handle" in proxy + root page, validation-first `publishProject` with 4 dialog issue toasts (en/es), `liveProject` prop through `preview-client.tsx` (live visitors namespace by **project id** — the supabase adapter partitions on `app_id`). Decisions 17–20 added. **34 new unit tests** → gate 1055 pass / 0 fail; full e2e after wiping stale `.next`: **144 passed / 0 failed** (runs 1/5 green; runs 2–4 were known parallel-load/cold-cache flakes, each green in isolation — timeouts NOT raised per mistake #32) |
| 2026-11-05 | Task 5 **approved** — preview drafted from the session-previous task-5 research; Q5a client-side dialog bake, Q5b one `/api/tailwind` per static route, Q5c live `precovered` identity (decisions 21–23); decision 24 pins the serving scope (CSS + `precovered`, no static-HTML branch). Session memory slimmed to ~160 lines with an enforced trim rule |
| 2026-11-05 | Task 5 **implemented**: `bakeProjectEntryPoints` + `isStaticRoute` in `bake-client.ts` (shared `bakeSpecArtifacts` core with the screen bake), `/api/publish-artifacts` project branch (version-guarded `published_entry_points` UPDATE + `revalidateTag("published_entry_points", { expire: 0 })` beside the write), `publishProject` threads `baked` rows, reader gains `artifacts, version`, live page serves the version-guarded artifact's CSS, `precovered` live identity. Unit gate green, e2e deferred to task 6 |
