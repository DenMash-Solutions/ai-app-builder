# Ecommerce Reference Application (end-to-end proof)

**Status:** approved
**Date:** 2026-10-31 (scope guard refreshed 2026-11-05 against `5d0cb04`)

## Goal

Prove the whole architecture with one coherent multi-screen application: a
user builds, reuses components from, and publishes an ecommerce app without
assembling unrelated standalone UIs — **and the UIs work as ONE system**:
the same chrome on every page, cart data that travels between pages, and
navigation that holds up across the whole app (user directive 2026-11-05:
"make sure the UIs are working as a system"). Cross-page coherence is
first-class acceptance, not a side effect.

## Scope

### In scope

- One project with **7 screens**: Home, Products, Product details, Cart,
  Checkout, Orders, Order details
- **7 catalog components**: Navigation bar, Product card, Product grid,
  Price display, Cart item, Cart sidebar, Checkout summary — installed
  from at least two different versions and reused in a second project
- **4 data resources**: Products, Customers, Cart, Orders
- The 15-scenario script as an automated e2e spec
  (`e2e/ecommerce.spec.ts`) plus a scripted MCP spot-check
- Seed specs committed under `demo/ecommerce/`, seeded from the existing
  keyless Pokédex specs' provenance (`demo/pokedex/*-keyless-spec.json`)
  — `demo/` is organised one folder per demo (convention, see decision 9)
- README/docs section describing how to replay the demo

### Out of scope

