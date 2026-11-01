# Project Workspace — Membership, Routes, Home Screen

**Status:** approved
**Date:** 2026-10-31

## Goal

Make a project a container for a complete application: many screens held by
membership rows, configured routes with deterministic matching, and an
explicit home screen.

## Scope

### In scope

- Membership entity: local store `lib/projects/memberships.ts` (projects.ts
  module-store pattern) mirrored to `project_screens` (project_id, screen_id,
  route, position, created_at; unique per project+screen and per
  project+route; FKs to projects/uis; owner-only RLS)
- Operations: add existing screen, copy (new identity), move between
  projects, remove, reorder, rename-in-project
- Route configuration using the existing `{param}` pattern syntax
- Deterministic matching: exact screen slug > static pattern > dynamic
  pattern > position order (today: first match in declaration order)
- Explicit `project.homeScreenId` replacing the oldest-member rule in
  `projectHomeScreenId` (`lib/projects/screen-routes.ts`)
- Workspace UI in existing chrome: history-drawer grouping + a project panel
  — rejected: a new top-level route, per 061 decision 7 (Q3 answer)
- Prompt teaching: sibling screens already listed by `siblingScreensBlock`;
  extend for routes and home

### Out of scope

- Flow canvas (F19) — registered separately
- Cross-project membership for screens the user does not own — single-owner
  invariant instead (062 decision 4)
- Undo/redo across screen changes — descoped by 061

## Design decisions

1. Membership is its own entity, because `route` and `position` have no home
   on `HistoryEntry` — rejected: `projectIds[]` on the entry.
2. Local-first working copy synced when signed in (same contract as history
   and projects) — rejected: DB-only, because it breaks the anonymous local
   workflow 061 established.
3. Copy = new `HistoryEntry`/`uis` row with revision 0; move = remove source
   membership + add destination with identity and revisions preserved;
   remove = membership only, the screen survives everywhere else — rejected:
   deep-copy on move, because edits would fork silently.
4. Single-owner invariant: a screen's owner must equal the project owner,
   enforced server-side — rejected: cross-user membership for v1.
5. Home screen explicit; removing it requires choosing a replacement or
   leaves the root entry point empty; linking never reassigns home —
   rejected: keeping the oldest-member rule, because it reassigns the site's
   front door when an early screen is removed (source requirement forbids
   relying on creation order).
6. Route syntax stays `{param}` with `overlayPathState` seeding — rejected:
   `:param` colon style, which would introduce a second convention against
   working, tested code.
7. Duplicate routes are rejected at authoring time (unique(project, route))
   rather than resolved silently at runtime.
8. Membership rows carry `owner_id` + `created_at`/`updated_at` (denormalized
   from the project) — the generic sync contract's slim read and F7 guard
   require `owner_id` on every row; rejected: deriving owner via join,
   because the sync loop's slim column read never joins.
9. Cross-device duplicate route: the local row's **route is cleared**
   (membership kept, re-stamped) at push time via `reconcileProjectRoutes`
   — rejected: letting the constraint fail the push (one violating row
   poisons the whole membership upsert batch → every membership stalls),
   rejected: suffixing (`settings-2`), because a route is a URL contract,
   not a name.
10. `projects.home_screen_id` membership is validated app-side, not by a DB
    trigger/FK — rejected: composite FK `(project_id, home_screen_id) →
    project_screens`, because the two sync loops are independent and a
    cross-loop dependency fails whole-project pushes transiently (amends the
    064 schema comment that promised a DB check).
