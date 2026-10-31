# Project and Application Builder — Umbrella Roadmap + Architecture Audit

**Status:** implemented
**Date:** 2026-10-31

## Goal

Evolve GenUI Playground from per-screen UI creation into a platform for
building, managing, reusing and publishing complete multi-screen applications.
This umbrella plan carries Phase 0 (codebase audit + architecture validation)
and sequences feature plans 063-070. **No implementation code is written
under this plan itself.**

## Scope

### In scope

- Audit inventory of the existing projects/history/sync/routes/publishing/
  data-source/template systems
- Four blocking decisions (below) with recommended resolutions
- Target domain model reconciled with the current schema
- Migration + backward-compatibility strategy
- Feature dependency graph, delivery order and estimates

### Out of scope

- Any implementation code — each feature gets its own plan and approval
- Flow canvas (F19), cross-user collaboration, payments, custom domains

## Audit findings (verified 2026-10-31)

| Claim in the source document | Verdict | Evidence |
| --- | --- | --- |
| F17 "database-backed projects already registered" | Partial | F17 is an OPEN follow-up (`docs/follow-ups.md`); projects are localStorage-only (`lib/projects/projects.ts`, 061 Q1 descope) |
| Existing work or schema for persistent projects | Missing | `db/01_schema.sql` has 5 tables: profiles, uis, page_versions, published_pages, site_settings; one migration (`0001_genui_records.sql`) |
| `profiles` has `id` + `email` | Implemented | plus `role`, `created_at`; **no `username` anywhere in the repo** (Phase 5 is greenfield) |
| `HistoryEntry.projectId: string` | Partial | `projectId?: string` — optional, device-local, single-valued, NOT carried by `uis` sync rows |
| `revisions[]` + `head` | Implemented | `lib/history/history.ts`, `MAX_REVISIONS = 10`, `normalizeEntry` backfills |
| LWW sync + stamp guards | Implemented (two mechanisms) | `lib/history/sync.ts` entry LWW + `projects.ts` session stamp clock (realm-local) |
| `genui-data:{projectId}` namespace | Implemented | 061-4: `QueryLoader namespace = projectId`, `genui_records.app_id = projectId` |
| `APP_SEGMENTS`/`RESERVED_SLUGS` | Implemented | `lib/i18n/routing.ts` + `lib/slug.ts` list ui/admin/login/signup; `user` missing from both; both couple to `proxy.ts` |
| Data providers + creator-owned credentials | Implemented | providers `localStorage`/`supabase`/`api`; keyed lane = shape-only `auth` + `DATA_PROXY_*` env pairs + `/api/data-proxy` |
| Component templates copy a component | Implemented (weaker than assumed) | plan 060: visitor-global localStorage, inert `{rootKey, elements}` subtree, no versions/owner/visibility |
| Feature numbers 062-065 | Do not exist | only chat-defined; claimed by this roadmap (062-067) per `feature-plan.md` numbering |

## Source-document deviations (re-reviewed 2026-10-31)

The source of this roadmap is an external "Comprehensive Architecture and
Implementation Plan". It was checked against the repo again after Phase 0;
where it differs from this repo's plans, **the repo plans win**:

| Source-document item | Verdict here |
| --- | --- |
| Feature IDs: "062 re-import", "063 usernames", "064 publishing", "065 membership" | **ID collision — never apply those numbers here.** Repo numbering is authoritative: 062 umbrella, 063 re-import (implemented), 064 database projects, 065 workspace, 066 catalog, 067 data/state, 068 usernames, 069 publishing, 070 demo. Source "NEW-1"/"NEW-2" = 065, "NEW-3"/"NEW-4" = 066, "NEW-5" = 067, "NEW-6" = 069, "NEW-7" (integrations) deferred, "NEW-8" = 070 |
| "Data-source configurations belong to projects" + a `ProjectDataSource` table (sections 3.5, 4.7) | **Overridden** — blocking decision 2 stands: declarations stay per spec, the project namespace shares the rows; a `ProjectDataSource` table reverses a recorded 061 rejection. Plan 067 is written for the upheld option |
| `HistoryEntry.projectId: string \| null` (section 2) | Actual shape is optional `projectId?: string` — audit table above |
| "F17 database-backed projects already registered" (section 2) | Was an open follow-up until plan 064 claimed it — audit table above |
| "Linked UI editing" in the source's old 064/065 definitions | Already replaced by plan 066's version-pinned installs + fork-on-edit |

Everything else (domain model, phase order, acceptance criteria) is either
reflected in the plans above or explicitly rejected in their design decisions.

## Blocking decisions (approve together with this plan)

