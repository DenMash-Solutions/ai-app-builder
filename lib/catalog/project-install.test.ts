import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Spec } from "@json-render/core";

type CatalogModule = typeof import("./catalog");
type HistoryModule = typeof import("@/lib/history/history");
type MembershipsModule = typeof import("@/lib/projects/memberships");
type ProjectsModule = typeof import("@/lib/projects/projects");
type InstallModule = typeof import("./project-install");

let catalog: CatalogModule;
let history: HistoryModule;
let memberships: MembershipsModule;
let projects: ProjectsModule;
let installer: InstallModule;
let storage: Map<string, string>;

function makeSpec(title: string): Spec {
  return {
    root: "root",
    elements: { root: { type: "Card", props: { title } } },
  };
}

/** A screen spec with a slot container for component expansion. */
function makeScreenSpec(): Spec {
  return {
    root: "root",
    elements: {
      root: { type: "Stack", props: {}, children: ["slot-navbar"] },
      "slot-navbar": { type: "Stack", props: {}, children: [] },
    },
  };
}

function resetAll(): void {
  for (const asset of [...catalog.getCatalogAssets()]) {
    catalog.removeCatalogAsset(asset.id);
  }
  for (const install of [...catalog.getCatalogInstalls()]) {
    catalog.removeCatalogInstall(install.id);
  }
  for (const membership of [...memberships.getMemberships()]) {
    memberships.removeScreenFromProject(
      membership.projectId,
      membership.screenId,
    );
  }
  for (const project of [...projects.getProjects()]) {
    projects.removeProject(project.id);
  }
  history.clearHistory();
  storage.delete(catalog.CATALOG_STORAGE_KEY);
  storage.delete(catalog.CATALOG_SEEDED_STORAGE_KEY);
  storage.delete(memberships.MEMBERSHIP_STORAGE_KEY);
  storage.delete("genui-history");
}

/** A component asset + the manifest ids it can be referenced by. */
function seedComponent(name: string): string {
  const created = catalog.createCatalogAsset({
    name,
    type: catalog.CATALOG_TYPES.component,
    spec: makeSpec(name),
  })!;
  return created.asset.id;
}

function seedTemplate(
  components: string[],
  screens: Array<{
    name: string;
    route: string | null;
    home?: boolean;
    slots?: Record<string, string>;
  }> = [
    {
      name: "Home",
      route: null,
      home: true,
      slots: { "slot-navbar": components[0] },
    },
    { name: "Cart", route: "cart", slots: { "slot-navbar": components[0] } },
  ],
) {
  const created = catalog.createCatalogAsset({
    name: "Storefront",
    description: "A storefront template",
    type: catalog.CATALOG_TYPES.project,
    visibility: "public",
    spec: {
      screens: screens.map((screen) => ({
        ...screen,
        spec: makeScreenSpec(),
      })),
      components,
    },
  })!;
  return created.asset;
}

