import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { Spec } from "@json-render/core";
import {
  ACTIONS,
  CATALOG,
  EDITOR,
  PATHS,
  PROJECTS,
  PUBLISH,
  ROLE,
  SLOTS,
  UI,
} from "./constants";
import { dismissUploadNudge, historyButton } from "./authed-helpers";
import {
  createProject,
  mockGenerate,
  readHistoryStorage,
  readStoredProjects,
  shieldFromHeadSlotHides,
  specToLines,
  waitForMsw,
} from "./helpers";
import type { StoredSpec } from "./helpers";
import {
  deleteSeededCatalogAsset,
  deleteTestProject,
  deleteTestRow,
  publishSeededCatalogVersion,
  resolveUserByEmail,
  seedCatalogAsset,
  waitForRemoteCatalogInstall,
  waitForRemoteProject,
  waitForRemoteScreen,
} from "./db";
import { CATALOG_TYPES, CATALOG_VISIBILITIES } from "@/lib/catalog/catalog";
import { canSeed, e2eEnv, hasAdminAuth } from "./env";
import cartItemV1 from "@/demo/ecommerce/components/cart-item.v1.spec.json";
import cartSidebarV1 from "@/demo/ecommerce/components/cart-sidebar.v1.spec.json";
import checkoutSummaryV1 from "@/demo/ecommerce/components/checkout-summary.v1.spec.json";
import navigationBarV1 from "@/demo/ecommerce/components/navigation-bar.v1.spec.json";
import navigationBarV2 from "@/demo/ecommerce/components/navigation-bar.v2.spec.json";
import priceDisplayV1 from "@/demo/ecommerce/components/price-display.v1.spec.json";
import productCardV1 from "@/demo/ecommerce/components/product-card.v1.spec.json";
import productGridV1 from "@/demo/ecommerce/components/product-grid.v1.spec.json";
import productsFixture from "@/demo/ecommerce/fixtures/products.json";
import cartSpec from "@/demo/ecommerce/screens/cart.spec.json";
import checkoutSpec from "@/demo/ecommerce/screens/checkout.spec.json";
import homeSpec from "@/demo/ecommerce/screens/home.spec.json";
import orderDetailsSpec from "@/demo/ecommerce/screens/order-details.spec.json";
import ordersSpec from "@/demo/ecommerce/screens/orders.spec.json";
import productDetailsSpec from "@/demo/ecommerce/screens/product-details.spec.json";
import productsSpec from "@/demo/ecommerce/screens/products.spec.json";

/**
 * Ecommerce reference demo (plan 070, task 2) — the assembled-system proof.
 *
 * TIMEOUT POLICY (user directive 2026-11-06, clarified): no single WAIT may
 * exceed a minute. That is a per-wait ceiling, NOT a test cap — every explicit
 * wait here is 10-30s (never the 180s budgets other suites use), while the
 * test budget stays generous so a long chain can finish. Scenarios are split
 * into focused serial tests so a red run names the broken step immediately.
 *
 * Screens are AUTHORED through the real flow (Generate) with MSW replaying the
 * committed seed specs (`specToLines`, decision 4); catalog assets are seeded
 * at the DB layer (no UI creates asset rows) while every install runs through
 * the real picker.
 */
test.describe.configure({ mode: "serial", timeout: 240_000 });

const RUN = randomUUID().slice(0, 8);
const PROJECT_A = `E2E shop ${RUN}`;
const PROJECT_B = `E2E shop-b ${RUN}`;
const PROJECT_C = `E2E shop-c ${RUN}`;
const PROJECT_PUB = `E2E shop-pub ${RUN}`;
const PROJECT_UNPUBLISHED = `E2E shop-hidden ${RUN}`;
const HANDLE = `e2e-shop-${RUN}`;
const HANDLE_NEW = `e2e-shop-${RUN}-new`;

const SCREEN = {
  home: "Home",
  products: "Products",
  productDetails: "Product details",
  cart: "Cart",
  checkout: "Checkout",
  orders: "Orders",
  orderDetails: "Order details",
} as const;

/** Each committed screen spec, serialized as the generate-input shape. */
type SeedSpec = {
  root: string;
  elements: Record<string, unknown>;
  [key: string]: unknown;
};

const SCREENS: Array<{ name: string; spec: SeedSpec }> = [
  { name: SCREEN.home, spec: homeSpec as unknown as SeedSpec },
  { name: SCREEN.products, spec: productsSpec as unknown as SeedSpec },
  {
    name: SCREEN.productDetails,
    spec: productDetailsSpec as unknown as SeedSpec,
  },
  { name: SCREEN.cart, spec: cartSpec as unknown as SeedSpec },
  { name: SCREEN.checkout, spec: checkoutSpec as unknown as SeedSpec },
  { name: SCREEN.orders, spec: ordersSpec as unknown as SeedSpec },
  { name: SCREEN.orderDetails, spec: orderDetailsSpec as unknown as SeedSpec },
];

