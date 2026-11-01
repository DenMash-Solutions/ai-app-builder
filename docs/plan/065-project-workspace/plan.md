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

## Files

`lib/projects/memberships.ts` (+tests), `lib/projects/screen-routes.ts`,
`lib/projects/screen-routes.test.ts`, `lib/projects/projects.ts`,
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
      local-first, sync when signed in (decision 2) — sanitizer restores the
      two uniqueness invariants (dup pair dropped, dup route cleared not
      dropped), 9 unit tests green
- [x] Backfill: existing `projectId` pointers become membership rows (on
      first client read, chronological positions, idempotent); dangling ids
      keep the "no project" bucket (062 migration note)

### 2. Operations (add / copy / move / remove / rename)

- [ ] Add existing screen → membership row only, no new screen
- [ ] Copy → new `HistoryEntry`/`uis` row with revision 0 + destination
      membership (decision 3)
- [ ] Move → remove source membership, add destination; identity and
      revisions preserved
- [ ] Remove → membership only; the screen survives in its other projects
- [ ] Rename-in-project and reorder (position)

### 3. Routes and home screen

- [ ] Route configuration UI using the existing `{param}` syntax
      (decision 6)
- [ ] Deterministic matching precedence: exact slug > static > dynamic >
      position order, including tie cases (`screen-routes.ts`)
- [ ] Duplicate route rejected at authoring time, unique(project, route)
      (decision 7)
- [ ] Explicit `homeScreenId` replaces the `projectHomeScreenId`
      oldest-member rule; removing home forces a replacement choice or
      leaves the root entry point empty (decision 5)

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
