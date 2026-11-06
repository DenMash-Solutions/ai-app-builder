# 073 — Project Template Marketplace — Implementation Plan

**Status:** approved
**Date:** 2026-11-06
**Owner:** user-initiated feature idea (2026-11-06 discussion); sequencing decided same day: 072 (F22) → **073 templates** → F23 later.

## Goal

Let a user browse a catalog of complete project templates (e.g. an
ecommerce store), **preview one interactively** — navigate Home →
Products → Cart, play with it — and then choose it: one deterministic
install creates the project's screens, routes, home and component
installs, after which the user customizes it by model (072's F22 makes
generations reuse the installed components) or by the UI (editor,
settings). It also grows the workspace panel into a proper **project
settings surface** (pages / sources / components), which the discussion
identified as missing regardless of templates.

## Scope

### In scope

- **Catalog: third asset type `project`**
  - `CATALOG_TYPES.project` (lib/catalog/catalog.ts:40) + DB migration
    widening `catalog_assets_type_check` (`('screen','component')` →
    + `'project'`).
  - Per-type publish validation: `publishCatalogVersion` branches —
    screen/component → existing `isSpec`; project → new
    `isProjectManifest` (every screen spec passes `isSpec`, slot keys
    exist in their screen's elements, slot/component ids consistent).
  - Local type widening: `CatalogAssetVersion.spec` becomes
    `Spec | ProjectManifest` (discriminated by the owning asset's type);
    sync row validators, browse adoption and fork-on-edit RPC stay
    shape-agnostic (jsonb) and need only the enum widening.
  - **Manifest shape** (stored in the existing `spec` jsonb column):
    ```ts
    interface ProjectManifest {
      screens: Array<{
        name: string;
        route: string | null;        // "products/{id}" — membership store normalizes
        home?: boolean;              // exactly one (default: first)
        spec: Spec;                  // committed demo screen spec (slot-* elements intact)
        slots?: Record<string, string>; // slot element key → component asset id
      }>;
      components: string[];          // component asset ids the template needs (pins + F22 listing)
    }
    ```
- **Installer — `lib/catalog/project-install.ts`**: given a target
  project id + adopted manifest: create each screen (`createEntry` →
  `addScreenToProject` → `setMembershipRoute`), set home
  (`homeScreenId` via first-member rule / explicit), then for every
  `slots` mapping expand the component into the slot through the picker's
  own seam (`insertCatalogComponent` — fresh keys, `data-template-id`
  provenance, install row with real host + root target, version pinned),
  so 071's update/rollback fan-out works on template-installed copies
  exactly like hand-installed ones. Referenced component assets are
  adopted first via `adoptPublicCatalog()` (066 decision 11 path).
- **Picker: Templates surface** — the type filter gains a `project`
  chip; project cards show name, description, screen count and slot
  summary; actions **Preview** and **Use**.
- **Preview = ephemeral project (user decision 2026-11-06)** — Preview
  creates a throwaway project named `Preview: {template}`, installs the
  manifest into it, activates it and shows a banner: **Use this
  template** (keep — strip the `Preview: ` prefix, normal project from
  then on) / **Discard** (`purgeProjectData(projectId)` — local sync +
  best-effort remote, the existing deletion path — plus store removal and
  active-project cleanup). Interactive because it IS a project:
  navigation, cart state, forms all work.
- **First-party curated seeds (user decision 2026-11-06)** —
  `demo/ecommerce` becomes the first template: its 7 screen specs +
  7 v2 component specs + slot mappings assembled into a manifest by
  `demo/ecommerce/load-template.ts` (single source of truth shared with
  tests and the generator), `scripts/generate-template-seed.ts` renders
  `db/07_project_templates.sql` (fixed UUIDs, `on conflict do nothing`,
  owner = admin-email subselect with graceful skip, asset + version 1
  rows with `visibility = 'public'`). Follows the existing precedent —
  "catalog assets are seeded at the DB layer" (e2e/ecommerce.spec.ts).
  The demo screens declare local-fixture data sources, so the template
  runs everywhere with zero env configuration.
- **Project settings surface** — workspace panel grows two sections
  next to the existing Pages (routes + home): **Sources** (union of the
  `dataSources`/`queries` declared across the project's screen specs +
  configured/missing status, publish-dialog precedent) and **Components**
  (071's install list with lowest-pinned → latest + the project-scoped
  update action). Read-only over stores that exist — no new store.

### Out of scope

- **User-published templates** ("share my project as a template") —
  v1 is first-party curated seeds only (user decision 2026-11-06).
- Marketplace taxonomy — categories, ratings, install counts, author
  pages, featured slots; the picker's existing search/name filter only
  (descoped 2026-11-06).
- **Template upgrades** — re-running a template into an EXISTING project
  (component-level updates stay covered by 071's pin/update flow)
  (descoped 2026-11-06).
- Partial install ("just the checkout flow") (descoped 2026-11-06).
- Data-source provisioning — templates may REQUIRE configured sources
  (surfaced with the publish-dialog notice pattern) but never configure
  env themselves (descoped 2026-11-06).
- Published/live-site previews — preview is the ephemeral local project
  (user decision 2026-11-06; rejected per decision 2 below).
- F23 planner / "Build project" — separate plan, sequenced after this
  one (2026-11-06 decision); its decisions live preserved in 072.
- Editing a template's manifest through the app (first-party seeds are
  authored in `demo/` and regenerated) (descoped 2026-11-06).

## Design decisions

1. **Template = one `project` catalog asset whose version holds a
   manifest** (shape above). Rejected: a bundle of N linked screen
   assets — fork/version/visibility would need N coordinated writes and
   the picker would show N rows for one product; rejected: encoding the
   manifest spec-shaped (`root`/`elements` abused as manifest fields) —
   it would pass `isSpec` untouched but stores data the renderer must
   never see and still needs decode-side validation → a dishonest schema.
   Widening `publishCatalogVersion` to branch on asset type is the real
   cost and is a plan task, not a blocker.
2. **Preview = ephemeral local project (user decision 2026-11-06).**
   Interactive because it is a project; Use keeps, Discard purges via
   `purgeProjectData` (local + best-effort remote — since plan 064
   projects sync, this one call covers both surfaces; no new sync lane).
   Rejected: a published live site per template — needs a handle +
   publish per template and a republish on every template update;
   rejected: static single-screen render — fails "play with it".
   Known wrinkle accepted: a mid-preview crash leaves a `Preview: …`
   project behind (a normal project the user can delete — harmless).
3. **Composition = slot map, not provenance scanning.** The demo screens
   already declare `slot-*` elements and the picker already installs
   components into them (e2e `installComponent` drives the real flow);
   the manifest's `slots` mapping makes that expansion deterministic at
   install time. Rejected: scanning imported specs for `data-template-id`
   markers — the committed demo specs carry **no** markers (verified
   2026-11-06); rejected: pin-only installs with null targets — 071's
   update fan-out would have no copies to swap, defeating reuse.
4. **Seeding = committed manifest + generated SQL (DB layer).**
   `load-template.ts` assembles the manifest from the committed
   `demo/ecommerce/*.spec.json` (no duplicated specs); the generator
   emits an idempotent `db/07_project_templates.sql`. Rejected:
   client-side fixed-id seeding — `owner_id` is per-user, so identical
   fixed ids uploaded by every client collide on the PK with different
   owners (the `ownedBy` push guard exists precisely to stop foreign
   rows); rejected: runtime seeding from the client — browse reads the
   DB directly (`browse.ts`), so the rows must exist there.
5. **Installer is a pure module over the existing stores**
   (`lib/catalog/project-install.ts`), not UI code: project creation and
   the Preview/Use/Discard lifecycle stay in the component that owns the
   picker; screens/routes/home reuse 065/061 stores; component expansion
   reuses `insertCatalogComponent` verbatim (decision 3). A failed
   install mid-way leaves a partial project → the preview banner's
   Discard (or store deletion) is the documented recovery; the installer
   reports which step failed.
6. **Settings = sections in the existing workspace panel** (it already
   owns Pages/routes/home), reading stores that exist (history specs for
   sources, 071 install rows for components). Rejected: a separate
   settings route/dialog — splits route editing (already there) from the
   rest and adds navigation for read-mostly data.
7. **Local-first compatibility:** browse/adopt/install already work
   signed-out (local store); the SQL seed only matters for cross-device
   browse, and preview/purge behave identically signed-in (remote purge
   best-effort) or signed-out (local only).

## Verification

- [ ] `bun run format && bun run lint && bunx tsc --noEmit && bun run test`
- [ ] Migration applied via Supabase MCP (`catalog_assets_type_check`
      accepts `'project'`) and `db/01_schema.sql` check constraint kept in
      sync (README re-runnable contract).
- [ ] Unit — `isProjectManifest`: valid manifest passes; bad screen spec,
      dangling slot key, slot → non-listed component, two `home` flags
      fail; `publishCatalogVersion` branches per type (project manifest
      rejected for a screen asset and vice versa).
- [ ] Unit — installer: screens created with memberships/routes/home in
      order, slot expansion produces install rows with real targets +
      `data-template-id`, unknown component id fails the install with a
      step-labeled error, idempotence guard (re-run doesn't duplicate).
- [ ] Unit — `load-template.ts` manifest: 7 screens, one home, every slot
      key exists in its screen spec, component ids match the seed set;
      generator output contains fixed UUIDs + `on conflict do nothing`.
- [ ] Unit — settings sections: sources union dedupes across screens and
      flags missing config; components section shows lowest pinned →
      latest.
- [ ] e2e (extends the seeded-DB pattern of `ecommerce.spec.ts`) —
      browse shows the template → Preview opens a navigable multi-screen
      project with the banner → **Use** keeps it (prefix stripped,
      memberships/routes intact) → settings panel shows Pages/Sources/
      Components → a second preview → **Discard** removes the project.
      A component update through 071's flow swaps a template-installed
      copy (slot target exists).
- [ ] Full chain: `bun run lint && bunx tsc --noEmit && bun run test` +
      `bun run test:e2e` (or the per-spec scripts; catalog/ecommerce
      flakes → `--workers=1`, no timeout raises — mistake #32).
- [ ] Optional MCP/live: on the real account, preview the ecommerce
      template, play (navigate + add to cart), Use it, confirm Sources
      and Components in settings, Discard it.

## Status log

| Date | Note |
| ---- | ---- |
| 2026-11-06 | Drafted (Step 0 done: lessons grep — `template-derived-strings` #22, `radix-escape-capture`, `mcp-verification`; json-render skill loaded earlier this session; seams researched: `CATALOG_TYPES`/`publishCatalogVersion`/`isSpec`, `browse.ts` `adoptPublicCatalog`, sync `ownedBy` decision 11, DB `type check` constraint, `insertCatalogComponent`, demo slot architecture, `createProject`/`purgeProjectData`, `seedCatalogAsset` DB-layer precedent). User decisions: ephemeral preview, sequencing F22 → templates → F23, v1 first-party seeds. |
| 2026-11-06 | **Approved** by user (alongside 072 and 074). |