const ASSETS = {
  grid: { id: "", name: `E2E shop grid ${RUN}`, versionId: "" },
  card: { id: "", name: `E2E shop card ${RUN}`, versionId: "" },
  navbar: { id: "", name: `E2E shop navbar ${RUN}`, versionId: "" },
  price: { id: "", name: `E2E shop price ${RUN}`, versionId: "" },
  cartItem: { id: "", name: `E2E shop cart-item ${RUN}`, versionId: "" },
  sidebar: { id: "", name: `E2E shop sidebar ${RUN}`, versionId: "" },
  summary: { id: "", name: `E2E shop summary ${RUN}`, versionId: "" },
};

/** Ids the run must tear down (every row carries the `E2E ` marker). */
const projectIds: string[] = [];
const entryIds: string[] = [];
const projectByName = new Map<string, string>();
const entryByScreen = new Map<string, string>();
let publishedProjectName = "";
const PANEL = "[data-editor-panel]";
const FIRST_PRODUCT = productsFixture[0];

function panel(page: Page): Locator {
  return page.locator(PANEL).filter({ visible: true });
}

/** BFS through `children` — the structure-tab row chain to a nested key. */
function keyPathTo(spec: StoredSpec, target: string): string[] {
  const queue: Array<{ key: string; trail: string[] }> = [
    { key: spec.root, trail: [] },
  ];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    if (current.key === target) return current.trail;
    const element = spec.elements[current.key];
    for (const child of element?.children ?? []) {
      queue.push({ key: child, trail: [...current.trail, child] });
    }
  }
  throw new Error(`[e2e] ${target} is not in the spec`);
}

/** The current stored spec — installs expand fresh keys, so re-read each time. */
async function readSpec(page: Page, entryId: string): Promise<StoredSpec> {
  const entry = (await readHistoryStorage(page)).find(
    (stored) => stored.id === entryId,
  );
  if (!entry) throw new Error(`[e2e] entry ${entryId} missing from storage`);
  return entry.spec;
}

/**
 * A locator action with a bounded wait: `dispatchEvent` and friends have no
 * default timeout, so a missing row would hang until the test budget expires.
 * Bounding each tap keeps the per-WAIT ceiling (directive 2026-11-06).
 */
async function tap(locator: Locator, timeout = 15_000): Promise<void> {
  await locator.waitFor({ state: "visible", timeout });
  await locator.dispatchEvent("click");
}

/** Opens the editor panel through a real pick on the spec's ROOT element: it
 *  is always rendered (leaf copy can be data-gated), and the exact key cannot
 *  land on shell or hidden Activity markup. A root pick leaves the breadcrumb
 *  empty — `selectTarget` tolerates that. */
async function pickOn(page: Page, entryId: string): Promise<void> {
  const spec = await readSpec(page, entryId);
  await page
    .getByRole(ROLE.button, { name: EDITOR.pick })
    .filter({ visible: true })
    .first()
    .click();
  await page
    .locator(`[data-jr-key="${spec.root}"]`)
    .filter({ visible: true })
    .first()
    .click({ timeout: 15_000 });
  await expect(panel(page)).toBeVisible({ timeout: 10_000 });
}

/**
 * The editor panel — opened once, then reused. Re-picking after an install
 * races the revision re-render (the panel unmounts mid-gesture and a
 * stability-bound click never settles); tab/row clicks dispatch directly.
 */
async function ensureStructure(page: Page, entryId: string): Promise<Locator> {
  if ((await panel(page).count()) === 0) await pickOn(page, entryId);
  const structureTab = panel(page)
    .getByRole(ROLE.tab, { name: EDITOR.structure })
    .filter({ visible: true });
  if ((await structureTab.getAttribute("aria-selected")) !== "true") {
    await tap(structureTab);
    await panel(page)
      .getByRole(ROLE.button, { name: CATALOG.open })
      .filter({ visible: true })
      .waitFor({ state: "visible", timeout: 10_000 });
  }
  return panel(page);
}

/** Selects `targetKey`'s row chain in the structure tree. */
async function selectTarget(
  page: Page,
  entryId: string,
  targetKey: string,
): Promise<Locator> {
  const spec = await readSpec(page, entryId);
  const surface = await ensureStructure(page, entryId);
  const rootCrumb = surface
    .getByRole(ROLE.navigation, { name: EDITOR.breadcrumb })
    .getByRole(ROLE.button, { name: spec.root })
    .first();
  // A ROOT pick has no ancestors, so there is no trail to walk back up.
  if ((await rootCrumb.count()) > 0) await tap(rootCrumb);
  for (const key of keyPathTo(spec, targetKey)) {
    await tap(surface.getByRole(ROLE.button).filter({ hasText: key }).first());
  }
  return surface;
}

/** Opens the catalog tab and returns the asset's install row. */
async function openCatalogRow(
  page: Page,
  surface: Locator,
  assetName: string,
): Promise<Locator> {
  await tap(
    surface
      .getByRole(ROLE.button, { name: CATALOG.open })
      .filter({ visible: true }),
  );
  const option = page
    .locator("[data-catalog-row]")
    .filter({ hasText: assetName })
    .filter({ visible: true });
  await expect(option).toBeVisible({ timeout: 30_000 });
  return option;
}

