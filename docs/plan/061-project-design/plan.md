# Project Design (Multi-UI System) — Implementation Plan

**Status:** implemented
**Date:** 2026-10-29

## Goal

Roadmap **F15** v1: give the playground a **project** concept so one app can be
built from several screens instead of one flat list of unrelated designs.
Three pieces: **A1 organization** (a project groups its screens),
**A2 screen navigation** (a spec-driven `navigate` action jumps to a sibling
screen), and **A3 shared data/state** (the screens of one project see the same
records and session values). The flow-canvas board (A4) stays deferred until
A1–A3 exist, per the 2026-10-27 roadmap decision.

## Scope

### In scope

- **A1 — project entity**: `Project { id, name, createdAt, updatedAt }`,
  `HistoryEntry.projectId`, a project store (`lib/projects/`) following the
  module-store pattern (`templates.ts`/`device-preview.ts`), and a UI to create/
  rename/switch projects and see the history grouped by project.
- **A2 — `navigate` action**: a `navigate` action in `playgroundCatalog.actions`
  (so it prints into the generation prompt), an app handler that resolves a
  **screen ref** (id → slug → in-project name) to a route and pushes it —
  `/ui/<ref>` in the editor, `/<locale>/<slug>` on preview/live surfaces — plus
  the editor affordance to author the binding (sibling-screen picker).
  **Scope extension (2026-10-29)**: the action also carries **params** (e.g.
  `id: {"$item": "id"}`, pre-resolved by the renderer at click time) appended
  as **path segments**, and projects get a **route namespace**:
  `/{locale}/{project-slug}` → project home screen, `/{locale}/{project-slug}/
  {segment}` → in-project route resolution (exact screen slug first, then a
  screen's spec-level `route` pattern like `"{id}"` binding the segment into
  the target's state seed), so a detail screen loads the right record by id.
- **A3 — shared data/state**: a **project-scoped data namespace**
  (`QueryLoader namespace = projectId` → `genui-data:{projectId}:…` /
  `genui_records.app_id = projectId`) **plus a shared `/session` subtree** — the
  project store holds a `state` object seeded into every screen (merged under
  `/session`) and written through on change, so a value set on screen A is
  readable on screen B. Data-block declarations stay per spec (Q2 answer).
- **Prompt teaching**: catalog action description + a rule block (same shape as
  `DATA_SOURCE_RULES`) so the model binds `navigate` only when sibling screens
  exist and knows where shared state lives.
- **Tests**: unit (store, ref resolution, namespace/data-block merge, sync merge
  preserving `projectId`) + e2e (2 screens in a project → navigate action lands
  on the sibling → shared record visible from both) + MCP spot-check per step.

### Out of scope

- **A4 flow canvas** (React Flow board of screen artboards) — F15 defers it until
  A1–A3 exist (roadmap decision 2026-10-27)
- **Cross-device project sync / supabase `projects` table + RLS** — local-only
  in v1 (Q1 answer 2026-10-29, F14 precedent: visitor-level first); follow-up
  **F17**
- **Publishing a project (multi-screen site, cross-page nav)** — publish stays
  per-screen exactly as today, `published_pages` PK is `ui_id` (Q4 answer
  2026-10-29); follow-up **F18**
- **Project-level data block declarations** (blocks moved off the spec onto the
  project) — declarations stay per spec in v1; the namespace is what is shared
  (Q2 answer 2026-10-29)
- **Cross-project navigation / global screen registry** — a screen ref resolves
  inside its own project only (descoped 2026-10-29)
- **Undo/redo across screen changes** — revisions remain per entry; navigation is
  a route change, not a spec edit (descoped 2026-10-29)

## Design decisions

1. **Projects are local-first entities mirroring the templates store** —
   module store + `localStorage` + SSR-safe defaults, `HistoryEntry.projectId`
   optional (entries without one group under a legacy "no project" bucket).
   Decided Q1 (2026-10-29). — rejected: supabase `projects` table with RLS + a
   second sync loop, because it roughly doubles the plan's surface (migration,
   RLS, LWW merge) for a grouping feature — follow-up **F17**; rejected:
   server-first, because a fresh anonymous visitor would have no projects.
