import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { CATALOG_STORAGE_KEY } from "@/lib/catalog/catalog";
import {
  ACTIVE_PROJECT_STORAGE_KEY,
  PROJECT_STORAGE_KEY,
} from "@/lib/projects/projects";
import { PATHS, PROMPTS, ROLE } from "./constants";
import {
  lastGenerateComponents,
  mockGenerate,
  readHistoryStorage,
  specToLines,
  waitForMsw,
} from "./helpers";

/** Fixed ids so every assertion addresses rows without a round trip. */
const PROJECT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ASSET_ID = "11111111-2222-4333-8444-555555555555";
const VERSION_ID = "11111111-2222-4333-8444-555555555556";
const SEEDED_INSTALL_ID = "11111111-2222-4333-8444-555555555557";
const SEED_HOST_UI = "11111111-2222-4333-8444-555555555558";
const NOW = 1_700_000_000_000;

const COMPONENT_TEXT = "F22 navbar rendered";

/** The catalog component the marker references (072 decision 7 source). */
const COMPONENT_SPEC = {
  root: "nav-root",
  elements: {
    "nav-root": { type: "Stack", props: {}, children: ["nav-text"] },
    "nav-text": {
      type: "Text",
      props: { text: COMPONENT_TEXT },
      children: [],
    },
  },
};

interface SeedArgs {
  projectKey: string;
  activeKey: string;
  catalogKey: string;
  projectId: string;
  assetId: string;
  versionId: string;
  installId: string;
  hostUiId: string;
  now: number;
  componentSpec: typeof COMPONENT_SPEC;
}

/**
 * Local-only project + catalog seed (no DB, no auth): an active project
 * whose catalog already holds an installed navbar, so `projectComponents`
 * lists it and the route pairs CATALOG_RULES with a real list — a bare
 * asset with no install would never ship (installs-first, 072 decision 7).
 */
async function seedComponentProject(page: Page): Promise<void> {
  await page.addInitScript(
    (args: SeedArgs) => {
      localStorage.setItem(
        args.projectKey,
        JSON.stringify([
          {
            id: args.projectId,
            name: "F22 Project",
            slug: "f22-project",
            createdAt: args.now,
            updatedAt: args.now,
            state: {},
          },
        ]),
      );
      localStorage.setItem(args.activeKey, args.projectId);
      localStorage.setItem(
        args.catalogKey,
        JSON.stringify({
          assets: [
            {
              id: args.assetId,
              name: "F22 Navbar",
              description: null,
              type: "component",
              visibility: "private",
              latestVersionId: args.versionId,
              ownerId: "",
              createdAt: args.now,
              updatedAt: args.now,
            },
          ],
          versions: [
            {
              id: args.versionId,
              assetId: args.assetId,
              version: 1,
              spec: args.componentSpec,
              changelog: null,
              ownerId: "",
              createdAt: args.now,
              updatedAt: args.now,
            },
          ],
          installs: [
            {
              id: args.installId,
              projectId: args.projectId,
              assetId: args.assetId,
              versionId: args.versionId,
              targetUiId: args.hostUiId,
              targetKey: "navbar",
              createdAt: args.now,
              updatedAt: args.now,
            },
          ],
        }),
      );
    },
    {
      projectKey: PROJECT_STORAGE_KEY,
      activeKey: ACTIVE_PROJECT_STORAGE_KEY,
      catalogKey: CATALOG_STORAGE_KEY,
      projectId: PROJECT_ID,
      assetId: ASSET_ID,
      versionId: VERSION_ID,
      installId: SEEDED_INSTALL_ID,
      hostUiId: SEED_HOST_UI,
      now: NOW,
      componentSpec: COMPONENT_SPEC,
    },
  );
}

/** The mock stream: a root Stack holding the empty marker placeholder. */
function markerLines(): string[] {
  return specToLines({
    root: "root",
    elements: {
      root: { type: "Stack", props: {}, children: ["marker"] },
      marker: {
        type: "Stack",
        props: { "data-component-ref": ASSET_ID },
        children: [],
      },
    },
  });
}

interface StoredInstall {
  id: string;
  projectId: string;
  assetId: string;
  versionId: string;
  targetUiId: string | null;
}

async function readInstalls(page: Page): Promise<StoredInstall[]> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { installs?: StoredInstall[] };
    return parsed.installs ?? [];
  }, CATALOG_STORAGE_KEY);
}

test.describe("component references (072 F22)", () => {
  test("a marker expands in place and records an install against the new screen", async ({
    page,
  }) => {
    await seedComponentProject(page);
    await mockGenerate(page, { lines: markerLines() });
    await page.goto(PATHS.ui);
    await waitForMsw(page);

    await page.getByRole(ROLE.button, { name: PROMPTS.signIn }).click();
    await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);

    // The reference resolved to real content — the component's own text
    // renders where the empty marker sat (the placeholder never does).
    await expect(
      page.getByText(COMPONENT_TEXT).filter({ visible: true }),
    ).toBeVisible();

    // Pairing proof (decision 2): the request carried context.components,
    // so the route appended CATALOG_RULES with a real list.
    const components = await lastGenerateComponents(page);
    expect(components.map((row) => row.id)).toContain(ASSET_ID);

    // Committed spec: the marker is gone, provenance is stamped on the
    // expansion (fresh keys + data-template-id — the insertTemplate
    // contract the picker shares).
    const history = await readHistoryStorage(page);
    expect(history).toHaveLength(1);
    const serialized = JSON.stringify(history[0].spec);
    expect(serialized).not.toContain("data-component-ref");
    expect(serialized).toContain("data-template-id");
    const expanded = Object.values(history[0].spec.elements).find(
      (element) =>
        (element?.props as Record<string, unknown> | undefined)?.[
          "data-template-id"
        ] === ASSET_ID,
    );
    expect(expanded).toBeDefined();

    // Phase B: a NEW install pins the version against the generated host,
    // beside the seeded one — two rows for the asset, distinct targets.
    const installs = await readInstalls(page);
    const recorded = installs.filter((row) => row.assetId === ASSET_ID);
    expect(recorded).toHaveLength(2);
    expect(
      recorded.some(
        (row) =>
          row.projectId === PROJECT_ID &&
          row.targetUiId === history[0].id &&
          row.versionId === VERSION_ID,
      ),
    ).toBe(true);
  });
});