/**
 * Installs one catalog component into `targetKey` through the real picker.
 * A container inserts into itself (`insertTarget`), so the walk selects the
 * container's own row.
 */
async function installComponent(
  page: Page,
  entryId: string,
  targetKey: string,
  asset: { id: string; name: string },
): Promise<void> {
  const beforeChildren =
    (await readSpec(page, entryId)).elements[targetKey]?.children?.length ?? 0;
  const surface = await selectTarget(page, entryId, targetKey);
  const option = await openCatalogRow(page, surface, asset.name);
  await tap(option);
  await expect(page.locator("[data-component-picker]")).toHaveCount(0, {
    timeout: 10_000,
  });
  // The expansion lands in the SPEC — a component installed inside a repeat
  // renders nothing until that repeat has rows, so the new child key is the
  // install's proof (pixels are the wrong gate).
  await expect
    .poll(
      async () =>
        (await readSpec(page, entryId)).elements[targetKey]?.children?.length ??
        0,
      { timeout: 15_000 },
    )
    .toBeGreaterThan(beforeChildren);
}

/** Seeds one component asset (v1) owned by the e2e admin. */
async function seedAsset(
  asset: { id: string; name: string; versionId: string },
  spec: Record<string, unknown>,
): Promise<void> {
  const owner = await resolveUserByEmail(e2eEnv.adminEmail);
  if (!owner) throw new Error("[e2e] the e2e admin account is missing");
  // Every seed gets its OWN name: the local catalog store carries the assets
  // earlier tests seeded (and a v2 publish), so a reused name would match two
  // picker rows — and the stale one would install the wrong version.
  asset.name = `${asset.name}-${seededAssetIds.length + 1}`;
  const seeded = await seedCatalogAsset({
    ownerId: owner.id,
    name: asset.name,
    type: CATALOG_TYPES.component,
    visibility: CATALOG_VISIBILITIES.public,
    spec: spec as unknown as Spec,
  });
  asset.id = seeded.assetId;
  asset.versionId = seeded.versionId;
  void assetFor(seeded.assetId);
}

/** Assets are deleted in afterAll; keep one list for the cleanup sweep. */
const seededAssetIds: string[] = [];
function assetFor(assetId: string): string {
  seededAssetIds.push(assetId);
  return assetId;
}

/** The installed navbar's presence: v1 and v2 render the brand as their own
 *  h3, distinct from the screen's h1. */
function navbarBrand(page: Page): Locator {
  return page
    .getByRole(ROLE.heading, { name: "Everyday Goods", level: 3 })
    .filter({ visible: true });
}

/** The navbar's Orders link exists only in v2; Home's own quick link is the
 *  screen's other orders button, so the count is the version observable. */
function ordersButtons(page: Page): Locator {
  return page
    .getByRole(ROLE.button, { name: "Orders" })
    .filter({ visible: true });
}

/** `props["data-template-id"]` on the expanded root — the install's provenance.
 *  It rides the SPEC: the registry emits no DOM attribute (decision 16b). */
async function navbarProvenance(page: Page, entryId: string): Promise<unknown> {
  const spec = await readSpec(page, entryId);
  const slotKey = spec.elements["slot-navbar"]?.children?.[0];
  return slotKey === undefined
    ? undefined
    : spec.elements[slotKey]?.props?.["data-template-id"];
}

/** Points the generate mock at one screen's committed spec. */
async function setGenerateLines(page: Page, lines: string[]): Promise<void> {
  await page.evaluate((next: string[]) => {
    (
      window as unknown as { __GENERATE_MOCK__?: { lines?: string[] } }
    ).__GENERATE_MOCK__ = { lines: next };
  }, lines);
}