2. **`navigate` is a first-class catalog action with a screen-ref param** —
   `{"action": "navigate", "params": {"screen": "<ref>"}}`, resolved by an app
   handler (`registerHandler`/`handlers` memo, the same seam as
   `switch_language`/`data_read`). — rejected: json-render's
   `onSuccess: {navigate}` + the `JSONUIProvider navigate` prop (it exists but
   takes a raw path the model cannot know before publish), because paths are
   locale- and surface-specific while a ref resolves at click time; rejected:
   built-in `push`/`pop` (they only write `/currentScreen` inside one spec and
   are never printed to the model).
3. **The prompt lists sibling screens when they exist** — for an *edit* or an
   *add-screen* run inside a project that already has screens, the user prompt
   carries their `{ref, name}` pairs, so the model can bind real targets;
   on a fresh project the action is simply not offered. — rejected: always
   emitting a `navigate` action with a guessed ref, because an unresolvable ref
   silently no-ops.
4. **Unknown ref fails loud in the editor, silent-but-logged on live surfaces** —
   `console.warn` everywhere, plus a non-blocking toast in the editor. —
   rejected: throwing (it would break an otherwise valid screen over one stale
   link).
5. **Shared data = project-scoped namespace; shared state = a `/session`
   subtree** — the runtime namespace (`QueryLoader namespace`) becomes the
   project id, so two screens' `genui-data:{projectId}:{collection}` rows and
   `genui_records.app_id` coincide with **zero adapter changes**; the project
   store additionally holds a `state` object that is merged into each screen's
   initial state under `/session` and written back on change (debounced), so
   screen-local state (form drafts, `/page`) stays per screen while
   `/session/cart` etc. survives navigation. Decided Q2 (2026-10-29).
   **Mechanism revised 2026-10-30 (061-4 as-built, Next 16 `<Activity>`)**:
   seeds **omit** `session` (`omitSessionState`) — a render-time store read
   applied after a fresher write lands would re-add a stale value (proved by
   the e2e race) — and `<SessionSync>` is the sole bridge: a pre-paint
   layout-effect store→state pull (mount / screen change / Activity re-show +
   a store subscription for writes landing elsewhere), a declared-first
   debounce that arms only local changes (echo guard), and a stamp-guarded
   hide-flush (`setSessionState` rejects any stamp not strictly newer than
   the last accepted write). —
   rejected: project-level data block declarations (blocks move off the spec),
   because it touches generation, validation and the renderer path — the
   namespace alone already shares the rows; rejected: one `StateProvider` across
   screens, because every route change remounts the provider (each surface owns
   an uncontrolled store seeded from `initialState`).
6. **Editor authoring = a "Navigate to screen" action tile with a sibling-screen
   `<select>`** — writes `{"action":"navigate","params":{"screen":"<id>"}}` (the
   ref, never a path). Shipped in v1 (Q5 answer 2026-10-29). — rejected: free
   text, because refs are known at authoring time and free text is how stale
   links happen; rejected: prompt-only, because every nav retarget would need a
   steers run.
7. **Project UI lives in existing chrome: history-drawer grouping + a top-bar
   switcher** — no new route (Q3 answer 2026-10-29). — rejected: a `/projects`
   route with sidebar entry, because it is A4-lite (a second screen to build,
   test and i18n); rejected: drawer-only, because switching projects would cost
   a drawer round trip every time.
8. **Publishing is untouched in v1** — per-screen publish, per-screen slug (Q4
   answer 2026-10-29); multi-screen go-live recorded as follow-up **F18**. —
   rejected: whole-project publish, because it drags in routing,
   `proxy.ts` `APP_SEGMENTS`, artifacts and the featured pointer — a different
   plan's worth of work on its own.
