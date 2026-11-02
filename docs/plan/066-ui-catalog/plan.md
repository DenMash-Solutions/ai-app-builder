# UI Catalog — Versioned Screens and Components

**Status:** approved
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

- [ ] Install = version-pinned snapshot copy: new `uis` row for screens,
      expanded subtree for components (decision 1)
- [ ] Explicit update flow: installed vs latest version, confirmation,
      rollback to a previously installed version
- [ ] Fork-on-edit as one RPC/transaction: read version → create copy →
      initial revision → swap reference (decision 4), concurrency-safe
- [ ] Insert seam in `components/playground/`: expansion at install with
      fresh keys + `data-template-id` provenance (062 decision 3)

### 4. Catalog UI

- [ ] Catalog tab in the Insert picker (decision 7): search, filters
      (all/mine/public/private, screens/components), owner, latest
      version, preview
- [ ] Visibility toggle whose change never invalidates installations

### 5. Tests

- [ ] Unit: version monotonicity, immutability rejected at the DB layer,
      install pinning survives a new latest version, fork gets independent
      identity and revision 0
- [ ] e2e: two projects install v1 → v2 published → both still render v1;
      fork in A leaves B unchanged; private install denied (service-client
      assertion); an install made on one device appears on another
      (064 pattern, decision 9)
- [ ] Signed-out local template library still works; migration seeds without
      duplicates; full gate

## Verification

- [ ] `bun run format && bun run lint && bunx tsc --noEmit && bun run test`
- [ ] Unit: version monotonicity, immutability rejected at the DB layer,
      install pinning survives a new latest version, fork gets independent
      identity and revision 0
- [ ] e2e: two projects install v1 → v2 published → both still render v1;
      fork in A leaves B unchanged; private asset install denied by RLS
      (service-client assertion)
- [ ] Local template library still works signed out; migration seeds without
      duplicates; full gate

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-31 | plan drafted |
| 2026-11-02 | clarifications answered (Insert-picker tab, screen install = uis row + membership in active project, catalog joins account sync); decisions 7-9 added, decision 3 resolved to a BEFORE UPDATE/DELETE trigger; scope + files + tasks updated |
| 2026-11-02 | approved — recommended options accepted as decisions 7-9 |
| 2026-11-02 | Task 1 done — migration `plan_066_catalog_schema` applied (live: 11 tables, 37 policies, 5 functions); DB rejection test passed (UPDATE refused, direct DELETE refused, spec unchanged, asset cascade cleans versions+installs); advisors: no ERRORs — 0012 fires on all 11 tables project-wide (anonymous sign-ins enabled, pre-existing shape), F5/F6/genui-search-path WARNs pre-existing |
| 2026-11-02 | Task 2 done — `lib/catalog/` store (CRUD, publish, install pins, id-keyed seed + `startTemplateSeeding`), `setTemplateSavedListener` seam, 3 sync loops with `immutableRows` (strict `>` + no delete pass) and version-collision renumber reconcile; tests: catalog 11, templates +1, sync +5 → gate 917 pass / 0 fail |