describe("project template installer (plan 073 decision 5)", () => {
  beforeAll(async () => {
    storage = new Map();
    const localStorageMock = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    };
    (globalThis as { window?: unknown }).window = {
      localStorage: localStorageMock,
    } as unknown as Window & typeof globalThis;
    catalog = (await import("./catalog")) as CatalogModule;
    history = (await import("@/lib/history/history")) as HistoryModule;
    memberships =
      (await import("@/lib/projects/memberships")) as MembershipsModule;
    projects = (await import("@/lib/projects/projects")) as ProjectsModule;
    installer = (await import("./project-install")) as InstallModule;
  });

  beforeEach(() => {
    resetAll();
  });

  test("creates screens with memberships, routes, home and slot expansions", () => {
    const navbar = seedComponent("Navbar");
    const template = seedTemplate([navbar]);
    const project = projects.createProject("Installed store")!;

    const result = installer.installProjectTemplate({
      projectId: project.id,
      assetId: template.id,
    });

    expect(result.ok).toBe(true);
    expect(result.failedStep).toBeNull();
    expect(result.screens.map((screen) => screen.name)).toEqual([
      "Home",
      "Cart",
    ]);
    expect(result.installs).toBe(2);

    const rows = memberships.getProjectMemberships(project.id);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.route)).toEqual([null, "cart"]);
    expect(rows.map((row) => row.position)).toEqual([0, 1]);

    const entries = history.getHistory();
    expect(entries).toHaveLength(2);
    // Fresh provenance: the expanded component root carries the asset id,
    // and the slot container still exists (expansion lands INSIDE it).
    const home = entries.find((entry) => entry.name === "Home")!;
    const slot = home.spec.elements["slot-navbar"];
    expect(slot.children).toHaveLength(1);
    const installedKey = slot.children![0];
    expect(home.spec.elements[installedKey].props["data-template-id"]).toBe(
      navbar,
    );

    // One install row per expansion, targeting the real host screen and the
    // expanded root that lives in THAT host (fresh keys per host).
    const installs = catalog.getCatalogInstalls();
    expect(installs).toHaveLength(2);
    const hosts = entries.map((entry) => entry.id);
    for (const row of installs) {
      expect(row.assetId).toBe(navbar);
      expect(row.projectId).toBe(project.id);
      expect(hosts).toContain(row.targetUiId!);
      const host = entries.find((entry) => entry.id === row.targetUiId)!;
      expect(host.spec.elements[row.targetKey!]).toBeDefined();
      expect(host.spec.elements[row.targetKey!].props["data-template-id"]).toBe(
        navbar,
      );
    }

    // The flagged home screen wins over the first one.
    const reloaded = projects
      .getProjects()
      .find((row) => row.id === project.id);
    expect(reloaded?.homeScreenId).toBe(rows[0].screenId);
  });

  test("an unknown component id fails the install before any write", () => {
    const template = seedTemplate(["b2300000-0000-4000-8000-0000000000ff"]);
    const project = projects.createProject("Broken")!;

    const result = installer.installProjectTemplate({
      projectId: project.id,
      assetId: template.id,
    });
    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe("component");
    expect(history.getHistory()).toHaveLength(0);
    expect(memberships.getProjectMemberships(project.id)).toHaveLength(0);
  });

  test("fails with the step label when a route collides inside the manifest", () => {
    const navbar = seedComponent("Navbar");
    const template = seedTemplate(
      [navbar],
      [
        { name: "Home", route: null, home: true },
        { name: "Cart", route: "cart" },
        { name: "Bag", route: "cart" },
      ],
    );
    const project = projects.createProject("Routes")!;

    const result = installer.installProjectTemplate({
      projectId: project.id,
      assetId: template.id,
    });
    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe("route");
  });

  test("re-running the same template skips installed screens and adds nothing", () => {
    const navbar = seedComponent("Navbar");
    const template = seedTemplate([navbar]);
    const project = projects.createProject("Again")!;

    const first = installer.installProjectTemplate({
      projectId: project.id,
      assetId: template.id,
    });
    expect(first.ok).toBe(true);

    const second = installer.installProjectTemplate({
      projectId: project.id,
      assetId: template.id,
    });
    expect(second.ok).toBe(true);
    expect(second.skipped).toBe(2);
    expect(second.screens).toEqual([]);
    expect(second.installs).toBe(0);
    expect(history.getHistory()).toHaveLength(2);
    expect(memberships.getProjectMemberships(project.id)).toHaveLength(2);
  });

  test("refuses non-template assets and unknown projects", () => {
    const screen = catalog.createCatalogAsset({
      name: "Screen",
      type: catalog.CATALOG_TYPES.screen,
      spec: makeSpec("Screen"),
    })!;
    const project = projects.createProject("Type guard")!;

    expect(
      installer.installProjectTemplate({
        projectId: project.id,
        assetId: screen.asset.id,
      }).failedStep,
    ).toBe("asset");
    expect(
      installer.installProjectTemplate({
        projectId: "11111111-2222-4333-8444-555555555555",
        assetId: screen.asset.id,
      }).failedStep,
    ).toBe("project");
  });
});
