import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { Spec } from "@json-render/core";
import { ACTIONS, CATALOG, EDITOR, PATHS, ROLE, UI } from "./constants";
import { dismissUploadNudge } from "./authed-helpers";
import {
  createProject,
  mockGenerate,
  readHistoryStorage,
  readStoredProjects,
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
} from "./db";
import { CATALOG_TYPES, CATALOG_VISIBILITIES } from "@/lib/catalog/catalog";
import { canSeed, e2eEnv, hasAdminAuth } from "./env";
import navigationBarV1 from "@/demo/ecommerce/components/navigation-bar.v1.spec.json";
import navigationBarV2 from "@/demo/ecommerce/components/navigation-bar.v2.spec.json";
import productCardV1 from "@/demo/ecommerce/components/product-card.v1.spec.json";
import productGridV1 from "@/demo/ecommerce/components/product-grid.v1.spec.json";
import productsFixture from "@/demo/ecommerce/fixtures/products.json";
import homeSpec from "@/demo/ecommerce/screens/home.spec.json";

/**
 * Ecommerce reference demo (plan 070, task 2) — the assembled-system proof.
 *
 * FAIL-FAST RULE (user directive 2026-11-06): no test here may wait more than
 * a minute, and every wait is explicitly short. A red run must name the broken
 * step on its first attempt instead of burning minutes on a spinner.
 *
 * The screens are AUTHORED through the real flow (add screen + Generate) with
 * MSW replaying the committed seed specs (`specToLines`, decision 4); catalog
 * assets are seeded at the DB layer (no UI creates asset rows) while every
 * install runs through the real picker.
 */
test.describe.configure({ mode: "serial", timeout: 60_000 });

const RUN = randomUUID().slice(0, 8);
const PROJECT_NAME = `E2E shop ${RUN}`;
const PROJECT_B_NAME = `E2E shop-b ${RUN}`;

/** The canonical screen name doubles as the Generate prompt — `navigate`
 *  params in the committed specs resolve screen names (case-insensitive). */
type SeedSpec = {
  root: string;
  elements: Record<string, unknown>;
  [key: string]: unknown;
};

const HOME = {
  name: "Home",
  marker: "Small-batch homeware for kitchen and home.",
  spec: homeSpec as unknown as SeedSpec,
};

const ASSET_NAMES = {
  grid: `E2E shop grid ${RUN}`,
  card: `E2E shop card ${RUN}`,
  navbar: `E2E shop navbar ${RUN}`,
} as const;

/** Every seeded row carries the `E2E ` marker the service-role sweep matches. */
let projectId: string | undefined;
let projectIdB: string | undefined;
let homeEntryId: string | undefined;
let homeEntryIdB: string | undefined;
const assetIds: string[] = [];
const gridAsset = { id: "", name: ASSET_NAMES.grid, versionId: "" };
const cardAsset = { id: "", name: ASSET_NAMES.card, versionId: "" };
const navbarAsset = { id: "", name: ASSET_NAMES.navbar, versionId: "" };

const PANEL = "[data-editor-panel]";

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
 * The editor panel — opened through a real pick ONCE, then reused. Re-picking
 * after an install races the revision re-render (the panel unmounts mid
 * gesture and a stability-bound click never settles), so an already-open panel
 * is left alone; tab/row clicks dispatch directly for the same reason.
 */
async function ensureStructure(page: Page): Promise<Locator> {
  if ((await panel(page).count()) === 0) {
    await page
      .getByRole(ROLE.button, { name: EDITOR.pick })
      .filter({ visible: true })
      .click();
    await page
      .getByText(HOME.marker, { exact: true })
      .filter({ visible: true })
      .first()
      .click();
    await expect(panel(page)).toBeVisible({ timeout: 10_000 });
  }
  const structureTab = panel(page)
    .getByRole(ROLE.tab, { name: EDITOR.structure })
    .filter({ visible: true });
  if ((await structureTab.getAttribute("aria-selected")) !== "true") {
    await structureTab.dispatchEvent("click");
    await panel(page)
      .getByRole(ROLE.button, { name: CATALOG.open })
      .filter({ visible: true })
      .waitFor({ state: "visible", timeout: 10_000 });
  }
  return panel(page);
}

/**
 * Installs one catalog component into `targetKey`: lift the selection to the
 * root through the breadcrumb, walk the child rows down to the target
 * container (a container inserts into itself — `insertTarget`), then pick the
 * asset in the real catalog tab.
 */
