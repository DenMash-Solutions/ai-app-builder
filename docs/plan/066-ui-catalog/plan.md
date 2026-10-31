# UI Catalog — Versioned Screens and Components

**Status:** draft
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
   catalog asset is later changed.
4. Fork-on-edit runs as one transaction/RPC: read version → create copy →
   initial revision → swap reference — rejected: client-side multi-step,
   because partial migration was explicitly forbidden.
5. Existing templates keep working when signed out; first save while signed
   in seeds a catalog row — rejected: forced bulk migration, because local
   libraries must not break.
6. Public assets are visible to everyone but installable as copies only;
   editing someone else's asset is never possible — rejected: shared-edit
   assets, because per-owner revisions (`uis` is owner-scoped) can't merge.

## Files

`db/` migration + RLS for assets/versions/installs,
`lib/editor/templates.ts` (+tests), new `lib/catalog/`, catalog UI panel,
`components/playground/` insert seams, en/es keys, `e2e/` catalog spec.

## Tasks

### 1. Schema and immutability (db/)

- [ ] `catalog_assets` migration (id, owner_id, name, description,
      type screen|component, visibility, latest_version_id, timestamps) +
      RLS per file pattern
- [ ] `catalog_asset_versions` (asset_id, monotonic version, spec,
      changelog, created_at) with unique(asset, version) mirroring
      `page_versions`
- [ ] DB-enforced version immutability — trigger or column permission
      (decision 3) — with a rejection test at that layer
- [ ] Install rows: source asset id + version id pinned; ownership copied
      to the installing project

### 2. Catalog library (lib/catalog/)

- [ ] Asset and version CRUD on the existing client/seam patterns
- [ ] Publish-new-version flow: keep old version, insert immutable version,
      bump `latest_version_id`, optional changelog
- [ ] Lazy seed of the `genui-component-templates` localStorage library into
      catalog rows without duplicates (decision 5)

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

- [ ] Panel reusing the existing template UI: search, filters (all/mine/
      public/private, screens/components), owner, latest version, preview
- [ ] Visibility toggle whose change never invalidates installations

### 5. Tests

- [ ] Unit: version monotonicity, immutability rejected at the DB layer,
      install pinning survives a new latest version, fork gets independent
      identity and revision 0
- [ ] e2e: two projects install v1 → v2 published → both still render v1;
      fork in A leaves B unchanged; private install denied (service-client
      assertion)
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