1. **Route namespace registry.** One precedence for the shared
   `/{locale}/{X}` space: app segments > `/user` > claimed project handles >
   published UI slugs > local entry slugs (owner preview wins). Also fixes an
   existing bug: a project named "Admin" derives slug `admin` and is shadowed
   by `app/[locale]/(app)/admin/page.tsx` (static segment beats `[slug]`);
   `uniqueSlug()` never checks `RESERVED_SLUGS`. Owner of the registry:
   Phase 0 output, consumed by 065 and 069.
2. **Data-block declarations.** Recommended: **UPHOLD** 061 design decision 5
   (Q2 answer) — declarations stay per spec, the project namespace shares the
   rows. A `ProjectDataSource` table reverses a recorded rejection and touches
   generation, `validateDataSources` seams, `classifySpec` and bake. Plan 067
   is written for the upheld option and must be rewritten if overturned.
3. **Component embedding.** Recommended: **expansion at install** (fresh keys +
   `data-template-id` provenance), matching today's `insertTemplate`. The
   json-render React schema is a flat `{root, elements}` tree with no
   instance element, so runtime version resolution would contradict the
   source requirement that a component version never depend on mutable
   catalog state at render time.
4. **Membership storage.** Recommended: a local-first `memberships` store
   (projects.ts module-store pattern) mirrored to a `project_screens` table
   synced alongside 064. Rejected: `projectIds[]` on `HistoryEntry` — route
   and position have no home on the entry.

## Target domain model (reconciled with the code)

- `Profile` gains `username` (068)
- `Project` = id, ownerId, name, **slug** (local route namespace,
  name-derived, keeps 061 routing), **handle** (global, claimed, stable,
  069), homeScreenId, status, state, timestamps
- **`Screen` IS `HistoryEntry` / `uis` row** — owner, name, slug, revisions,
  head. No duplicate screen type anywhere.
- `ProjectScreen` membership: projectId, screenId, route, position, createdAt
- `CatalogAsset` + immutable `CatalogAssetVersion` (pattern: `page_versions`)
- `ProjectAsset` install: screens install as **copies**, components as
  **expanded subtrees** (decision 3)
- `PublishedEntryPoint`: (project, route) projection (069)

## Migration and backward compatibility

- Backfill memberships from existing `projectId`; dangling id keeps the
  "no project" bucket behavior that 061 verified in its sync tests
- Existing `published_pages` slugs keep resolving — registry precedence must
  not break them (061 log: an entry slug equal to a project slug shadows the
  namespace today)
- Existing localStorage templates seed the catalog lazily; local libraries
  keep working when signed out
- Standalone single-UI workflow unchanged — no forced project creation
- No screen ever depends on a catalog row at render time (source requirement)

## Feature dependency graph

```
064 database projects ─┬─> 065 workspace/membership ─┬─> 067 data/state
                       ├─> 066 catalog ───────────────┤
                       └──────────────────────────────┴─> 069 publishing ─> 070 demo
063 re-import (independent)      068 usernames (independent, parallel)
```

## Delivery order and estimates

| Number | Plan | Depends on | Est. |
| --- | --- | --- | --- |
| 062 | this umbrella | — | 2-4 d |
| 063 | re-import existing UI | — | 3-5 d |
| 064 | database projects (F17) | 062 | 1-1.5 wk |
| 065 | project workspace + membership | 064 | 1.5-2 wk |
| 066 | UI catalog | 064 | 1.5-2 wk |
| 067 | project data + state | 065 + decision 2 | 1 wk |
| 068 | usernames + public profiles | — (parallel) | 1 wk |
| 069 | project publishing (F18) | 064, 065, 068 | 1.5-2 wk |
| 070 | ecommerce reference demo | 065-069 | 1-1.5 wk |

Total 10-13 weeks. Optional `connections`/BYO-key plan deferred — the keyed
API lane (050) covers v1.

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test`
      — green in the session that closed 063 (842 unit / 0 fail, 129 e2e)
- [x] Every source-document claim mapped to implemented/partial/missing
      (audit table above)
- [x] The four decisions above explicitly approved or amended — accepted as
      recommended (2026-10-31)
- [x] INDEX row added and kept in the same turn as this file
- [x] Each child plan approved before its code — in force: 063 approved then
      implemented, 064 approved 2026-10-31 before any of its code; 065-070
      must follow the same gate

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-31 | plan drafted (Phase 0 audit against the source document; lessons + json-render skill loaded first) |
| 2026-10-31 | approved — the four blocking decisions accepted as recommended: namespace registry precedence, 061 Q2 upheld (per-spec data declarations), expansion-at-install component embedding, local-first memberships + project_screens |
| 2026-10-31 | implemented — docs-only umbrella delivered: audit mapped, four decisions approved, migration/compat strategy and dependency graph recorded; verification chain green in-session (842 unit / 0 fail, 129 e2e); 063 done, 064 approved as the first child |
