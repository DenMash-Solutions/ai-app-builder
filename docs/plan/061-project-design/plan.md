# Project Design (Multi-UI System) — Implementation Plan

**Status:** approved
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
   `/session/cart` etc. survives navigation. Decided Q2 (2026-10-29). —
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

## Step breakdown (commit per step)

1. **061-1 — project entity**: `lib/projects/projects.ts` store, `projectId` on
   `HistoryEntry`, drawer grouping + top-bar switcher, en/es keys, unit tests
2. **061-2 — navigate**: catalog action + prompt rule (sibling screens listed in
   the user prompt), ref-resolution helper, handler on every surface
   (editor/preview/live), editor action tile with sibling select, unit tests
3. **061-3 — shared data/state**: `QueryLoader namespace = projectId`,
   `/session` seed + write-through, e2e, full verification chain + MCP spot-check

## Verification

- [ ] `bun run format && bun run lint && bunx tsc --noEmit && bun run test`
- [ ] Unit: project store CRUD + hydration fallback; ref resolution order
      (id → slug → in-project name) incl. unknown ref; `projectId` survives the
      sync merge (`rowToEntry`/`applyRemoteEntry` never drop it); namespace/data
      merge behavior for A3
- [ ] e2e: create a project → generate 2 screens into it → group visible in the
      drawer → author/bind a `navigate` action → activating it routes to the
      sibling screen → shared record written on screen A is readable on screen B
      → reload keeps the grouping
- [ ] e2e: existing suite stays green (127 tests; every entry without a
      `projectId` must behave exactly as before)
- [ ] Unit/e2e: `/session` values survive a screen change (seeded from the
      project store, written back on change) while screen-local state does not;
      the navigate action tile writes a ref and routes to the sibling
- [ ] MCP spot-check per step (create/switch project, navigate live, shared data
      visible on both screens), console clean
- [ ] i18n: en/es key sets identical for all new strings
- [ ] No `progress.md` — plan.md + INDEX.md only

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-29 | plan drafted (Step 0: lessons grepped, `json-render` skill loaded, F15 re-read, persistence/routing/actions/data-source/prompt surfaces researched) |
| 2026-10-29 | approved — clarifications answered per recommendation: local-only projects (Q1), project namespace + `/session` subtree (Q2), drawer grouping + top-bar switcher (Q3), publishing deferred to F18 (Q4), navigate tile ships in v1 (Q5) |
