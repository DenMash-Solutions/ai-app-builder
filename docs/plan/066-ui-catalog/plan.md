# UI Catalog — Versioned Screens and Components

**Status:** implemented
**Date:** 2026-10-31

## Goal

Evolve component templates (plan 060) into one catalog of reusable assets
with public/private visibility, immutable versions, version-pinned installs
and fork-on-edit.

## Scope

### In scope

- `catalog_assets` (id, owner_id, name, description, type screen|component,
  visibility private|public, latest_version_id, created_at, updated_at)
- `catalog_asset_versions` (asset_id, version monotonic, spec, changelog,
  created_at) — immutable, DB-enforced; pattern already exists in
  `page_versions` (`unique(ui_id, version)`)
- Install rows pinning source asset + version; ownership copied to the
  installing project
- Fork-on-edit: project-owned copy with independent identity and revision 0
- Explicit update flow (installed vs latest, confirmation, rollback)
- Catalog UI reusing the existing template UI (search, visibility toggle,
  install)
- Lazy migration of the `genui-component-templates` localStorage library
- Account sync of catalog assets, versions and installs (decision 9 —
  added 2026-11-02; without it installs don't survive device changes)

### Out of scope

- Marketplace, payments, semver ranges, dependency diffing
- Automatic updates — installs never change on their own

## Design decisions

1. **Two reuse primitives, on purpose.** "Add an existing screen" = membership
   (live shared identity, same owner, plan 065). "Install a catalog asset" =
   snapshot copy (new `uis` row for screens, expanded subtree for
   components). This reconciles two source requirements that cannot both hold
   on one mechanism: membership reuse (3.2) versus version-pinned install
   (3.4) — a shared screen edited in project A would otherwise fork or mutate
   project B. Rejected: versioned membership, because it breaks the
   shared-screen expectation; rejected: live-linked installs, because they
   break pinning.
2. Components embed by **expansion at install** (fresh keys +
   `data-template-id` provenance) per 062 decision 3 — rejected: runtime
   version resolution, because the flat `{root, elements}` schema has no
   instance element and rendering must never depend on mutable catalog state.
3. Version immutability enforced in the database (trigger or column
   permission), not only in app code — rejected: soft immutability, because
   requirement: a published installation must remain valid even if the
   catalog asset is later changed. **Resolved 2026-11-02: a
   `BEFORE UPDATE/DELETE` trigger that raises** — rejected: column
   permissions, because Postgres has no clean per-column DML grant and the
   trigger is directly testable at the DB layer.
4. Fork-on-edit runs as one transaction/RPC: read version → create copy →
   initial revision → swap reference — rejected: client-side multi-step,
   because partial migration was explicitly forbidden.
5. Existing templates keep working when signed out; first save while signed
   in seeds a catalog row — rejected: forced bulk migration, because local
   libraries must not break.
6. Public assets are visible to everyone but installable as copies only;
   editing someone else's asset is never possible — rejected: shared-edit
   assets, because per-owner revisions (`uis` is owner-scoped) can't merge.
7. Catalog UI lives as a **tab in the existing Insert picker** (user-
   selected 2026-11-02) — search, filters, install beside the current
   templates list in the same dialog. Rejected: a history-drawer section
   (insertion already happens in the picker), rejected: a separate
   `/catalog` route (extra navigation for an insertion flow).
8. Installing a **screen** asset creates a new `uis` row at revision 0
   **plus a `project_screens` membership row in the ACTIVE project** via
   065's store (user-selected 2026-11-02), so it lands in that project's
   drawer group immediately. Rejected: standalone row without membership
   (the user would have to add it manually; the install intent is "into
   what I'm working on").
9. Catalog tables **join the account sync loop** (user-selected
   2026-11-02): assets, versions and installs pull/push alongside 065's
   third loop, following the 064 cross-device pattern. Rejected: device-
   local catalog (install state would be lost across devices and
   contradicts 064's cross-device expectation).
10. **Fork refinements** (accepted 2026-11-02, from the Task-4 publish-
    affordance analysis — refines decision 4, re-applied as a live
    migration): (a) the reference swap **clears `target_key`** (the old
    key belonged to the old target); (b) the membership swap runs **only
    for screen installs** (`target_key` null — a component install's
    target is its HOST, so swapping would hijack the host's drawer row);
    (c) when the project has **no install** for the asset the RPC
    **creates one** (asset → working-copy link syncs cross-device; client
    mirrors when `install_id` is returned but absent locally). Rejected:
    keeping the v1 swap (stale-key + component-host-hijack bugs would
    ship); rejected: deferring (c) (fork in a fresh project would leave no
    catalog link to update later).
11. **Public browse = adopt foreign public rows into the sync store**
    (user-selected 2026-11-02, Option B): the catalog tab's open runs a
    public-assets query (RLS scopes it to own + public) and feeds foreign
    rows through the existing `applyRemote*` adoption path with their real
    `ownerId` on the entity; `SyncSpec` gains an **optional entity-level
    `ownedBy(entity, ownerId)` guard** checked on push AND delete, so an
    adopted row is never written even when its remote copy becomes
    invisible (owner flipped it private → remote-based F7 guard can't see
    it → upsert would be RLS-refused → loop stuck offline). Rejected:
    separate read-only browse cache (Option A — splits catalog reads into
    two sources of truth: `addCatalogInstall` / `getInstallStatus` /
    `canPublish` would all need two-store merges plus a second cache
    lifecycle). Locally-created rows carry `ownerId: ""` (push stamps the
    session user, preserving anonymous-claim behavior). All new queries
    use **explicit column lists — never `SELECT *`** (user rule
    2026-11-02); the one existing site (sync pull phase 2,
    `lib/history/sync.ts`) moves to a per-spec `fullColumns` list in this
    task.

## Files

`db/` migration + RLS for assets/versions/installs (+ immutability
trigger, `docs/security/rls-audit.md` inventory),
`lib/editor/templates.ts` (+tests), new `lib/catalog/`,
`lib/history/sync.ts` + `components/sync/sync-engine.tsx` (catalog sync),
catalog tab in `components/editor/component-picker.tsx`, en/es keys,
`e2e/` catalog spec.

## Tasks

### 1. Schema and immutability (db/)

- [x] `catalog_assets` migration (id, owner_id, name, description,
      type screen|component, visibility, latest_version_id, timestamps) +
      RLS per file pattern
- [x] `catalog_asset_versions` (asset_id, monotonic version, spec,
      changelog, created_at) with unique(asset, version) mirroring
      `page_versions`
- [x] DB-enforced version immutability — trigger or column permission
      (decision 3) — with a rejection test at that layer
- [x] Install rows: source asset id + version id pinned; ownership copied
      to the installing project

### 2. Catalog library (lib/catalog/)

- [x] Asset and version CRUD on the existing client/seam patterns
- [x] Publish-new-version flow: keep old version, insert immutable version,
      bump `latest_version_id`, optional changelog
- [x] Lazy seed of the `genui-component-templates` localStorage library into
      catalog rows without duplicates (decision 5)
- [x] Catalog sync: pull/push `catalog_assets` / `catalog_asset_versions` /
      installs in `lib/history/sync.ts` (third-loop pattern from 065),
      idempotent on conflict (decision 9)

### 3. Install, update, fork

- [x] Install = version-pinned snapshot copy: new `uis` row for screens,
      expanded subtree for components (decision 1)
- [x] Explicit update flow logic: installed vs latest version detection,
      pin re-point, rollback to a previously installed version —
      **confirmation UI ships with the Task 4 catalog tab** (split decided
      2026-11-02: Task 3 = library APIs + unit tests only)
- [x] Fork-on-edit as one RPC/transaction: read version → create copy →
      initial revision → swap reference (decision 4), concurrency-safe —
      **refined by decision 10** (target_key clear, screen-only membership
      swap, install-create when absent) applied in Task 4
- [x] Insert seam in `components/playground/`: expansion at install with
      fresh keys + `data-template-id` provenance (062 decision 3)

### 4. Catalog UI

- [x] Catalog tab in the Insert picker (decision 7): search, filters
      (all/mine/public/private, screens/components), owner, latest
      version, preview = **type + element-count chip** (clarification
      answered 2026-11-02 — full render rejected: no lightweight preview
      component exists, css-safelist/FPS risk)
- [x] Public browse (decision 11): `ownerId` on the asset/version model +
      mappers + sanitize; tab-open adoption of foreign public rows with
      explicit column lists (never `SELECT *`); `SyncSpec.ownedBy`
      entity guard on push + delete
- [x] Visibility toggle whose change never invalidates installations
- [x] Update confirmation dialog + update-available indicator for
      installed assets (flow logic ships in Task 3); picking an older
      version = rollback
- [x] Publish-update action on own asset rows (clarification answered
      2026-11-02): the working copy's current spec → next immutable
      version via `publishCatalogVersion`
- [x] Screen install and fork **navigate to the new screen** immediately
      (clarification answered 2026-11-02)
- [x] Fork refinements (decision 10): RPC v2 re-applied live (clear
      `target_key`, screen-only membership swap, install-create when
      absent) + client mirrors (`addCatalogInstall` optional `id`,
      `forkCatalogAsset` local install creation, working-copy whole-spec
      swap in `swapInstallContent`)
- [x] en/es i18n keys for every new catalog-tab string

### 5. Tests

- [x] Unit: version monotonicity, immutability rejected at the DB layer,
      install pinning survives a new latest version, fork gets independent
      identity and revision 0 (coverage shipped with Tasks 1-3: rejection
      test live, publish + pin + fork unit suites)
- [x] e2e: two projects install v1 → v2 published → both still render v1;
      fork in A leaves B unchanged; private install denied (service-client
      assertion); an install made on one device appears on another
      (064 pattern, decision 9)
- [x] Signed-out local template library still works; migration seeds without
      duplicates; full gate

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test`
- [x] Unit: version monotonicity, immutability rejected at the DB layer,
      install pinning survives a new latest version, fork gets independent
      identity and revision 0
- [x] e2e: two projects install v1 → v2 published → both still render v1;
      fork in A leaves B unchanged; private asset install denied by RLS
      (service-client assertion)
- [x] Local template library still works signed out; migration seeds without
      duplicates; full gate

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-31 | plan drafted |
| 2026-11-02 | clarifications answered (Insert-picker tab, screen install = uis row + membership in active project, catalog joins account sync); decisions 7-9 added, decision 3 resolved to a BEFORE UPDATE/DELETE trigger; scope + files + tasks updated |
| 2026-11-02 | approved — recommended options accepted as decisions 7-9 |
| 2026-11-02 | Task 1 done — migration `plan_066_catalog_schema` applied (live: 11 tables, 37 policies, 5 functions); DB rejection test passed (UPDATE refused, direct DELETE refused, spec unchanged, asset cascade cleans versions+installs); advisors: no ERRORs — 0012 fires on all 11 tables project-wide (anonymous sign-ins enabled, pre-existing shape), F5/F6/genui-search-path WARNs pre-existing |
| 2026-11-02 | Task 2 done — `lib/catalog/` store (CRUD, publish, install pins, id-keyed seed + `startTemplateSeeding`), `setTemplateSavedListener` seam, 3 sync loops with `immutableRows` (strict `>` + no delete pass) and version-collision renumber reconcile; tests: catalog 11, templates +1, sync +5 → gate 917 pass / 0 fail |
| 2026-11-02 | Task 3 done — `lib/catalog/install.ts` (screen install = uis row + membership + pin; component expansion via `insertTemplate` with provenance; update/rollback = pin re-point + content swap through the revision stack, deleted copy → pin only; `getInstallStatus`), fork RPC `fork_catalog_asset` applied live (`plan_066_fork_catalog_asset`): authed DO-block test passed — revision-0 copy + slug mirror, install/membership swap twice, private asset / foreign version / unsigned refused, anon EXECUTE denied, privilege matrix verified; insert seam playground → edit-panel → structure-tab → component-picker; docs: db/README + rls-audit function ACL; tests: install 11, catalog +2 → gate 930 pass / 0 fail |
| 2026-11-02 | Task 3 scope clarified — update/rollback flow logic stays in Task 3, its confirmation UI moves to Task 4 (catalog tab); Task 4 gains an update-confirmation + update-available checkbox |
| 2026-11-02 | Task 4 scope clarified — publish-update action on own rows added to Task 4; screen install + fork navigate to the new screen; row preview = type + element-count chip (full render rejected); decisions 10 (fork refinements: target_key clear, screen-only membership swap, install-create when absent) and 11 (public browse = adopt into sync store + `ownedBy` push/delete guard) added; explicit-column rule recorded (never `SELECT *`; sync pull phase 2 moves to per-spec `fullColumns`) |
| 2026-11-02 | Task 4 done — catalog tab in the Insert picker (decision 7: Templates ↔ Catalog tab strip, search, scope/type filter chips, owner + latest-version + type/element-count chips, fork/visibility/publish/update row actions), update confirmation dialog (nested — Radix highest-layer Escape only) + update-available chip (older version = rollback), visibility toggle, publish-update via `publishCatalogInstallUpdate` (whole spec / subtree extraction, foreign-asset guard), screen install + fork navigate to the new screen; public browse (decision 11): `ownerId` on asset/version + mappers + sanitize backfill, `lib/catalog/browse.ts` tab-open adoption (explicit columns, LWW), `SyncSpec.fullColumns` replaces phase-2 `SELECT *` on all 6 specs, `ownedBy` push + delete guard via session-lifetime `foreignIds`; fork RPC v2 re-applied live (`plan_066_fork_catalog_asset_v2`, via Management API — session MCP unavailable): DO-block passed 10a target_key clear, 10b screen-only membership swap (component fork leaves the host row), 10c install-create — caught + fixed a missing `id` in the insert — foreign private / foreign version / unsigned refused, anon EXECUTE denied, zero leftover rows; raw-string audit: filter literals → `CATALOG_SCOPES`/`CATALOG_TYPE_FILTERS` object constants; en/es key parity; tests: browse +5, install +4, catalog +2, sync +1 → gate 942 pass / 0 fail |
| 2026-11-04 | Task 5 done — `e2e/catalog.spec.ts` (5 tests: two-project pin, fork isolation, private-vs-public install RLS, device A→B, idempotent template migration) + `e2e/db.ts` helpers with a 45s remote-install gate; suite green serially but 3/10 failed under parallel load. Root cause found with request-body capture: a multi-row push is ONE statement, so a single row whose `uis` parent was not remote yet (`42501` from the WITH CHECK that requires it, or `23503` FK) refused the entire batch — which carried rows from several concurrent sessions (12-row `project_screens`, 6-row `catalog_installs`) — stranding every healthy row, retries included. Fix: `lib/history/sync.ts` retries a refused batch row by row, keeps a steady capped retry after the fast budget (a stranded row still converges once its parent lands), and guards the chain so a rejected task cannot silently skip every later push; 3 new unit tests. Verification: full e2e 138 passed (1.1m), stress 5 workers × 2 repeats 10/10, gate 948 pass / 0 fail |
