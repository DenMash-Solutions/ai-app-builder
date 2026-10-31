# Project Data Sources and Application State

**Status:** draft
**Date:** 2026-10-31

## Goal

Make the screens of one project operate as a single data-driven application:
shared resources, clearly scoped state, and isolated runtime data per
project.

## Scope

### In scope

Written for **062 decision 2 UPHELD** (declarations stay per spec); revise
this plan if that decision is overturned.

- Three state scopes, documented and tested: project/shared (`/session`,
  shipped by 061-4), screen-local (existing), resource data (provider)
- Cross-screen consumption of one resource verified end to end (namespace is
  already project-scoped: `genui-data:{projectId}:` / `genui_records.app_id`)
- Data lifecycle: deleting a project purges its `genui-data:{projectId}:`
  records and matching `genui_records` rows, while its screens survive
- Provider capability validation surfaced at authoring time (a resource that
  cannot refresh in a project says so in the editor, per source requirement)
- Loading / error / empty / pending branch coverage across a screen switch

### Out of scope

- New providers; per-user credentials (deferred with the keyed lane, 050)
- Realtime refresh; speculative prefetch
- Project-level data manifests — conditional scope below

### Conditional scope (only if 062 decision 2 is overturned)

- Project-level data manifest block, inheritance at generation time,
  revised `validateDataSources` seams, `classifySpec`/bake impact, prompt
  rework. **This plan must be rewritten before any code under it.**

## Design decisions

1. Declarations stay per spec (061 design decision 5 upheld) — rejected:
   a `ProjectDataSource` table, because it reverses a recorded rejection and
   touches generation, validation, `classifySpec` and bake for a benefit the
   namespace already provides (shared rows, no duplicated storage).
2. Ephemeral shared UI state lives in `/session` (selected store, auth
   context); durable records (cart contents, orders) live in a resource, not
   `/session` — rejected: growing `/session` into a database, because its
   stamp-guarded bridge is sized for small ephemeral values.
3. Isolation by namespace is a contract and gets an explicit regression test:
   two projects, same resource name, no cross-reads.
4. Cleanup is owned by project deletion, never by screen deletion —
   rejected: purging on screen removal, because a screen shared by two
   projects would take the other project's data with it.
5. `componentStates` and rendered output stay data-independent of storage
   and account state — no new ambient coupling in this plan.

## Files

`lib/projects/projects.ts` (purge), `lib/data-sources/` validation copy,
`lib/playground/` branch-mirror handling, prompt rules block, en/es keys,
unit + e2e specs.

## Tasks

### 1. Scope guard

- [ ] Confirm 062 decision 2 is still UPHELD before writing any code — if
      overturned, rewrite this plan first (conditional scope)

### 2. State scopes documented and tested

- [ ] Document the three scopes where the editor can state them (en/es
      keys): project/shared `/session`, screen-local, resource data
- [ ] Keep `/session` ephemeral-small; durable records (cart, orders) go to
      a resource (decision 2)

### 3. Cross-screen data and lifecycle

- [ ] End-to-end proof that screen A writes and screen B reads through
      `genui-data:{projectId}:` / `genui_records.app_id`
- [ ] Project deletion purges `genui-data:{projectId}:` records and matching
      `genui_records` rows while its screens survive — purge added to
      `lib/projects/projects.ts` (decision 4)
- [ ] Namespace-isolation regression test: two projects, same resource name,
      no cross-reads (decision 3)

### 4. Authoring-time validation and branches

- [ ] Provider capability validation copy in `lib/data-sources/` surfaced at
      authoring time (a resource that cannot refresh says so in the editor)
- [ ] Loading / error / empty / pending branch mirrors across a screen switch
      (`lib/playground/`) plus the prompt rules block

### 5. Tests

- [ ] Unit: namespace isolation, purge on delete, branch mirror shapes
- [ ] e2e: record written on screen A readable on screen B; two projects
      never see each other's records; delete project → records gone,
      screens kept
- [ ] Publish path still classifies data-bearing screens (bake coverage);
      full gate

## Verification

- [ ] `bun run format && bun run lint && bunx tsc --noEmit && bun run test`
- [ ] Unit: namespace isolation, purge on delete, branch mirror shapes
- [ ] e2e: record written on screen A readable on screen B via
      `genui-data:{projectId}:`; two projects never see each other's
      records; delete project → records gone, screens kept
- [ ] Publish path still classifies data-bearing screens correctly (bake
      test coverage); full gate

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-31 | plan drafted (conditional on 062 decision 2) |