async function installComponent(
  page: Page,
  entryId: string,
  targetKey: string,
  asset: { id: string; name: string },
): Promise<void> {
  const spec = await readSpec(page, entryId);
  const beforeChildren = spec.elements[targetKey]?.children?.length ?? 0;
  const surface = await ensureStructure(page);
  await surface
    .getByRole(ROLE.navigation, { name: EDITOR.breadcrumb })
    .getByRole(ROLE.button, { name: spec.root })
    .first()
    .dispatchEvent("click");
  for (const key of keyPathTo(spec, targetKey)) {
    const row = surface.getByRole(ROLE.button).filter({ hasText: key }).first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.dispatchEvent("click");
  }
  await surface
    .getByRole(ROLE.button, { name: CATALOG.open })
    .filter({ visible: true })
    .dispatchEvent("click");
  const option = page
    .locator("[data-catalog-row]")
    .filter({ hasText: asset.name })
    .filter({ visible: true });
  await expect(option).toBeVisible({ timeout: 15_000 });
  await option.dispatchEvent("click");
  await expect(page.locator("[data-component-picker]")).toHaveCount(0, {
    timeout: 10_000,
  });
  // The expansion lands in the SPEC — a component installed inside a repeat
  // (the grid's card slot) renders nothing until that repeat has rows, so the
  // pixels are the wrong gate here. The new child key is the install's proof.
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
async function seedComponentAsset(
  name: string,
  spec: Record<string, unknown>,
): Promise<{ assetId: string; versionId: string }> {
  const owner = await resolveUserByEmail(e2eEnv.adminEmail);
  if (!owner) throw new Error("[e2e] the e2e admin account is missing");
  return await seedCatalogAsset({
    ownerId: owner.id,
    name,
    type: CATALOG_TYPES.component,
    visibility: CATALOG_VISIBILITIES.public,
    spec: spec as unknown as Spec,
  });
}

/** The installed navbar's presence: v1 and v2 both render the brand as their
 *  own h3, distinct from the screen's h1. */
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

/** `props["data-template-id"]` on the expanded root — the install's
 *  provenance. It rides the SPEC: the registry never emits it as a DOM
 *  attribute (finding 2026-11-06), so pixels and spec are asserted apart. */
async function navbarProvenance(page: Page, entryId: string): Promise<unknown> {
  const spec = await readSpec(page, entryId);
  const slotKey = spec.elements["slot-navbar"]?.children?.[0];
  return slotKey === undefined
    ? undefined
    : spec.elements[slotKey]?.props?.["data-template-id"];
}

/** Generate `screenName` into the ACTIVE project and return its entry id. */
async function generateIntoActiveProject(
  page: Page,
  screenName: string,
  ownerProjectId: string | undefined,
): Promise<string> {
  // Next keeps a hidden copy of the previous route in the document (lesson
  // next-activity-state), so the prompt input exists twice — visibility-scope
  // and take the first, per house style.
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

/** Closes the editor panel so the top-bar project switcher is reachable. */
async function closePanel(page: Page): Promise<void> {
  const close = panel(page).getByRole(ROLE.button, { name: EDITOR.close });
  if ((await close.count()) > 0) await close.first().dispatchEvent("click");
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
    const grid = await seedComponentAsset(ASSET_NAMES.grid, productGridV1);
    gridAsset.id = grid.assetId;
    gridAsset.versionId = grid.versionId;
    const card = await seedComponentAsset(ASSET_NAMES.card, productCardV1);
    cardAsset.id = card.assetId;
    cardAsset.versionId = card.versionId;
    const navbar = await seedComponentAsset(
      ASSET_NAMES.navbar,
      navigationBarV1,
    );
    navbarAsset.id = navbar.assetId;
    navbarAsset.versionId = navbar.versionId;
    assetIds.push(gridAsset.id, cardAsset.id, navbarAsset.id);

    // --- Scenarios 1-2: a project, and a screen AUTHORED by Generate ---------
    await mockGenerate(page, { lines: specToLines(HOME.spec) });
    await page.goto(PATHS.ui);
    await waitForMsw(page);
    await createProject(page, PROJECT_NAME);
    projectId = (await readStoredProjects(page)).find(
      (row) => row.name === PROJECT_NAME,
    )?.id;
    homeEntryId = await generateIntoActiveProject(page, HOME.name, projectId);

    // The seed spec made it through the generate pipeline intact.
    const authored = await readSpec(page, homeEntryId);
    expect(authored.root).toBe(HOME.spec.root);
    expect(authored.elements["slot-grid"]).toBeTruthy();

    // The install push FKs to the remote project row — gate before installing.
    await waitForRemoteProject(PROJECT_NAME);

    // --- Scenario 3: install the grid, then the card INTO the grid slot -----
    await installComponent(page, homeEntryId, "slot-grid", gridAsset);
    const afterGrid = await readSpec(page, homeEntryId);
    const gridRootKey = afterGrid.elements["slot-grid"]?.children?.[0];
    expect(gridRootKey).toBeTruthy();
    const cardSlotKey = afterGrid.elements[gridRootKey!]?.children?.[0];
    expect(cardSlotKey).toBeTruthy();
    await installComponent(page, homeEntryId, cardSlotKey!, cardAsset);

    // Scenario 7: the fixture rows arrive through the keyed lane — MSW plays
    // the proxy by fetching the COMMITTED `/api-public/products` route — and
    // the grid repeats them through the card.
    await expect(
      page.getByText(productsFixture[0].name).filter({ visible: true }).first(),
    ).toBeVisible({ timeout: 20_000 });
    expect(productsFixture.length).toBeGreaterThanOrEqual(4);

    // Scenario 3 (chrome): the navbar lands in the shared slot every screen
    // will own, so all seven screens can carry the SAME component version.
    await installComponent(page, homeEntryId, "slot-navbar", navbarAsset);
    await expect(navbarBrand(page)).toBeVisible({ timeout: 10_000 });
    await expect(
      // exact, so Home's "Browse products" quick link never matches.
      page
        .getByRole(ROLE.button, { name: "Products", exact: true })
        .filter({ visible: true }),
    ).toBeVisible();
    expect(await navbarProvenance(page, homeEntryId)).toBe(navbarAsset.id);
    // v1 has no Orders link — Home's own quick link is the only one.
    await expect(ordersButtons(page)).toHaveCount(1);

    // --- Scenario 4: project B pins the SAME v1 -------------------------
    // Generate needs an EMPTY canvas (`/ui`) — on a screen the bar offers
    // Steer, not Generate (the catalog suite's flow makes the same hop).
    await closePanel(page);
    await page.goto(PATHS.ui);
    await createProject(page, PROJECT_B_NAME);
    projectIdB = (await readStoredProjects(page)).find(
      (row) => row.name === PROJECT_B_NAME,
    )?.id;
    homeEntryIdB = await generateIntoActiveProject(page, HOME.name, projectIdB);
    await waitForRemoteProject(PROJECT_B_NAME);
    await installComponent(page, homeEntryIdB!, "slot-navbar", navbarAsset);
    await expect(navbarBrand(page)).toBeVisible({ timeout: 10_000 });
    await expect(ordersButtons(page)).toHaveCount(1);
    expect(await navbarProvenance(page, homeEntryIdB!)).toBe(navbarAsset.id);
    expect(
      (await waitForRemoteCatalogInstall(navbarAsset.id, projectIdB!))
        .versionId,
    ).toBe(navbarAsset.versionId);

    // --- Scenario 5: a v2 publish leaves BOTH existing installs on v1 ----
    await publishSeededCatalogVersion(
      navbarAsset.id,
      navigationBarV2 as unknown as Spec,
    );
    await expect(ordersButtons(page)).toHaveCount(1);

    // B's copy after a fresh pull of the catalog (still the v1 snapshot).
    await page.reload();
    await expect(navbarBrand(page)).toBeVisible({ timeout: 15_000 });
    await expect(ordersButtons(page)).toHaveCount(1);

    // Project A's copy, reached by its own URL — untouched by the v2 bump.
    await page.goto(`/ui/${homeEntryId}`);
    await expect(navbarBrand(page)).toBeVisible({ timeout: 15_000 });
    await expect(ordersButtons(page)).toHaveCount(1);
    expect(
      (await waitForRemoteCatalogInstall(navbarAsset.id, projectId!)).versionId,
    ).toBe(navbarAsset.versionId);
  });
});

test.afterAll(async () => {
  for (const id of assetIds) await deleteSeededCatalogAsset(id);
  if (homeEntryId) await deleteTestRow(homeEntryId);
  if (homeEntryIdB) await deleteTestRow(homeEntryIdB);
  if (projectId) await deleteTestProject(projectId);
  if (projectIdB) await deleteTestProject(projectIdB);
});