/** Generate `screenName` on the CURRENT playground and return its entry id. */
async function authorOnPlayground(
  page: Page,
  screenName: string,
  ownerProjectId: string | undefined,
): Promise<string> {
  // Next keeps a hidden copy of the previous route in the document (lesson
  // next-activity-state), so the prompt input exists twice — visibility-scope.
  await page
    .getByPlaceholder(UI.promptPlaceholder)
    .filter({ visible: true })
    .first()
    .fill(screenName);
  await page
    .getByRole(ROLE.button, { name: ACTIONS.generate })
    .filter({ visible: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  await dismissUploadNudge(page);
  const entry = (await readHistoryStorage(page)).find(
    (stored) =>
      stored.prompt === screenName && stored.projectId === ownerProjectId,
  );
  if (!entry) throw new Error(`[e2e] generated entry missing: ${screenName}`);
  return entry.id;
}

/** Author one screen into the ACTIVE project from a fresh `/ui` canvas. */
async function authorScreen(
  page: Page,
  screenName: string,
  spec: SeedSpec,
  ownerProjectId: string | undefined,
): Promise<string> {
  await page.goto(PATHS.ui);
  await setGenerateLines(page, specToLines(spec));
  return await authorOnPlayground(page, screenName, ownerProjectId);
}

/** Creates a project through the switcher and records its id. */
async function startProject(page: Page, name: string): Promise<string> {
  await page.goto(PATHS.ui);
  await createProject(page, name);
  const projectId = (await readStoredProjects(page)).find(
    (row) => row.name === name,
  )?.id;
  if (!projectId) throw new Error(`[e2e] project not stored: ${name}`);
  projectIds.push(projectId);
  projectByName.set(name, projectId);
  return projectId;
}

/** The route-param suffix a detail screen needs to render real content (its
 *  query is gated on the seeded path param, and the install needs a rendered
 *  pick target). */
function detailParam(screenName: string): string | undefined {
  return screenName === SCREEN.productDetails
    ? `products/${FIRST_PRODUCT.id}`
    : undefined;
}

/** Opens one authored screen in the editor, optionally with a route param. */
async function openScreen(
  page: Page,
  entryId: string,
  param?: string,
): Promise<void> {
  await page.goto(`/ui/${entryId}${param === undefined ? "" : `/${param}`}`);
  await expect(
    page
      .getByRole(ROLE.button, { name: EDITOR.pick })
      .filter({ visible: true }),
  ).toBeVisible({ timeout: 20_000 });
}

async function closePanel(page: Page): Promise<void> {
  const close = panel(page).getByRole(ROLE.button, { name: EDITOR.close });
  if ((await close.count()) > 0) await tap(close.first());
}

async function openDrawer(page: Page): Promise<Locator> {
  const drawer = page.locator(SLOTS.drawer).filter({ visible: true });
  if ((await drawer.count()) === 0) {
    await shieldFromHeadSlotHides(page);
    await historyButton(page).filter({ visible: true }).click();
  }
  await expect(drawer).toBeVisible({ timeout: 10_000 });
  return drawer;
}

/** Commits a workspace route on a generated (named) screen. */
async function setRoute(
  page: Page,
  projectName: string,
  screenName: string,
  route: string,
): Promise<void> {
  const drawer = await openDrawer(page);
  const group = drawer.getByLabel(projectName, { exact: true });
  await expect(group).toBeVisible({ timeout: 20_000 });
  await group
    .getByRole(ROLE.button, { name: PROJECTS.expandWorkspace })
    .filter({ visible: true })
    .click();
  const row = group.locator("li").filter({
    has: page.getByRole(ROLE.button, {
      name: PROJECTS.rowActions(screenName),
    }),
  });
  await row
    .getByRole(ROLE.button, { name: PROJECTS.routeEdit })
    .filter({ visible: true })
    .click();
  const input = row.getByRole(ROLE.textbox, { name: PROJECTS.routeEdit });
  await input.fill(route);
  await input.press("Enter");
  await expect(row.getByText(route)).toBeVisible();
}

/**
 * The demo ships its detail route on the MEMBERSHIP row (the plan's route
 * table): the editor seeds path params from that row — the spec route is only
 * the project-less fallback — so a member screen with a null route never sees
 * `/id` and its `get` query never runs. Set it before installing or visiting.
 */
async function setDetailRoute(page: Page, projectName: string): Promise<void> {
  await setRoute(page, projectName, SCREEN.productDetails, "products/{id}");
}

/**
 * Publishes `projectName` with `handle` through the real dialog and confirms
 * it went live (toast + drawer Live badge), matching the 069 flow.
 */
async function publishSite(
  page: Page,
  projectName: string,
  handle: string,
): Promise<void> {
  const drawer = await openDrawer(page);
  const group = drawer.getByLabel(projectName, { exact: true });
  await expect(group).toBeVisible({ timeout: 30_000 });
  await group
    .getByRole(ROLE.button, { name: PUBLISH.publishSite })
    .filter({ visible: true })
    .click();
  const dialog = page.locator(SLOTS.dialog).filter({ visible: true });
  await expect(dialog.getByText(PUBLISH.siteTitle(projectName))).toBeVisible();
  await dialog
    .getByLabel(PUBLISH.siteLabel)
    .filter({ visible: true })
    .fill(handle);
  const submit = dialog.getByRole(ROLE.button, {
    name: /^Publish(?: new version)?$/,
  });
  await expect(submit).toBeEnabled({ timeout: 30_000 });
  await submit.filter({ visible: true }).click();
  await expect(page.getByText(PUBLISH.sitePublished("")).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    drawer.getByRole(ROLE.link, { name: PUBLISH.openSite(projectName) }),
  ).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(
    page.locator(SLOTS.drawer).filter({ visible: true }),
  ).toHaveCount(0);
}

test.describe("ecommerce reference demo (070)", () => {
  test.skip(
    !hasAdminAuth,
    "E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set — demo suite skips",
  );
  test.skip(!canSeed, "SUPABASE_SERVICE_ROLE_KEY not set — demo suite skips");

  test("a demo screen is authored, takes the catalog chrome + grid, and keeps its v1 pin after a v2 publish", async ({
    page,
  }) => {
    await seedAsset(ASSETS.grid, productGridV1);
    await seedAsset(ASSETS.card, productCardV1);
    await seedAsset(ASSETS.navbar, navigationBarV1);

    // --- Scenarios 1-2: a project, and a screen AUTHORED by Generate ---------
    await mockGenerate(page, { lines: specToLines(SCREENS[0].spec) });
    await page.goto(PATHS.ui);
    await waitForMsw(page);
    const projectIdA = await startProject(page, PROJECT_A);
    const homeEntry = await authorOnPlayground(page, SCREEN.home, projectIdA);
    entryIds.push(homeEntry);
    entryByScreen.set(SCREEN.home, homeEntry);

    const authored = await readSpec(page, homeEntry);
    expect(authored.root).toBe(SCREENS[0].spec.root);
    expect(authored.elements["slot-grid"]).toBeTruthy();

    // The install push FKs to the remote project row — gate before installing.
    await waitForRemoteProject(PROJECT_A);

    // --- Scenario 3: install the grid, then the card INTO the grid slot -----
    await openScreen(page, homeEntry);
    await installComponent(page, homeEntry, "slot-grid", ASSETS.grid);
    const afterGrid = await readSpec(page, homeEntry);
    const gridRootKey = afterGrid.elements["slot-grid"]?.children?.[0];
    expect(gridRootKey).toBeTruthy();
    const cardSlotKey = afterGrid.elements[gridRootKey!]?.children?.[0];
    expect(cardSlotKey).toBeTruthy();
    await installComponent(page, homeEntry, cardSlotKey!, ASSETS.card);

    // Scenario 7: fixture rows arrive through the keyed lane — MSW plays the
    // proxy by fetching the COMMITTED `/api-public/products` route — and the
    // grid repeats them through the card.
    await expect(
      page.getByText(FIRST_PRODUCT.name).filter({ visible: true }).first(),
    ).toBeVisible({ timeout: 20_000 });
    expect(productsFixture.length).toBeGreaterThanOrEqual(4);

    // Scenario 3 (chrome): the navbar lands in the shared slot every screen
    // will own, so all seven screens can carry the SAME component version.
    await installComponent(page, homeEntry, "slot-navbar", ASSETS.navbar);
    await expect(navbarBrand(page)).toBeVisible({ timeout: 10_000 });
    await expect(
      page
        .getByRole(ROLE.button, { name: "Products", exact: true })
        .filter({ visible: true }),
    ).toBeVisible();
    expect(await navbarProvenance(page, homeEntry)).toBe(ASSETS.navbar.id);
    await expect(ordersButtons(page)).toHaveCount(1);

    // --- Scenario 4: project B pins the SAME v1 -------------------------
    await closePanel(page);
    const projectIdB = await startProject(page, PROJECT_B);
    await setGenerateLines(page, specToLines(SCREENS[0].spec));
    const homeB = await authorOnPlayground(page, SCREEN.home, projectIdB);
    entryIds.push(homeB);
    await waitForRemoteProject(PROJECT_B);
    await openScreen(page, homeB);
    await installComponent(page, homeB, "slot-navbar", ASSETS.navbar);
    await expect(navbarBrand(page)).toBeVisible({ timeout: 10_000 });
    await expect(ordersButtons(page)).toHaveCount(1);
    expect(await navbarProvenance(page, homeB)).toBe(ASSETS.navbar.id);
    expect(
      (await waitForRemoteCatalogInstall(ASSETS.navbar.id, projectIdB))
        .versionId,
    ).toBe(ASSETS.navbar.versionId);

    // --- Scenario 5: a v2 publish leaves BOTH existing installs on v1 ----
    await publishSeededCatalogVersion(
      ASSETS.navbar.id,
      navigationBarV2 as unknown as Spec,
    );
    await expect(ordersButtons(page)).toHaveCount(1);

    await page.reload();
    await expect(navbarBrand(page)).toBeVisible({ timeout: 20_000 });
    await expect(ordersButtons(page)).toHaveCount(1);

    await openScreen(page, homeEntry);
    await expect(navbarBrand(page)).toBeVisible({ timeout: 20_000 });
    await expect(ordersButtons(page)).toHaveCount(1);
    expect(
      (await waitForRemoteCatalogInstall(ASSETS.navbar.id, projectIdA))
        .versionId,
    ).toBe(ASSETS.navbar.versionId);
  });

  test("seven authored screens share one navbar and navigate by name", async ({
    page,
  }) => {
    await seedAsset(ASSETS.navbar, navigationBarV1);
    await mockGenerate(page, { lines: specToLines(SCREENS[0].spec) });
    await page.goto(PATHS.ui);
    await waitForMsw(page);
    const projectId = await startProject(page, PROJECT_C);
    await waitForRemoteProject(PROJECT_C);

    // Every screen is AUTHORED (its name is the navigate ref), then the SAME
    // navbar version installs into all seven.
    const ids = new Map<string, string>();
    for (const screen of SCREENS) {
      const id = await authorScreen(page, screen.name, screen.spec, projectId);
      entryIds.push(id);
      ids.set(screen.name, id);
      entryByScreen.set(screen.name, id);
      if (screen.name === SCREEN.productDetails) {
        await setDetailRoute(page, PROJECT_C);
      }
      await openScreen(page, id, detailParam(screen.name));
      await installComponent(page, id, "slot-navbar", ASSETS.navbar);
      expect(await navbarProvenance(page, id)).toBe(ASSETS.navbar.id);
    }

    // System coherence — chrome: the same navbar renders on every screen.
    for (const [name, id] of ids) {
      await openScreen(page, id);
      await expect(navbarBrand(page), name).toBeVisible({ timeout: 15_000 });
      await expect(
        page
          .getByRole(ROLE.button, { name: "Products", exact: true })
          .filter({ visible: true }),
        name,
      ).toBeVisible();
    }

    // Scenario 8 — the navigate action resolves a screen NAME to its route.
    await openScreen(page, ids.get(SCREEN.home)!);
    await page
      .getByRole(ROLE.button, { name: "Products", exact: true })
      .filter({ visible: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`${ids.get(SCREEN.products)}$`), {
      timeout: 20_000,
    });
    await page
      .getByRole(ROLE.button, { name: "Home", exact: true })
      .filter({ visible: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`${ids.get(SCREEN.home)}$`), {
      timeout: 20_000,
    });
  });

  test("a product card navigates to its dynamic detail route with the record id", async ({
    page,
  }) => {
    await seedAsset(ASSETS.grid, productGridV1);
    await seedAsset(ASSETS.card, productCardV1);
    await seedAsset(ASSETS.navbar, navigationBarV1);
    await mockGenerate(page, { lines: specToLines(SCREENS[0].spec) });
    await page.goto(PATHS.ui);
    await waitForMsw(page);
    const projectName = `E2E shop-route ${RUN}`;
    const projectId = await startProject(page, projectName);
    await waitForRemoteProject(projectName);

    const homeId = await authorScreen(
      page,
      SCREEN.home,
      SCREENS[0].spec,
      projectId,
    );
    const detailId = await authorScreen(
      page,
      SCREEN.productDetails,
      SCREENS[2].spec,
      projectId,
    );
    entryIds.push(homeId, detailId);
    await setDetailRoute(page, projectName);

    await openScreen(page, homeId);
    await installComponent(page, homeId, "slot-grid", ASSETS.grid);
    const afterGrid = await readSpec(page, homeId);
    const gridRootKey = afterGrid.elements["slot-grid"]?.children?.[0];
    const cardSlotKey = afterGrid.elements[gridRootKey!]?.children?.[0];
    await installComponent(page, homeId, cardSlotKey!, ASSETS.card);
    await installComponent(page, homeId, "slot-navbar", ASSETS.navbar);

    // Scenario 9 — the card's navigate carries `{$item: "id"}` and the target
    // screen's spec route builds `products/{id}`.
    // The editor panel is still open from the last install and a canvas click
    // with it open SELECTS instead of running the element's actions — reload
    // the screen so the card press is a real press.
    await openScreen(page, homeId);
    await page
      .getByRole(ROLE.button, { name: "View details" })
      .filter({ visible: true })
      .first()
      .click();
    await expect(page).toHaveURL(
      new RegExp(`${detailId}/products/${FIRST_PRODUCT.id}$`),
      { timeout: 20_000 },
    );
    await expect(
      page.getByText(FIRST_PRODUCT.name).filter({ visible: true }).first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("cart rows travel: sidebar updates in place, cart and checkout read the same rows", async ({
    page,
  }) => {
    await seedAsset(ASSETS.navbar, navigationBarV1);
    await seedAsset(ASSETS.price, priceDisplayV1);
    await seedAsset(ASSETS.cartItem, cartItemV1);
    await seedAsset(ASSETS.sidebar, cartSidebarV1);
    await seedAsset(ASSETS.summary, checkoutSummaryV1);
    await mockGenerate(page, { lines: specToLines(SCREENS[0].spec) });
    await page.goto(PATHS.ui);
    await waitForMsw(page);
    const projectName = `E2E shop-cart ${RUN}`;
    const projectId = await startProject(page, projectName);
    await waitForRemoteProject(projectName);

    const detailId = await authorScreen(
      page,
      SCREEN.productDetails,
      SCREENS[2].spec,
      projectId,
    );
    const cartId = await authorScreen(
      page,
      SCREEN.cart,
      SCREENS[3].spec,
      projectId,
    );
    const checkoutId = await authorScreen(
      page,
      SCREEN.checkout,
      SCREENS[4].spec,
      projectId,
    );
    entryIds.push(detailId, cartId, checkoutId);
    await setDetailRoute(page, projectName);

    await openScreen(page, detailId, detailParam(SCREEN.productDetails));
    await installComponent(page, detailId, "slot-navbar", ASSETS.navbar);
    await installComponent(page, detailId, "slot-price", ASSETS.price);
    await installComponent(page, detailId, "slot-sidebar", ASSETS.sidebar);
    await openScreen(page, cartId);
    await installComponent(page, cartId, "slot-navbar", ASSETS.navbar);
    await installComponent(page, cartId, "slot-cart-item", ASSETS.cartItem);
    await openScreen(page, checkoutId);
    await installComponent(page, checkoutId, "slot-summary", ASSETS.summary);

    // Product details reads its record by the seeded route param.
    await openScreen(page, `${detailId}/products/${FIRST_PRODUCT.id}`);
    await expect(
      page.getByRole(ROLE.heading, { name: FIRST_PRODUCT.name, level: 1 }),
    ).toBeVisible({ timeout: 20_000 });

    // Scenario: post-mutation refresh on the SAME surface — add to cart, open
    // the sidebar through the navbar badge, no navigation involved.
    await page
      .getByRole(ROLE.button, { name: "Add to cart" })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByText("Added to cart").filter({ visible: true }),
    ).toBeVisible({ timeout: 10_000 });
    await page
      .getByRole(ROLE.button, { name: "Cart", exact: true })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByText(FIRST_PRODUCT.name).filter({ visible: true }).first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText("1 items").filter({ visible: true }),
    ).toBeVisible({ timeout: 15_000 });

    // "View cart" navigates; the Cart screen re-reads the SAME rows.
    await page
      .getByRole(ROLE.button, { name: "View cart" })
      .filter({ visible: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`${cartId}$`), { timeout: 20_000 });
    await expect(
      page.getByText(FIRST_PRODUCT.name).filter({ visible: true }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // Cart → Checkout; the summary totals the same rows (+ $5 shipping).
    await page
      .getByRole(ROLE.button, { name: "Go to checkout" })
      .filter({ visible: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`${checkoutId}$`), {
      timeout: 20_000,
    });
    await expect(
      page.getByText("Order summary").filter({ visible: true }),
    ).toBeVisible({ timeout: 15_000 });
    const total = `$${(FIRST_PRODUCT.price + 5).toFixed(2)}`;
    await expect(page.getByText(total).filter({ visible: true })).toBeVisible({
      timeout: 15_000,
    });
  });

  test("scenario 6: a fork in project A leaves project B's pin untouched", async ({
    page,
  }) => {
    await seedAsset(ASSETS.navbar, navigationBarV1);
    await mockGenerate(page, { lines: specToLines(SCREENS[0].spec) });
    await page.goto(PATHS.ui);
    await waitForMsw(page);
    const nameA = `E2E shop-fork-a ${RUN}`;
    const nameB = `E2E shop-fork-b ${RUN}`;
    const projectA = await startProject(page, nameA);
    await waitForRemoteProject(nameA);
    const homeA = await authorScreen(
      page,
      SCREEN.home,
      SCREENS[0].spec,
      projectA,
    );
    entryIds.push(homeA);
    await openScreen(page, homeA);
    await installComponent(page, homeA, "slot-navbar", ASSETS.navbar);
    expect(
      (await waitForRemoteCatalogInstall(ASSETS.navbar.id, projectA)).versionId,
    ).toBe(ASSETS.navbar.versionId);

    const projectB = await startProject(page, nameB);
    await waitForRemoteProject(nameB);
    const homeB = await authorScreen(
      page,
      SCREEN.home,
      SCREENS[0].spec,
      projectB,
    );
    entryIds.push(homeB);
    await openScreen(page, homeB);
    await installComponent(page, homeB, "slot-navbar", ASSETS.navbar);

    // Fork A's navbar from A's own screen — the picker's fork action.
    await openScreen(page, homeA);
    const spec = await readSpec(page, homeA);
    const navbarRoot = spec.elements["slot-navbar"]?.children?.[0];
    expect(navbarRoot).toBeTruthy();
    const surface = await selectTarget(page, homeA, navbarRoot!);
    const option = await openCatalogRow(page, surface, ASSETS.navbar.name);
    // The fork action is a SIBLING of the option button inside the row's
    // presentation container (the catalog suite's `catalogRow` shape).
    const row = page
      .locator("div[role='presentation']")
      .filter({ has: option })
      .filter({ visible: true });
    const fork = row.getByRole(ROLE.button, {
      name: CATALOG.forkEdit,
      exact: true,
    });
    await fork.waitFor({ state: "visible", timeout: 15_000 });
    await fork.click({ timeout: 15_000 });
    // The fork opens a NEW working copy immediately (066 decision 4).
    await page.waitForURL(
      (url) =>
        /\/ui\/[0-9a-f-]{36}$/.test(url.pathname) &&
        !url.pathname.endsWith(homeA),
      { timeout: 30_000 },
    );
    await expect(navbarBrand(page)).toBeVisible({ timeout: 15_000 });

    // B's pin and copy are untouched by the fork.
    expect(
      (await waitForRemoteCatalogInstall(ASSETS.navbar.id, projectB)).versionId,
    ).toBe(ASSETS.navbar.versionId);
    await openScreen(page, homeB);
    await expect(navbarBrand(page)).toBeVisible({ timeout: 20_000 });
  });

  test("a published project serves home and its dynamic route to a visitor; an unpublished one does not", async ({
    page,
    browser,
    baseURL,
  }) => {
    await seedAsset(ASSETS.grid, productGridV1);
    await seedAsset(ASSETS.card, productCardV1);
    await mockGenerate(page, { lines: specToLines(SCREENS[0].spec) });
    await page.goto(PATHS.ui);
    await waitForMsw(page);
    const projectId = await startProject(page, PROJECT_PUB);
    await waitForRemoteProject(PROJECT_PUB);
    publishedProjectName = PROJECT_PUB;

    const homeId = await authorScreen(
      page,
      SCREEN.home,
      SCREENS[0].spec,
      projectId,
    );
    const detailId = await authorScreen(
      page,
      SCREEN.productDetails,
      SCREENS[2].spec,
      projectId,
    );
    entryIds.push(homeId, detailId);
    await openScreen(page, homeId);
    await installComponent(page, homeId, "slot-grid", ASSETS.grid);
    const afterGrid = await readSpec(page, homeId);
    const gridRootKey = afterGrid.elements["slot-grid"]?.children?.[0];
    const cardSlotKey = afterGrid.elements[gridRootKey!]?.children?.[0];
    await installComponent(page, homeId, cardSlotKey!, ASSETS.card);

    // The published route comes from the MEMBERSHIP row (069), not the spec.
    await setDetailRoute(page, PROJECT_PUB);
    await waitForRemoteScreen(homeId);
    await waitForRemoteScreen(detailId);
    await publishSite(page, PROJECT_PUB, HANDLE);

    // Scenario 11 — an anonymous visitor resolves the live site, its dynamic
    // route with the captured param, and a REAL 404 for anything else.
    const visitor = await browser.newContext({ baseURL });
    const visitorPage = await visitor.newPage();
    try {
      await visitorPage.goto(`/${HANDLE}`);
      await expect(visitorPage).toHaveURL(new RegExp(`/${HANDLE}$`));
      await expect(
        visitorPage.getByRole(ROLE.heading, {
          name: "Everyday Goods",
          level: 1,
        }),
      ).toBeVisible({ timeout: 20_000 });

      await visitorPage.goto(`/en/${HANDLE}/products/${FIRST_PRODUCT.id}`);
      await expect(
        visitorPage
          .getByText(FIRST_PRODUCT.name)
          .filter({ visible: true })
          .first(),
      ).toBeVisible({ timeout: 20_000 });

      const miss = await visitorPage.goto(`/en/${HANDLE}/no-such-path`);
      expect(miss?.status()).toBe(404);
    } finally {
      await visitor.close();
    }

    // Scenario 15 — a second, UNPUBLISHED project is not reachable under the
    // live site: its screen id resolves nothing.
    const hiddenId = await startProject(page, PROJECT_UNPUBLISHED);
    await waitForRemoteProject(PROJECT_UNPUBLISHED);
    const hiddenHome = await authorScreen(
      page,
      SCREEN.home,
      SCREENS[0].spec,
      hiddenId,
    );
    entryIds.push(hiddenHome);
    const anonymous = await browser.newContext({ baseURL });
    const anonymousPage = await anonymous.newPage();
    try {
      const denied = await anonymousPage.goto(`/en/${HANDLE}/${hiddenHome}`);
      expect(denied?.status()).toBe(404);
    } finally {
      await anonymous.close();
    }
  });

  test("scenario 13: a handle change redirects the old URL and the republished site still serves", async ({
    page,
    browser,
    baseURL,
  }) => {
    await mockGenerate(page, { lines: specToLines(SCREENS[0].spec) });
    await page.goto(PATHS.ui);
    await waitForMsw(page);
    await publishSite(page, publishedProjectName, HANDLE_NEW);

    const visitor = await browser.newContext({ baseURL });
    const visitorPage = await visitor.newPage();
    try {
      const old = await visitorPage.request.get(`/en/${HANDLE}/products/1`, {
        maxRedirects: 0,
      });
      expect([307, 308]).toContain(old.status());
      expect(old.headers()["location"]).toContain(HANDLE_NEW);

      await visitorPage.goto(`/en/${HANDLE}`);
      await expect(visitorPage).toHaveURL(new RegExp(`${HANDLE_NEW}$`), {
        timeout: 20_000,
      });
      await expect(
        visitorPage.getByRole(ROLE.heading, {
          name: "Everyday Goods",
          level: 1,
        }),
      ).toBeVisible({ timeout: 20_000 });
    } finally {
      await visitor.close();
    }
  });
});

test.afterAll(async () => {
  for (const id of seededAssetIds) await deleteSeededCatalogAsset(id);
  for (const id of entryIds) await deleteTestRow(id);
  for (const id of projectIds) await deleteTestProject(id);
});
