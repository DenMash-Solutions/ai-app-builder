# 071 — Catalog updates address every copy in a project

**Status:** implemented
**Created:** 2026-11-06
**Owner:** catalog (plan 066) follow-up, surfaced by plan 070

## Goal

A catalog asset installed on several screens of one project must update as one
thing. Today the picker resolves a row's install with `projectId + assetId`
only, so with the demo's navbar on seven screens it reports (and re-pins)
whichever install the array happens to list first: the status chip describes
one copy, the Update button can be missing while six copies are behind, and
one click silently updates an arbitrary screen. Plan 070's decision 11 assumes
the opposite — one navbar version across all seven screens — so the two
features disagree in public.

## Scope

**In scope**

- `lib/catalog/install.ts`: `updateCatalogAssetInstalls(assetId, projectId,
  versionId?)` — one project-scoped entry point that re-pins every copy of the
  asset in that project through the existing `updateCatalogInstall`, so
  validation and the content swap stay in one place.
- Picker row status: `behind` when ANY copy is behind; the version chip shows
  the lowest pinned version → latest.
- `CatalogUpdateDialog`: takes the copies (`installs`), marks "Installed" for
  any copy's version, and labels the confirm with the copy count when > 1
  (`updateToMany` / `rollbackToMany`).
- Unit coverage for the fan-out (all copies move, other projects untouched,
  deleted host still re-pins, unknown ids rejected).

**Out of scope**

- One row per install (screen-labelled). It is the alternative design, allows
  versions to drift, and contradicts 070 decision 11 — rejected below.
- Per-copy rollback. Rollback moves the same set; a mixed-version project stays
  possible only through history/undo, which is the existing escape hatch.
- The `publishUpdate` action (publishes a working copy's spec as the next
  version): it still reads the first copy, which is correct for "publish what
  this project currently shows".

## Design decisions

1. **One row per asset, project-scoped actions.** The install row is a
   statement about the asset in the project, not about one materialized copy;
   the picker has no host selector and adding one is more UI than the demo
   needs. Rejected: per-install rows (see Out of scope).
2. **Fan out at the install layer, not in the component.** The dialog calls
   `updateCatalogAssetInstalls`; each copy still goes through
   `updateCatalogInstall`, so pin validation, `applied` reporting and the
   revision-stack swap are unchanged. Rejected: looping in `component-picker`
   (untestable without a DOM) and a new RPC (the local-first store plus sync
   is the established write path).
3. **`behind` = any copy's `versionId` differs from `latestVersionId`.** A
   single copy on v2 must not make a row look current while another sits on
   v1. The chip shows the LOWEST pinned version, which is the version the
   update will actually move away from.
4. **Already-current copies are untouched.** The fan-out skips them before
   calling `updateCatalogInstall` (which is a no-op returning `null` for an
   unchanged pin) and reports them as `unchanged`, so the result distinguishes
   "moved 3, 4 already current" from "matched nothing".

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test`
- [x] New unit tests in `lib/catalog/install.test.ts`: three component copies
      in one project all move to v2 (`applied` true each), a second project's
      copy stays on v1, a deleted host re-pins with `applied: false`, unknown
      asset/version return `null`, and a repeat update reports `unchanged`.
- [x] Existing catalog e2e (`e2e/catalog.spec.ts`) still finds the
      update-available chip and the `Update` action on a single-copy install —
      the row contract the picker keeps. Run green: 131 passed (chromium +
      catalog), exit 0, `--workers=1`.
- [x] Manual check on the real account (optional, MCP): **not applicable** —
      a DB probe of the real "E2E Shop 070" project returned `[]` for
      `catalog_installs` (project scope) and `[]` for navbar-named
      `catalog_assets`: its seven navbars were installed from the Templates
      tab (local component templates), not as catalog installs, so there is
      no navbar row to drive. The fan-out is covered by the unit tests above.

## Status log

| Date | Note |
| ---- | ---- |
| 2026-11-06 | Drafted after the 070 update-safety investigation: the picker's `find(projectId && assetId)` + `limit(1)` DB reads made a per-screen assertion impossible, and the fix is to make the action project-scoped rather than teach the UI about individual copies. Approved in chat ("fix it"). |
| 2026-11-06 | Implemented — fan-out `updateCatalogAssetInstalls` + picker project-scoped rows (`behind` = any copy behind, chip = lowest pin) + dialog `installs` set + plural confirm labels (en/es) + 2 new unit tests. Gate green: format/lint/tsc clean, 1138 unit pass; catalog e2e green (131 passed, exit 0). Optional MCP check recorded not-applicable above (DB probe `[]`). |
