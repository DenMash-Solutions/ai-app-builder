# Project Data Sources and Application State

**Status:** implemented
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

## Code reality (verified 2026-11-04, do not re-research)

- `lib/projects/session-state.ts` already ships `mergeSessionState` /
  `omitSessionState` (shared `/session`, 061-4) and `dataNamespaceFor`
  (namespace = projectId when the screen belongs to a project).
- `genui_records` (migration `0001`) is keyed `(app_id, resource, id)` with
  `app_id` = the namespace and `user_id = auth.uid()` on every policy, so a
  project's records are exactly `app_id = <projectId>` for one user; the
  adapter scopes reads/writes by `app_id` only.
- Local records live at `genui-data:{namespace}:{collection}`
  (`DATA_STORAGE_KEY_PREFIX` + `local-storage-adapter` key shape), so a
  project's local data is the key prefix `genui-data:{projectId}:`.
- `removeProject()` (`lib/projects/projects.ts`) deletes the project row,
  clears the active id and detaches its entries (`clearProjectFromEntries`)
  — it purges NO data today, locally or remotely. Only call site:
  `components/history-drawer.tsx`.
- All three adapters declare full `AdapterCapabilities` (list/get/create/
  update/delete), so "capability" does not yet distinguish them.
- The query manager already versions per-namespace context, supersedes
  in-flight reads on detach and clears the namespace's pending flags and
  mirrors (`query-manager.ts`, `detach`) — the branch-mirror work is mostly
  coverage, not new machinery.
- Authoring seams that already run `validateDataSources`: generate
  completion (`app/api/generate/route.ts`), JSON import, publish. Prompt
  rules block: `lib/playground/data-source-rules.ts`.

## Tasks

### 1. Scope guard - DONE

- [x] 062 decision 2 confirmed UPHELD (062 plan, decision 2 + the override
      table row: "Plan 067 is written for the upheld option") - no rewrite,
      declarations stay per spec, the project namespace shares the rows

### 2. State scopes documented and tested

- [x] `lib/projects/state-scopes.ts`: `PROJECT_STATE_SCOPES` object constant
      (`session` / `screen` / `resource`) with i18n label + description keys
      (no hooks, no string literals at call sites)
- [x] en/es keys, surfaced where authoring happens (States tab help area) so
      a screen author can see which scope a value belongs to
- [x] Keep `/session` ephemeral-small: the copy says durable records (cart,
      orders) belong in a resource (decision 2)
- [x] Unit: constant shape + both locales resolve every key

### 3. Cross-screen data and lifecycle

- [x] Unit regression: namespace contract (decision 3) - two screens of one
      project share `dataNamespaceFor`; two projects never do; adapter reads
      scoped by namespace cannot see the other project's rows
- [x] Purge on project deletion (decision 4), split by store:
      local `genui-data:{projectId}:*` keys removed synchronously; remote
      `genui_records` rows with `app_id = projectId` deleted for the signed-in
      user, best-effort (never blocks or throws out of the delete)
- [x] `removeProject()` triggers the purge; its screens/entries survive
- [x] Unit: other projects' local keys untouched; remote purge receives the
      right `app_id`; a failing remote purge leaves deletion complete

### 4. Authoring-time validation and branches

- [x] Capability validation in `lib/data-sources/validate.ts` for the real
      constraint (see Pending decisions: Q3) + issue path/message tests
- [x] Branch mirrors across a screen switch: loading / error / empty /
      pending never leak from the previous screen's namespace (coverage in
      `query-manager.test.ts` / playground branch tests)
- [x] `DATA_SOURCE_RULES` gains the scope paragraph (which scope for which
      value, and that a project's screens share resources through the
      namespace)

### 5. Tests

- [x] Unit: namespace isolation, purge on delete, branch mirror shapes
- [x] e2e (`e2e/project-data.spec.ts`): a record written on screen A is
      readable on screen B; two projects never see each other's records;
      delete project -> records gone (service-role probe), screens kept
- [x] Publish path still classifies data-bearing screens (bake coverage);
      full gate

## Decisions taken (approved 2026-11-04)

1. Q1 - the three scopes are stated in the editor's States tab (en/es copy);
   the same rules reach the model through `DATA_SOURCE_RULES`.
2. Q2 - local purge synchronously, remote `genui_records` delete
   fire-and-forget; deletion never waits on the network.
3. Q3 - capability validation flags an `api` resource with NO `auth.ref`
   inside a project screen. Verified detail: a KEYED api source does serve
   visitors (server-held `DATA_PROXY_<REF>` pairs, plan 050), so keylessness,
   not the `api` provider itself, is the real authoring constraint.

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test`
- [x] Unit: namespace isolation, purge on delete, branch mirror shapes
- [x] e2e: record written on screen A readable on screen B via
      `genui-data:{projectId}:`; two projects never see each other's
      records; delete project -> records gone, screens kept
- [x] Publish path still classifies data-bearing screens correctly (bake
      test coverage); full gate

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-31 | plan drafted (conditional on 062 decision 2) |
| 2026-11-04 | approved (decisions above) |
| 2026-11-04 | scope guard PASSED - 062 decision 2 is UPHELD (declarations stay per spec; no rewrite needed); code reality re-verified (namespace helpers, `genui_records` keyed by `app_id`, local key prefix, `removeProject` purges nothing, full adapter capabilities, query-manager detach); tasks expanded, three decisions left open for approval |
| 2026-11-04 | implemented - three scopes in `lib/projects/state-scopes.ts` + States tab + en/es; `lib/projects/purge-data.ts` called by `removeProject` (local keys + best-effort `genui_records` delete scoped by `app_id`); namespace contract covered at the adapter level; `validateDataSources(spec, { inProject })` rejects a keyless api resource in a project (wired at the generate and publish seams); `DATA_SOURCE_RULES` teaches the scopes; branch mirrors across a screen switch covered. Verification: unit 963 pass / 0 fail (78 files), e2e 139 passed (incl. new `e2e/project-data.spec.ts`: isolation, delete purge, screens kept), lint 0, tsc clean |