9. **Project route namespace = `/{locale}/{project-slug}` with spec-level
   `route` patterns** (added 2026-10-29, scope extension): the project slug
   (derived from the name — "Pokédex app v2" → "Pokédex") names the namespace,
   the project's home screen serves the bare segment, and a screen declares a
   top-level `route: "{id}"` (same extension style as `urlSync`) so
   `/en/pokedex/4` matches it and seeds `state./id = "4"` before mount — the
   declared `get` query then fetches the record. `navigate` params ride the
   existing dispatch pipeline: `emit` pre-resolves `$item`/`$state` with the
   repeat scope (proven in `@json-render` core/react sources), the handler
   derefs `/`-leading paths like `resolveRecordId` already does. Editor keeps
   `/ui/<ref>[/<param>]`. — rejected: query params (`?id=4`), because the
   requested URL shape is path-style `/pokedex/{id}`; rejected: one spec with
   conditional grid/detail views, because the detail is a separate screen with
   its own spec; rejected: `/{locale}/{screen-slug}` sub-routes, because screen
   slugs are flat (no `/`) and per-screen publishing (056) already owns that
   namespace. Decided with user sign-off on locale prefix (`/en/...` kept),
   slug rename, and step order (params+routes before shared data).

## Step breakdown (commit per step)

1. **061-1 — project entity**: `lib/projects/projects.ts` store, `projectId` on
   `HistoryEntry`, drawer grouping + top-bar switcher, en/es keys, unit tests
2. **061-2 — navigate**: catalog action + prompt rule (sibling screens listed in
   the user prompt), ref-resolution helper, handler on every surface
   (editor/preview/live), editor action tile with sibling select, unit tests
