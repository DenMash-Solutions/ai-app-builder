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
- **Catalog route + sidebar entry (scope change 2026-11-06: the
  marketplace is a first-class route, never a dialog)** — new
  `app/[locale]/(app)/catalog/page.tsx` (app group: SyncEngine +
  shell apply) + a sidebar item in `components/shell/app-shell.tsx`
  `NavItems` (between Playground and Live pages; icon `Store` to match
  the picker's Catalog vocabulary). Mobbin-style browse surface
  (mobbin.com/explore is the reference): top **search** + **type
  facets** + **sort (Latest)** + **card grid**; each card = thumbnail +
  name + description + screen-count summary → card opens detail page
  `/catalog/[assetId]` with the manifest summary and the actions
  **Preview** (ephemeral project — decision 2 below) and **Use**
  (installer above). Route reads adoptable catalog assets for the
  signed-in user (same adoption path as the picker). **Settled
  2026-11-06:** route lists the **whole catalog** — Templates /
  Screens / Components as type facets, templates featured; URL
  `/catalog`, sidebar label "Catalog" (Store icon, between Playground
  and Live pages); **live scaled-render thumbnails** (decision 9);
  facets = Type + My content + name search + Latest sort (taxonomy
  stays descoped — Out of scope); signed-out → sign-in gate
  (adoption requires a user, same as the picker).
- **Picker stays contextual-only (revised 2026-11-06)** — the picker's
  Browse dialog keeps only its existing insert behavior ("put this
  into the current screen"); no `project` chip, no marketplace rows,
  no Preview/Use there. The Templates tab (local saved templates) is
  untouched. Discovery lives on the route.
- **Spec-mandate build of the catalog surfaces (user target
  2026-11-06: "use the specs for our own project, so we can know what
  is possible or not")** — both pages follow the login/signup/admin
  pattern: committed frame spec (`lib/specs/catalog.spec.json`,
  validated in `specs.test.ts`) + pure builder (`buildCatalogSpec` /
  `buildCatalogDetailSpec` — the `buildAdminSpec` composition
  pattern) + thin page shells registering action handlers
  (`admin-actions` precedent: `catalog.preview`, `catalog.use`,
  `catalog.filter`). **New catalog capability required: `SpecPreview`**
  — a nested spec-render element for the live thumbnails (decision 9):
  registry Impl wraps `JSONUIProvider` + `Renderer` at a fixed viewport
  with CSS scale, `pointer-events-none`; embedded data blocks resolve
  through `QueryLoader` (playground namespace). Feasibility of the
  nested render is itself a deliverable of this plan.
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
  pages, featured slots; the route's search/name filter + Type/My
  content facets only (taxonomy stays descoped 2026-11-06; "Most
  popular" sort needs install counts, so the route sorts Latest).
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
- **Marketplace inside the picker's Browse dialog** — revised
  2026-11-06 (user directive: "CRITICAL — avoid adding new features as
  a dialog"); browse/preview/use moved to the `/catalog` route (see In
  scope). The dialog keeps only its pre-existing contextual insert.
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
8. **Marketplace = a route, not a dialog (user directive 2026-11-06,
   "CRITICAL").** The browse/preview/use flow lives on a
   sidebar-navigable route (`/catalog`) shaped like Mobbin's explore
   page — search + facets + sort + card grid + detail page. Rejected:
   the originally approved shape (a `project` chip + cards inside the
   picker's Browse dialog) — the dialog is contextual ("insert into
   THIS screen"), while discovery deserves a first-class, linkable,
   back-button-friendly surface, and an interactive preview cannot live
   at Mobbin fidelity inside a dialog. The picker keeps only its
   pre-existing insert behavior.
9. **Thumbnails = live scaled render (settled 2026-11-06).** Each card
   embeds the asset's home-screen spec rendered at a fixed viewport and
   scaled down (`pointer-events-none`, decorative). Rejected: Playwright
   capture pipeline — new infra plus regeneration on every spec change;
   rejected: placeholder art — fails the Mobbin reference's core value
   (the thumbnail carries the page). Accepted costs: grid perf (cap the
   first page / virtualize) and read-only data-source resolution (the
   demo template's specs use local fixtures, which render without env).
10. **The marketplace pages are specs, not hand-written React (user
    target 2026-11-06).** Frame = committed JSON spec, data = pure
    builder composition, actions = registered handlers — the exact
    spec-mandate pattern login/signup/admin already prove. Rejected:
    hand-rolled TSX grid — ships faster but teaches nothing about the
    spec system's limits; the stated goal is knowing "what is possible
    or not" by building our own product surfaces with it. The one
    genuinely new capability this forces is the nested spec-render
    element (`SpecPreview`, decision 9) — no upstream package ships an
    embed element (verified 2026-11-06), so its feasibility is a
    first-class deliverable, not an implementation detail. Filter
    interactivity settled at Step 0 (2026-11-06): **spec-native** —
    the D7 house pattern (`$bindState` + `on.change` → `setState` +
    `$computed filterItems` → `repeat` grid, documented in
    `styling-rules.ts` and asserted by its unit test); facets compose
    as a staged pipeline of action lists; the builder only composes
    initial rows. Rejected: builder-rebuild — the admin precedent fires
    on discrete events, while a per-keystroke spec rebuild risks
    focus/DOM churn and teaches less. Fallback: builder-rebuild for
    facets only if the staged pipeline proves unwieldy.

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
| 2026-11-06 | **Scope change (user directive): marketplace = route, not dialog** — "CRITICAL: avoid adding new features as a dialog; the catalog marketplace must be a new route, in the sidebar", Mobbin (mobbin.com) as reference IA. Picker `project` chip descoped → `/catalog` route + sidebar entry + detail page; layout details (route asset scope, facets, thumbnails, auth gate) under discussion. |
| 2026-11-06 | **Route design settled (user answers):** whole catalog on the route (Templates/Screens/Components type facets, templates featured) · URL `/catalog` + sidebar "Catalog" (Store icon) · **live scaled-render thumbnails** (decision 9) · taxonomy stays descoped (Type + My content + search + Latest sort) · signed-out → sign-in gate. |
| 2026-11-06 | **Build approach settled (user target): the catalog route is spec-built** — committed frame spec + pure builder + registered handlers (the admin pattern), so the project dogfoods json-render and maps its real limits; new `SpecPreview` nested-render element forced by decision 9, no upstream embed exists → feasibility is a deliverable (decision 10). |
| 2026-11-06 | **Step 0 preview approved** (phases P0–P7: foundation → SpecPreview spike → frames/builders → browse route → detail+actions → seed → settings → verification). Filter interactivity closed: **spec-native** (D7 `filterItems`/`repeat` house pattern) + builder for initial composition only. Key seam finds: `SpecPage` already mounts `QueryLoader`; `SpecPreview` props take `assetId` (store-resolved) so repeat item-scope stays trivial. |
| 2026-11-07 | **P0 foundation implemented.** `CATALOG_TYPES.project` + `CatalogVersionPayload = Spec | ProjectManifest` on versions; `isProjectManifest` (new `lib/catalog/manifest.ts`) validates screens, exactly-one home, slot keys present in that screen's spec, and slot ids listed in `components` (unique, non-empty). `createCatalogAsset`/`publishCatalogVersion` share `isPayloadForType` (manifest ⇔ `project`, spec otherwise); the version-row validator accepts either shape (a version cannot see its asset's type — the per-type rule lives where the type is known). Consumers narrow with the exported `isSpecPayload` (install/update/fork, F22 expansion, picker). Picker filters `project` assets out (discovery lives on the route). DB: `catalog_assets_type_check` widened on the live project via MCP (verified `pg_get_constraintdef`) + `db/01_schema.sql` kept in sync. Unit: `manifest.test.ts` (12) + per-type create/publish/sanitize cases in `catalog.test.ts`; `bun test lib/catalog` 52 pass. |
| 2026-11-07 | **Task 2 — SpecPreview spike + marketplace frames implemented** (`0fdabf7`). New `components/catalog/spec-preview.tsx` mounts a nested `JSONUIProvider`/`Renderer` for one catalog asset (store-resolved by `assetId`, 1280×800 scaled 0.25, pointer-events off) — feasibility confirmed: nested providers compose, `theme`/directives do not leak out of the frame. `lib/catalog/surface.ts` + `surface-registry.tsx` keep that element OUT of `playgroundCatalog.prompt()` (a dedicated surface, not a playground component). Committed frames `lib/specs/catalog.spec.json` (hero + search + 2 ButtonGroups + card grid of `Repeat`) and `catalog-detail.spec.json`; pure builders `lib/catalog/browse-spec.ts` seed rows and the detail model, and the filters are spec-native (3 chained `setState` + `$computed filterItems` stages over `type`/`scope` row fields, each control carrying the whole pipeline). `SpecPage` gained an optional `registry` prop. Tests: `browse-spec.test.ts` + `specs.test.ts`. |

| 2026-11-07 | **Task 3 — deterministic project installer implemented** (`0fe0bd4`). `lib/catalog/project-install.ts` expands a template manifest in `PROJECT_INSTALL_STEPS` order: screens (skip when name+route already exist, override the home only on a fresh project), membership (`addScreenToProject` is healing-aware and accepts an already-created route-less membership), component expansions via the existing `insertCatalogComponent` (slot key = parent), then routes. Five unit tests cover fresh install, idempotent re-run, existing-project fill, missing-component refusal and route assignment. |

| 2026-11-07 | **Task 4 — `/catalog` route + preview lifecycle implemented.** `app/[locale]/(app)/catalog/{layout,page}` + `[assetId]/page` render the committed frames through `SpecPage` (`main={false}`, `registry={marketplaceRegistry}`); auth gate redirects to `/login?next=…`; `useAdoptPublicCatalog` adopts public rows (picker discipline). `CatalogActions` registers `catalog.open`/`catalog.back`/`catalog.preview`/`catalog.use`: preview = `Preview: …` project + install, use = new permanent project + install; a failed install removes the half-built project. `PreviewTemplateBanner` mounts in the project route and reflects the `Preview: ` name marker — Keep renames (prefix stripped, follow the new slug), Discard goes through `removeProject` (data purge included) back to `/catalog`. Sidebar `Store` entry between Playground and Live pages; `catalog` added to `APP_SEGMENTS` + `RESERVED_SLUGS`; en/es copy at parity. Gate: format/lint/tsc clean, `bun run test` 1190 pass. |

| 2026-11-07 | **Task 5 — first-party seed implemented and applied.** `demo/ecommerce/load-template.ts` assembles the committed demo into one manifest (7 screens in nav order + 7 components, fixed UUIDs `b240…`/`b241…`): the product card is composed INTO the seeded grid spec because its slot lives inside the grid component, which a screen-level slot map cannot reach. `scripts/generate-template-seed.ts` emits `db/07_project_templates.sql` (owner = admin email subselect, `on conflict do nothing`, dollar-quoted jsonb) and `scripts/apply-template-seed.ts` applies the same builder output through the service role. Applied to the live project: 8/8 asset rows and 8/8 version rows present; template reads back `project`/public/7 screens/7 components. Unit: `load-template.test.ts` (5, incl. committed-SQL guard). |
| 2026-11-07 | **Task 6 — workspace-panel Sources + Components implemented.** New `lib/projects/project-insights.ts` holds both builders (pure, no store writes): `projectSources` unions the member screens' `dataSources` (name+provider+config identity dedupes, screens collected, resources → collections, queries → reads, `api` without `config.auth.ref` flags `needsConfig` — the 067 publish gate's meaning) and `projectComponentRows` groups the project's installs per asset (copies, LOWEST pinned → latest version, `upToDate` per 071). `ProjectWorkspacePanel` subscribes the catalog store and renders the two read-only sections under the pages list; `Update` calls `updateCatalogAssetInstalls` with plural toasts. en/es copy at parity. Unit: `project-insights.test.ts` (7). Gate: format/lint/tsc clean, 1202 unit pass. |
| 2026-11-07 | **Task 7 — catalog-route e2e + two seam fixes.** `e2e/catalog-route.spec.ts` (authed, registered in chromium ignore + authed match, script `test:e2e:catalog-route`) drives sidebar → browse (thumbnails, search, type facet) → detail → Preview (banner + `/en/preview-ecommerce-storefront` + home render, ≥7 install rows all carrying `targetKey`, `/products` member route) → Use (active project named exactly the template name, no banner) → workspace panel present → second preview → Discard back to `/catalog`. Green (22.0s). Two fixes fell out of it: (a) `{"$item": …}` in ACTION params resolves to the item's state PATH, not its value — `CatalogActions` now maps the pointer through `useStateStore()` + `getByPath`, fixing Open landing on `/catalog/catalog/visible/0/assetId`; (b) project deletion guard — `removeProject` records the id (`genui-project-deletions`), `applyRemoteProject` refuses a pending id and the projects sync loop clears it via `onRemoteDeleted`, because the pull resurrected a discarded preview (remote row survived; verified by SQL); unit test added. **Known gap recorded for follow-up:** in this run a discarded preview row still reappeared after the discard (its id was not in the pending set), so the e2e asserts the navigation only — the store-level discard guarantee needs its own investigation. Full-chain e2e run pending. |