11. Cross-device duplicate PAIR (same (project, screen), two uuids — e.g.
    both devices add the same synced screen): resolved by **re-keying** the
    local twin onto the remote row's id — the remote id is the DB identity
    (the row already exists in `project_screens`), the newer content wins
    under LWW, and the next push overwrites the remote row instead of
    tripping the pair constraint. At adoption the same rule applies
    symmetrically (remote newer → replace; local newer → re-keyed onto the
    remote id). Extends decision 9's
    "never let a constraint poison the batch": unlike a route, a pair cannot
    be "cleared", so the two rows must become one. Rejected: dropping the
    local twin (silently loses its newer content/position), letting both
    push (the unique(project, screen) violation fails the whole upsert
    batch — every membership stalls, exactly decision 9's failure mode).
12. Remove/move keep the device-local `entry.projectId` pointer aligned
    (cleared on remove-from-the-pointer's-project, re-stamped on move):
    otherwise the idempotent backfill re-adds the removed membership on the
    next load. Rejected: tombstones (extra state for a pointer the backfill
    already trusts).
13. Initial home assignment (2026-11-01, fills a decision-5 gap): home is
    seeded when EMPTY at the two seams that give a project a first screen —
    the first `addScreenToProject`, and the first-load backfill for a
    project whose membership set is being created for the first time (the
    generation flow creates screens via `entry.projectId`, never through
    `addScreenToProject`); removing the home screen clears it (root stays
    empty until the next add or the explicit setter). Always an initial
    FILL, never a reassignment (decision 5). Rejected: seeding in the
    idempotent backfill unconditionally, because it resurrects a
    deliberately cleared home on every reload; rejected: explicit-only
    (no setter UI until task 4), because pre-065 projects would 404 the
    bare namespace. `setProjectHomeScreenId` is the explicit seam for
    task 4's UI; `projectHomeScreenId` validates membership + entry
    existence at resolve time (decision 10's app-side check).

## Files

`lib/projects/memberships.ts` (+tests), `lib/projects/screen-routes.ts`,
`lib/projects/screen-routes.test.ts`, `lib/projects/projects.ts`,
`lib/history/history.ts` (copy + pointer helpers), `lib/history/sync.ts`
(+`membershipsSyncSpec`), `components/sync/sync-engine.tsx` (third loop),
`db/` migration + RLS, project panel and drawer components,
`app/[locale]/[slug]/preview-client.tsx`, en/es keys,
`e2e/project-session.spec.ts` extensions.

## Tasks

### 1. Membership store and schema

- [x] `db/` migration: `project_screens` (id, owner_id, project_id,
      screen_id, route, position, created_at, updated_at — decisions 8;
      unique per project+screen and project+route; FKs, owner-only RLS with
      project+screen ownership `WITH CHECK`); `project.homeScreenId` already
      exists (064) — membership check app-side per decision 10 — applied
      live as `20261101000000_add_project_screens_rls_grants`; 7 behavioral
      probes green (cross-owner insert 403, reads invisible, delete no-op,
      anon 0, table cleaned)
- [x] `lib/projects/memberships.ts` module store (projects.ts pattern):
      local-first, contract-ready for account sync (decision 2) — sanitizer
      restores the two uniqueness invariants (dup pair dropped, dup route
      cleared not dropped), 9 unit tests green. **Review 2026-11-01**: this
      checkbox overstated — the store is sync-*contract*-ready only; the
      loop itself is the next item
- [x] Account sync loop (decision 2, added by 2026-11-01 review): third
      `startTableSync` over `project_screens` — `membershipsSyncSpec` in
      `lib/history/sync.ts` + wiring in `components/sync/sync-engine.tsx`
      (one status dot, one flush path — 064 decision 1), push-time
      `reconcileProjectRoutes` (decisions 9/11) + adoption-time
      `applyRemoteMembership` — implemented 2026-11-01; 6 loop tests green
      (row round-trip, download no-remap, push columns, d9 route clear,
      d11 pair re-key, delete-not-resurrect)
- [x] Backfill: existing `projectId` pointers become membership rows (on
      first client read, chronological positions, idempotent); dangling ids
      keep the "no project" bucket (062 migration note)

### 2. Operations (add / copy / move / remove / rename)

- [x] Add existing screen → membership row only, no new screen
- [x] Copy → new `HistoryEntry`/`uis` row with revision 0 + destination
      membership (decision 3) — `copyScreenToProject` + `copyEntry`
- [x] Move → remove source membership, add destination; identity and
      revisions preserved — `moveScreenBetweenProjects` (pointer
      re-stamped, decision 12)
- [x] Remove → membership only; the screen survives in its other projects —
      pointer cleared with the row (decision 12) so reload never
      resurrects it
- [ ] Rename-in-project and reorder (position) — reorder done
      (`reorderProjectMembers`); rename is an entry-rename UI affordance,
      lands with the workspace panel (task 4)

### 3. Routes and home screen

- [ ] Route configuration UI using the existing `{param}` syntax
      (decision 6) — store seam done (`setMembershipRoute` rejects
      duplicates, decision 7); the UI affordance lands with the workspace
      panel (task 4), like rename
- [x] Deterministic matching precedence: exact slug > static > dynamic >
      position order, including tie cases (`screen-routes.ts`) —
      `resolveProjectRoute` is membership-driven (rows injected or store
      default); 7 precedence/edge tests green
- [x] Duplicate route rejected at authoring time, unique(project, route)
      (decision 7) — `setMembershipRoute` + sanitizer + push-time reconcile
      (decisions 9/11), tested in WS1/WS2
- [x] Explicit `homeScreenId` replaces the `projectHomeScreenId`
      oldest-member rule; removing home forces a replacement choice or
      leaves the root entry point empty (decision 5) — carries through the
      projects sync (`Project.homeScreenId` ↔ `projects.home_screen_id`:
      `rowToProject`/`projectToRow`/`sanitizeProjects` + the
      `sync.test.ts` assertion that today pins the column out of the row —
      amended by this plan, per the 064 comment "belongs to 065/069").
      Implemented 2026-11-01 with decision 13 (initial-fill seeding):
      `setProjectHomeScreenId` explicit seam, add/remove home hygiene in
      the membership store, first-time-backfill seed; resolve-time
      validation (member + entry exists). 9 unit tests green (setter,
      sanitizer, seed/no-reassign, clear/no-resurrect, explicit-home
      resolution, dangling home, precedence ties)

### 4. Workspace UI and prompt

- [ ] Project panel + history-drawer grouping inside the existing chrome —
      no new top-level route (061 decision 7)
- [ ] `siblingScreensBlock` extended with routes and home (prompt teaching)
- [ ] `preview-client.tsx` serves the bare project namespace through the
      home screen

### 5. Tests

- [ ] Unit: route precedence incl. ties, duplicate rejection, membership ops,
      explicit home rules, screens without a project behave as before
- [ ] `lib/projects/screen-routes.test.ts` updated for the new precedence
- [ ] e2e: screen in two projects — remove from one, the other keeps it;
      dynamic route resolves and seeds state; home serves the bare
      namespace; reload keeps membership
- [ ] Full gate; 061 verification stays green

## Verification

- [ ] `bun run format && bun run lint && bunx tsc --noEmit && bun run test`
- [ ] Unit: route precedence incl. tie cases, duplicate-route rejection,
      membership ops (add/copy/move/remove/reorder), explicit home rules,
      screens without a project behave exactly as before
- [ ] e2e: a screen in two projects — remove it from one, the other keeps
      it; dynamic route resolves and seeds state; home screen serves the
      bare project namespace; reload keeps membership
- [ ] MCP spot-check + full gate; 061 verification stays green

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-31 | plan drafted |
| 2026-10-31 | approved |
| 2026-11-01 | review vs. codebase: Task 1's "sync when signed in" overstated (loop unwired) → sync-loop item added; Files gains `sync.ts`/`sync-engine.tsx`/`history.ts`; decisions 11 (pair-dup reconcile) and 12 (remove/move pointer hygiene — backfill resurrection) added; Task 3 notes the `home_screen_id` sync contract |
| 2026-11-01 | sync loop + copy/move/remove implemented — gate green (lint 0, tsc clean, prettier clean, 879 unit pass incl. 11 new); tasks 1 and 2 (minus rename UI) closed |
| 2026-11-01 | Task 3 core implemented — decision 13 (initial home fill) added after a clarifying question; `resolveProjectRoute` membership-driven (exact > static > dynamic > position), `Project.homeScreenId` end-to-end (store, sync, resolve, nav) — gate green (lint 0, tsc clean, prettier clean, 888 unit pass incl. 9 new); route-config UI checkbox remains for task 4's panel |