- Payments, real commerce backend, external API quota in CI (fixtures only)
- Marketing/landing pages beyond the Home screen
- Marketplace behavior — components are authored, not purchased
- **Project-level generation orchestration** ("build me an ecommerce
  project" in one prompt → planner → per-screen generations) — the
  long-term target, but a separate plan; 070 proves the assembled system
  with committed specs (descoped 2026-11-05 → follow-up **F23**)
- **Generation-time component awareness** (the model knowing a project
  already has a navbar) — product prompt gap, separate plan (descoped
  2026-11-05 → follow-up **F22**); 070 proves the manual catalog-install
  consistency flow instead

## The 15 scenarios (acceptance script)

1. Create an ecommerce project
2. Generate multiple screens into it
3. Add a component from the catalog (install a specific version)
4. Reuse that component version in a second project
5. Publish a newer catalog version → existing installations unchanged
6. Fork the component in project A → project B still on the original
7. Connect shared data resources
8. Navigate between screens via the navigate action
9. Test dynamic routes (product details by id)
10. Publish the project
11. Access the live application
12. Update the project and verify routing and persistence
13. Handle change → old URL redirects
14. Second project unaffected throughout
15. Anonymous visitor sees published pages only

**Acceptance:** a user can build and publish a coherent multi-screen
application without manually assembling unrelated standalone UIs — and every
existing single-UI flow still works.

## Spec inventory (fixed 2026-11-05)

### Screens (7) — `demo/ecommerce/screens/`

| # | Screen | URL (live, workspace-configured) | Content | Data | Navigates to |
|---|--------|----------------------------------|---------|------|--------------|
| 1 | Home | `/` (project front door) | Hero + featured products grid, quick links | `products` list (fixture) | Products, Cart, Checkout, Orders |
| 2 | Products | `/products` | Full product grid + live search/filter (`STYLING_RULES` filter pattern) | `products` list (fixture) | Product details |
| 3 | Product details | `/products/{id}` | Detail view, **Price display**, qty + **Add to cart** | `products` get-by-id + `cartItems` **create** | Products, Cart |
| 4 | Cart | `/cart` | **Cart item** rows: qty stepper (update), remove (delete), line totals, go-to-checkout | `cartItems` list + update/delete | Checkout |
| 5 | Checkout | `/checkout` | Shipping form (validateForm-gated), customer prefill, **Checkout summary**, Place order | `customers` read; `cartItems` read; `orders` **create** | Orders (after placing) |
| 6 | Orders | `/orders` | Placed orders list (id, date, total, status) | `orders` list | Order details |
| 7 | Order details | `/orders/{id}` | One order: line items, **Price display**, totals | `orders` get-by-id | Orders |

All 7 carry the **Navigation bar**; every screen that shows cart chrome
declares the `cartItems` blocks (decisions 10–11). Spec-level `route`
contracts follow task 1 / the 069 workspace-config precedent (`{id}` for
the detail screens; the workspace owns the final paths).

### Components (7; v1 + v2 committed each) — `demo/ecommerce/components/`

| Component | v1 | v2 (visible delta for scenarios 5/11) | Installed on |
|---|---|---|---|
| **Navigation bar** | logo + Home/Products/Cart links + **cart badge** (`/queries/…/count`) | + Orders link | **all 7 screens** |
| **Product grid** | responsive 3-col grid container | 4-col + tighter gap | Home, Products |
| **Product card** | image placeholder, name, price, add-to-cart | + Sale badge (`onSale`) | Home, Products |
| **Price display** | current price | + strikethrough compare-at + discount % | Product details, Order details |
| **Cart item** | thumb, name, qty stepper, remove | + computed line total (qty × price) | Cart |
| **Cart sidebar** | line items + count + "View cart" link; fixed-position panel toggled by the navbar badge | + subtotal footer | Home, Products, Product details |
| **Checkout summary** | subtotal, shipping, total | + tax line | Checkout |

Version story: scenario 4 = **Navigation bar v1** installed in project B;
scenario 5 = **Navigation bar** v1→v2 across all 7 installs *and*
**Cart item** v1→v2, asserting re-expansion with cart data intact.

### Data resources (4) — 2 fixture files, 2 live collections

| Resource | Provider | Served by | Used on |
|---|---|---|---|
| `products` | `api` | `demo/ecommerce/fixtures/products.json` via `app/api-public/[resource]` | Home, Products, Product details |
| `customers` | `api` | `demo/ecommerce/fixtures/customers.json` | Checkout (shipping prefill) |
| `cartItems` | `localStorage` | visitor's browser, project-namespaced | Product details (create), Cart (CRUD), Checkout (read), navbar badge + **Cart sidebar** |
| `orders` | `localStorage` | created at Checkout | Checkout (create), Orders, Order details |

## Scope guard (run 2026-11-05 against `5d0cb04`)

The draft predates 064–069 (062's sequencing table put 070 after them; all
are implemented). Every capability the scenarios assume now exists with
green e2e proof:

| Scenario | Ships in | Concrete precedent |
| -------- | -------- | ------------------- |
| 2 generate screens | 065 | `PROJECTS.addScreen` button flow (`project-session.spec.ts:601`); MSW generate mock is swappable mid-test (`errors.spec.ts:63` sets `window.__GENERATE_MOCK__`) |
| 3-6 catalog install / version pin / fork | 066 | `seedCatalogAsset` (v1) + `publishSeededCatalogVersion` (v2+) in `e2e/db.ts`; real picker UI install/fork in `catalog.spec.ts` (`two projects install v1; a later v2 leaves both rendering v1`, `fork in project A leaves project B's install untouched`) |
| 7 shared data resources | 043/050/061-4/067 | keyless API lane: spec `dataSources/provider: api` + `resources` + `queries` (`demo/pokedex/pokemon-detail-keyless-spec.json`); e2e serves it same-origin at `/api-public` (`e2e/msw/fixture.ts:1203`) |
| 8 navigate action | 061 A2 | `on.press → {action:"navigate", params:{screen}}` in the provenance spec; `lib/playground/navigate-rules.ts` |
| 9 dynamic route by id | 069 | spec `route: "{id}"` + `state.id` seeded from the path; `items/{id}` live in `project-publish.spec.ts` |
| 10-13 publish / live / update / handle change | 069 | `project-publish.spec.ts` (dialog flow, `waitForRemoteProject/Screen` gates, 307/308 hop, revalidate poke) |
| 14-15 isolation / anon visitor | 069 | same spec: second project alongside, anonymous context assertions, real 404 |

Also verified: `demo/pokedex/` provenance exists (`pokedex-keyless-spec.json`,
`pokemon-detail-keyless-spec.json` — `route`/`dataSources`/`resources`/
`queries`/`state` shapes); `CATALOG_TYPES.component` + public visibility
support cross-project reuse; MCP spot-check precedent = plans 032/056
(scripted chrome-devtools pass, logged in the plan's status log);
`bun run build` exists but must never run while `next dev` serves the same
`.next`. Estimate unchanged from 062: 1-1.5 wk.

## Design decisions

1. Seed from the existing Pokédex specs and their patterns (route params,
   navigate, shared session) — rejected: generating every spec fresh,
   because non-deterministic generation makes the e2e flaky (quota lessons).
2. Data comes from committed keyless fixtures — rejected: live external
   APIs, because CI quota and network lessons already caused failures.
3. The demo doubles as the regression fixture for routing and catalog
   versioning — rejected: throwaway hand-only demo, because the source
   document requires repeatable verification.
4. **Screens are created through the real flow**: add-screen button +
   Generate, with MSW returning the committed demo spec serialized as JSONL
   lines (a new `specToLines` helper beside the existing `headingLines`
   pattern; the mock config is swapped per screen via `page.evaluate`, the
   `errors.spec.ts` precedent). `importViaDrawer` only for screens whose
   creation is not itself under test. Rejected: importing all seven
   (scenario 2 says "generate"), rejected: live generation (quota +
   non-determinism).
5. **Data fixtures are served by a committed route** — `app/api-public/
   [resource]` GET handlers read committed JSON under
   `demo/ecommerce/fixtures/`, so e2e, the MCP spot-check (a plain
   browser, no MSW worker) and the README manual replay all read the same
   data — user-confirmed 2026-11-05.
   Rejected: MSW-only, because two of those three surfaces cannot see the
   fixtures; rejected: external API, because it contradicts decision 2.
6. **The MCP spot-check** is a scripted chrome-devtools pass over the live
   claims of the 15 scenarios, logged in this plan's status log — the 032/
   056 pattern. Rejected: a separate results doc, because the plan's
   Verification section is where acceptance is recorded.
7. **Catalog assets are seeded at the DB layer** (`seedCatalogAsset` v1,
   `publishSeededCatalogVersion` v2) — no UI creates a first asset row
   (066 decision) — while every install/fork/version-read is driven through
   the real picker UI.
8. **The gate's `bun run build` runs only with the dev server stopped**
   (never over a live `.next`, lesson `dev-server-e2e-triage.md`) — at
   acceptance time the agent stops :3000, runs the full chain, then
   restarts `bun run dev` — user-confirmed 2026-11-05.
9. **Every demo lives in its own folder under `demo/`** — one folder per
   demo (`demo/ecommerce/`, `demo/pokedex/`); no spec is ever a direct
   child of `demo/`. The pre-existing Pokédex files were moved to
   `demo/pokedex/` accordingly (2026-11-05, user convention), and live
   references were updated (`docs/data-sources.md`,
   `demo/pokedex/keyed-pokedex-server.ts`). Rejected: flat `demo/`, because
   a second demo would collide specs, fixtures and helper servers in one
   directory.
10. **Cart & cross-page data**: cart rows live in a `localStorage`
    resource (`cartItems`) — per-browser, project-namespaced so every
    screen declaring it reads the same rows, and it works for the
    anonymous published visitor with zero server state. The component
    carries the *bindings* (repeat over `/queries/…`, `data_mutate`
    actions); each host screen carries the *declarations*
    (`dataSources`/`resources`/`queries` — component installs copy
    `{root, elements}` only, verified in `insertCatalogComponent`).
    Freshness contract: **fresh read on every screen navigation**
    (`QueryLoader` re-attaches on spec change → all queries reload),
    **post-mutation `refreshResource`** across every attached surface of
    the namespace, **storage-event** refresh across tabs. Component
    update re-expands the subtree but never touches the rows (data lives
    in storage, not in the spec). Rejected: `/session` for cart rows —
    067's rule names cart contents as the resource example and says
    `/session` "is not a database"; rejected: writable `app/api-public`
    route (server state shared by every visitor); rejected: supabase
    (drags auth into a keyless demo). Products/Customers stay on the
    read-only fixture route (decision 5); **Orders is the second writable
    `localStorage` resource** — Checkout creates it, Orders/Order details
    read it (067 names orders alongside cart as the resource example), so
    `demo/ecommerce/fixtures/` holds `products.json` + `customers.json`
    only (files reduced 4 → 2, 2026-11-05).
11. **Style consistency is structural, not generative** — one Navigation
    bar component asset at ONE version installed into all 7 screens →
    identical by construction (`data-template-id` provenance + same pin
    per install); all specs authored within the `STYLING_RULES`
    vocabulary (semantic tokens, no hex, `dark:` pairs). e2e asserts the
    navbar root on every screen. Rejected: relying on the model to
    re-author matching chrome — the generate prompt never sees other
    screens' markup (`context.screens` carries names/routes only, no
    `CATALOG_RULES` block exists), so fresh generations drift; that gap
    is follow-up **F22**, out of scope here.
12. **Cart sidebar — the cart is visible WITHOUT navigation** (user
    question 2026-11-05: "why can't it be a sidebar on other pages?") —
    component #7 `Cart sidebar`, installed on Home/Products/Product
    details, opened by the navbar badge via screen-local state
    (`/cartOpen`), bound to the same `cartItems` query its hosts declare
    (decision 10's contract makes this free). Built as a **fixed-position
    `Stack`, never a portal Dialog** — spec-driven portals mount outside
    the 059 device frame (known limitation F16); a non-portal panel
    renders correctly both inside the editor frame and on the live page.
    This adds the sharpest system assertion available: **post-mutation
    refresh on the SAME surface** (add to cart → sidebar updates with zero
    navigation), which the navigation-based assertion alone cannot cover.
    Rejected: Radix Dialog/drawer (F16); rejected: sidebar-less design
    (misses the same-surface freshness proof).

## Files

- `demo/ecommerce/screens/{home,products,product-detail,cart,checkout,orders,order-detail}-keyless-spec.json` (7 screens)
- `demo/ecommerce/components/` — 7 component specs, v1 + v2 committed
  (Navigation bar, Product card, Product grid, Price display, Cart item,
  Cart sidebar, Checkout summary)
- `demo/ecommerce/fixtures/{products,customers}.json` (2 read-only
  fixtures; cart/orders are writable `localStorage` resources per
  decision 10)
- `demo/pokedex/` — pre-existing provenance, moved here 2026-11-05
  (decision 9)
- `app/api-public/[resource]/route.ts` + route unit test (decision 5)
- `e2e/ecommerce.spec.ts` (serial, `afterAll` cleanup, authed project)
- `e2e/helpers.ts` (`specToLines`), `e2e/constants.ts` (demo keys),
  `e2e/msw/*` reuse; `e2e/db.ts` helpers reused as-is
- README replay section; en/es copy only if new UI copy turns out needed
  (expected: none — spec copy lives in the specs)

## Tasks

### 1. Seed assets (`demo/ecommerce/`)

- [ ] 7 screen specs derived from the provenance shapes: `route: "{id}"`
      for Product/Order details, `on.press → navigate {screen}` between
      screens, shared `state`, `dataSources/resources/queries` wired to the
      four fixtures (decisions 1, 2); **every screen that shows chrome or
      cart declares the same data blocks** — `cartItems` on Product
      details/Cart/Checkout/Orders *and* Home/Products (navbar badge +
      Cart sidebar), so all pages read one collection (decision 10)
- [ ] 7 component specs across ≥2 versions each, `type: component`,
      public visibility so project B can install them (scenario 4);
      **Navigation bar installed at the same version into all 7 screens**
      (decision 11), **Cart sidebar on Home/Products/Product details as a
      non-portal fixed-position panel** (decision 12)
- [ ] 2 keyless read-only fixtures (`products`, `customers`) + their
      serving surface (`app/api-public/[resource]`, decision 5); `cart`
      and `orders` declared as writable `localStorage` resources
      (decision 10)
- [ ] README/docs section describing how to replay the demo

### 2. The 15 scenarios as e2e (`e2e/ecommerce.spec.ts`)

Serial file, split into ~4 tests so a failure localises (069's pattern),
`waitForRemoteProject`/`waitForRemoteScreen` gates before every publish:

- [ ] Scenarios 1-7: create project, generate the screens (real add-screen
      + generate, mock swapped per screen), install component v1 through
      the picker, install the same version in project B, publish v2 → both
      installs still render v1, fork in A → B intact, data resources render
      from the fixtures
- [ ] Scenarios 8-9: navigate between screens; dynamic product route by id
- [ ] Scenarios 10-13: publish, access the live app anonymously, update +
      republish with routing and persistence, handle change → 307/308
- [ ] Scenarios 14-15: second project unaffected throughout; anonymous
      visitor sees published pages only
- [ ] **System coherence — chrome**: every one of the 7 screens shows the
      Navigation bar root (`[data-template-id="<navbar asset id>"]`,
      visible, same nav labels) — decision 11
- [ ] **System coherence — cart travel**: add an item on Product details →
      navigate to Cart (no reload) → row present; same row visible on
      Checkout summary — fresh read on navigation (decision 10)
- [ ] **System coherence — sidebar live update (same surface)**: add an
      item on Product details → the **Cart sidebar on that same page**
      shows the row + updated badge count **without any navigation** →
      "View cart" → `/cart` shows the same row — post-mutation
      `refreshResource` proof (decision 12)
- [ ] **System coherence — update safety**: add cart rows → update the
      **Navigation bar** install on every screen (v1→v2, all 7 installs)
      AND the **Cart item** install → all copies re-expand on v2 AND the
      pre-update cart rows still render (decisions 10 + 11)
- [ ] Scripted MCP spot-check run alongside and logged (decision 6)

### 3. Acceptance

- [ ] All 15 scenarios automated or scripted, exit 0
- [ ] Full gate (format, lint, tsc, unit, build, e2e); console clean except
      the known Radix warning; i18n key parity intact

## Verification

- [ ] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build && bun run test:e2e`
      (build only with the dev server stopped — decision 8)
- [ ] All 15 scenarios automated or scripted; exit 0
- [ ] Second project isolation asserted (component + data + routes)
- [ ] System coherence asserted end-to-end: same navbar on all 7 screens,
      cart rows travel between pages without reload, sidebar updates in
      place on the same surface (no navigation), component update leaves
      data intact (decisions 10-12)
- [ ] MCP spot-check run and logged; console clean (known Radix warning
      excepted); i18n key parity intact

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-31 | plan drafted |
| 2026-11-05 | scope guard run against `5d0cb04` — 065-069 all implemented, every scenario mapped to shipped e2e-proven capability (table above); decisions 4-8 added; tasks rewritten against current helpers (`seedCatalogAsset`, `publishSeededCatalogVersion`, add-screen flow, MSW generate swap, `/api-public` lane); awaiting approval on Q1 (fixture serving) and Q2 (build/dev-server coordination) |
| 2026-11-05 | Q1 answered: committed `app/api-public/[resource]` route (decision 5); Q2 answered: agent stops :3000 for the build gate, then restarts dev (decision 8); **decision 9** — one folder per demo under `demo/`: existing Pokédex files moved to `demo/pokedex/`, live refs updated (`docs/data-sources.md`, server header), 070 files re-homed under `demo/ecommerce/{screens,components,fixtures}/` |
| 2026-11-05 | design discussion (user: "make sure the UIs are working as a system"): **decision 10** cart = `localStorage` resource + bindings-in-component/declarations-in-host + freshness contract (fresh read on navigation, post-mutation refresh, storage events); **decision 11** style consistency structural (navbar installed at one version into all 7 screens, not re-authored by generation); Goal strengthened + 3 system-coherence e2e assertions added; **F22** (generation doesn't know installed components) + **F23** (project-level generation orchestration — the long-term target) logged as separate-plan follow-ups, both out of scope here |
| 2026-11-05 | spec inventory fixed + fixture reconciliation: fixtures reduced to `products.json` + `customers.json` (cart + orders are writable `localStorage` resources per decision 10 — Checkout creates orders); scenario-5 update assertion names Navigation bar (all 7 installs) + Cart item explicitly |
| 2026-11-05 | **Cart sidebar** added as component #7 — **decision 12**: cart visible without navigation; fixed-position `Stack` (never portal Dialog — F16), installed on Home/Products/Product details, opened by navbar badge; new same-surface e2e assertion (post-mutation refresh with zero navigation); **spec inventory tables** (7 screens / 7 components / 4 resources) embedded in this plan |
| 2026-11-05 | **approved** by user ("ok") — full preview accepted: decisions 1-12, Q1/Q2 resolved, inventory tables, F22/F23 parked |