3. **061-3 — navigate params + project routes**: `navigate` params (extras
   pre-resolved at dispatch, `$item` paths deref'd against state), spec-level
   `route` pattern + `overlayPathState` path-param seeding, project `slug` +
   home screen (rename "Pokédex app v2" → "Pokédex"), route resolution on
   editor (`/ui/<ref>/<param>`) and preview (`/{locale}/{project-slug}[/{route}]`),
   editor tile "send record id" toggle, hand-crafted PokéAPI detail spec as
   the demo target (cards → detail with per-card id), unit tests + MCP
4. **061-4 — shared data/state**: `QueryLoader namespace = projectId`,
   `/session` seed + write-through, e2e, full verification chain + MCP spot-check

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test` (061-4: 839 unit / 0 fail)
- [x] Unit: project store CRUD + hydration fallback; ref resolution order
      (id → slug → in-project name) incl. unknown ref; `projectId` survives the
      sync merge (`rowToEntry`/`applyRemoteEntry` never drop it); namespace/data
      merge behavior for A3 — all green; 061-4 added `session-state.test.ts`
      (`omitSessionState`, `dataNamespaceFor`), project-store session tests
      (write-through + persistence, seed-echo write-count no-op, junk-state
      hydration, `createProjectEntry` stamping) and a recency test ("stale
      stamps are rejected — only strictly newer writes land")
- [x] e2e: create a project → generate 2 screens into it → group visible in the
      drawer → author/bind a `navigate` action → activating it routes to the
      sibling screen → shared record written on screen A is readable on screen B
      → reload keeps the grouping — `e2e/project-session.spec.ts` (switcher
      creates the project; mocked generation + JSON import seed the 2 screens;
      drawer groups both with `projectId`; the generated `navigate` binding
      routes A→B; B reads the `/session` token and the
      `genui-data:{projectId}:` record while screen-local `/draft` does not
      cross; bump→back inside the debounce window converges on the newer value;
      reload keeps grouping + selection)
- [x] e2e: existing suite stays green (every entry without a
      `projectId` must behave exactly as before) — 127 passed (exit 0) with
      `E2E_USER_EMAIL`/`E2E_USER_PASSWORD` exported; a first run without them
      failed 4 Supabase-provider tests that passed in isolation and in the
      rerun (batch quota/race, lesson `e2e-auth-quota`); **re-run after 061-4
      (2026-10-30): 128 passed / exit 0** (127 + the new spec)
- [x] Unit/e2e: `/session` values survive a screen change (seeded from the
      project store, written back on change) while screen-local state does not;
      the navigate action tile writes a ref and routes to the sibling — the
      e2e covers the session/local split and both directions of the bridge; the
      tile's ref-writing was verified in 061-2 (MCP: binding written, canvas
      click routes)
- [x] MCP spot-check per step (create/switch project, navigate live, shared data
      visible on both screens), console clean — 061-4 (chrome-devtools, seeded
      project "Spot Sync"): Save on A lands `{token: shared-42}` in the project
      store, `Add note` writes `genui-data:spot-proj:notes`, navigate routes
      `/en/ui/spot-a` → `/en/ui/spot-b`, B reads the shared token and the
      `spot-note` record (count 1), bump→back inside the debounce window leaves
      BOTH the restored screen and the store at `b-v2` (visibility-scoped reads
      — the hidden prerendered route twin renders a second copy, plan 059 T1),
      console 0 errors / 0 warnings
- [x] 061-3: `/{locale}/{project-slug}` serves the home screen;
      `/{locale}/{project-slug}/{id}` seeds `/id` and the detail query fetches
      that record; a card click carries the per-card id (`$item`) and lands on
      the detail; editor `/ui/<ref>/<param>` mirrors it; screens without a
      project/route behave exactly as before — MCP (chrome-devtools, seeded
      project "Pokédex"): bare → home, `/4` and `/999` render their id on the
      same detail screen, in-project slug beats the pattern, unmatched path →
      not-found gate, unknown namespace → not-found, flat `/en/detail/4`
      seeds, editor `/ui/detail1/4` renders `4` while bare `/ui/detail1`
      renders the spec default, card click → `/en/pokedex/25` → detail shows
      `25`, console error-free. **Demo artifact (§3) done 2026-10-30** with the
      hand-crafted PokéAPI specs: project "Pokédex" (slug `pokedex`, grid =
      oldest member = home), bare `/en/pokedex` serves the grid, `/en/pokedex/4`
      seeds `4` and the `get` fetches record 4, a card click →
      `/en/pokedex/7` carries the `$item` id, Back → home, editor
      `/ui/<ref>/4` mirrors, console clean. Entry slug is `pokedex-grid` — an
      entry slug equal to the project slug would shadow the namespace (local-
      entry-first resolution in `preview-client`)
- [x] i18n: en/es key sets identical for all new strings (312 = 312,
      `editor.navigate.sendRecordId` present in both)
- [x] No `progress.md` — plan.md + INDEX.md only

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-29 | plan drafted (Step 0: lessons grepped, `json-render` skill loaded, F15 re-read, persistence/routing/actions/data-source/prompt surfaces researched) |
| 2026-10-29 | approved — clarifications answered per recommendation: local-only projects (Q1), project namespace + `/session` subtree (Q2), drawer grouping + top-bar switcher (Q3), publishing deferred to F18 (Q4), navigate tile ships in v1 (Q5) |
| 2026-10-29 | 061-1 implemented — `lib/projects/projects.ts` store (+ active id), `HistoryEntry.projectId` (sync pull keeps the local grouping), history-drawer project groups with create/rename/switch/delete, top-bar `ProjectSwitcher` (pill + row), en/es `projects.*`; 760 unit / 127 e2e / i18n 306=306 / MCP spot-check (create, switch, rename via Enter, Escape cancels without closing the drawer, delete, mobile row) |
| 2026-10-29 | **scope change (user-directed)** — the demo goal is a Pokédex detail screen linked from the grid cards with the record id: `navigate` gains params + a project route namespace (`/{locale}/{project-slug}`, `/{locale}/{project-slug}/{id}`), new step **061-3 = navigate params + project routes** (detail spec hand-crafted via JSON import; cards → same detail screen, per-card id; project renamed to "Pokédex"; locale prefix kept), shared data/state renumbered **061-4**. Design decisions #9 added; Q&A: locale `/en/...` ✓, rename ✓, 061-2 commits first ✓ |
| 2026-10-29 | 061-3 implemented — preview `[[...route]]` catch-all (entry-pattern → project namespace → published-bare-only, unmatched path = not-found gate, `overlayPathState` seeding applied after the urlSync overlay), editor `[[...param]]` catch-all + `canvasState` seeding, `ScreenListing.route` + `recordRouteParam`, editor helpers `navigateRecordParamOf`/`setNavigateRecordParam` (no-op writes return the same spec), Navigate tile "send record id" toggle (shown only for a pattern with a placeholder, retarget resets it), en/es `editor.navigate.sendRecordId`; 827 unit / **127 e2e** / i18n 312=312 / MCP: home + pattern + exact-slug precedence + not-found gates + flat entry path + editor mirror + card click `/en/pokedex/25` → `25`, console clean. Known nit: after a *client-side* push the tab title shows the server metadata (the published row's name) instead of the local entry name; hard loads show the entry name (React-hoisted `<title>` wins there) |
| 2026-10-29 | 061-2 implemented — catalog `navigate` action + `NAVIGATE_RULES`/`siblingScreensBlock` prompt pair, `lib/projects/screen-nav.ts` (scope + ref resolution + `runNavigate`), handlers on editor/preview/live, editor Navigate tile (`PRESSABLE_TYPES` gate, sibling select, `replaceNavigateBinding` preserves sibling press actions, stale-ref "Missing screen"), en/es `editor.navigate.*` + `playground.navigateUnknown`; 792 unit / i18n 311=311 / MCP: empty state on a 1-screen project, export→import sibling listed in the tile, binding written (`setState` sibling preserved), canvas click routes `/en/ui/b83b31fd…` → `/en/ui/d4c9fd10…`; console clean (known Radix aria-hidden warn + transient Supabase `ERR_ADDRESS_UNREACHABLE` poll) |
| 2026-10-30 | demo artifacts (§3, user-driven UI work) built — project "Pokédex" (slug `pokedex`), both keyless PokéAPI specs re-imported into it (grid first → home/oldest), slugs `pokedex-grid`/`pokemon-detail`, detail Back ref retargeted (`pokedex-grid`; an entry slug equal to the project slug shadows the namespace in `preview-client` resolution); preview proof: bare `/en/pokedex` → grid, `/en/pokedex/4` → Charmander (record 4 fetched), Details → `/en/pokedex/7`, Back → home, editor `/ui/<ref>/4`, console clean; specs live in `demo/` |
| 2026-10-30 | **061-4 implemented — shared data/state (A3)**: `QueryLoader namespace = projectId` (project screens' records share `genui-data:{projectId}:{collection}`), both creation seams stamp `createProjectEntry(prompt, spec)` with the active project, `<SessionSync>` is the SOLE `/session` bridge (pre-paint layout-effect store→state pull on mount/screen-change/Activity-re-show + a store subscription; declared-first 300 ms debounce arming only local changes; stamp-guarded hide-flush), seeds omit `session` (`omitSessionState` replaces `mergeSessionState`) so a late-applied render snapshot can never re-add a stale value, `setSessionState(id, next, stamp)` rejects any write not strictly newer than the last accepted (realm monotonic clock; cross-tab baseline reset on the `storage` event), `NAVIGATE_RULES` teaches `/session/<key>` as the shared subtree. **Next 16 `<Activity>` discovery (plan 059 T1 re-confirmed)**: routes stay mounted `display:none`, effect cleanups run on hide / effects re-run on show, and a hidden prerendered route twin renders a second copy — a rapid bump→back raced stale flushes and seeds three e2e failures before the redesign (labeled instance trace root-caused it). Verification: format+lint+tsc+**839 unit / 0 fail**; `e2e/project-session.spec.ts` green; **full suite 128 passed / exit 0** (127 + 1, `E2E_USER_*` exported); MCP spot-check (chrome-devtools, seeded project "Spot Sync"): Save → store write-through, `genui-data:spot-proj:notes` record, navigate `/en/ui/spot-a` → `/en/ui/spot-b`, B reads shared token + `spot-note` (count 1), bump→back leaves restored screen AND store at `b-v2`, console 0 errors / 0 warnings |
