import { describe, expect, test } from "bun:test";
import type { Spec } from "@json-render/core";
import type {
  CatalogAsset,
  CatalogAssetVersion,
  CatalogInstall,
} from "@/lib/catalog/catalog";
import { projectComponentRows, projectSources } from "./project-insights";

const PROJECT = "11111111-2222-4333-8444-555555555555";
const OTHER_PROJECT = "99999999-8888-4777-8666-555555555555";

function specWithData(blocks: Record<string, unknown>): Spec {
  return {
    root: "root",
    elements: { root: { type: "Stack", props: {} } },
    ...blocks,
  } as unknown as Spec;
}

const ECOMMERCE_BLOCKS = {
  dataSources: {
    ecommerce: {
      provider: "api",
      config: {
        baseUrl: "http://localhost:3000/api-public",
        auth: { type: "bearer", ref: "ecommerce" },
      },
    },
  },
  resources: { products: { dataSource: "ecommerce", collection: "products" } },
  queries: {
    products: { resource: "products", operation: "list" },
  },
};

describe("projectSources", () => {
  test("dedupes one declaration across screens and collects its reads", () => {
    const rows = projectSources([
      { name: "Home", spec: specWithData(ECOMMERCE_BLOCKS) },
      { name: "Products", spec: specWithData(ECOMMERCE_BLOCKS) },
      { name: "Cart", spec: specWithData({}) },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "ecommerce",
      provider: "api",
      collections: ["products"],
      queries: ["products"],
      screens: ["Home", "Products"],
      needsConfig: false,
    });
  });

  test("flags an api source with no server-held ref (the 067 gate)", () => {
    const rows = projectSources([
      {
        name: "Checkout",
        spec: specWithData({
          dataSources: {
            analytics: {
              provider: "api",
              config: { baseUrl: "https://events.example.com" },
            },
          },
        }),
      },
      {
        name: "Cart",
        spec: specWithData({
          dataSources: {
            cart: { provider: "localStorage", config: {} },
          },
        }),
      },
    ]);
    expect(rows.map((row) => [row.name, row.needsConfig])).toEqual([
      ["analytics", true],
      ["cart", false],
    ]);
  });

  test("same name with different config stays two rows, sorted by name", () => {
    const rows = projectSources([
      {
        name: "Orders",
        spec: specWithData({
          dataSources: {
            api: { provider: "api", config: { baseUrl: "https://a.example" } },
          },
        }),
      },
      {
        name: "Admin",
        spec: specWithData({
          dataSources: {
            api: { provider: "api", config: { baseUrl: "https://b.example" } },
          },
        }),
      },
    ]);
    expect(rows).toHaveLength(2);
    // Same name/provider: the config key breaks the tie (a.example first).
    expect(rows.map((row) => row.screens)).toEqual([["Orders"], ["Admin"]]);
  });

  test("no data blocks means no rows", () => {
    expect(projectSources([{ name: "Home", spec: specWithData({}) }])).toEqual(
      [],
    );
  });
});

function asset(id: string, latestVersionId: string | null): CatalogAsset {
  return {
    id,
    name: id.toUpperCase(),
    description: null,
    type: "component",
    visibility: "private",
    latestVersionId,
    ownerId: "",
    createdAt: 1,
    updatedAt: 1,
  };
}

function version(
  id: string,
  assetId: string,
  number: number,
): CatalogAssetVersion {
  return {
    id,
    assetId,
    version: number,
    spec: {
      root: "root",
      elements: { root: { type: "Stack", props: {} } },
    },
    changelog: null,
    ownerId: "",
    createdAt: 1,
    updatedAt: 1,
  };
}

function install(
  id: string,
  assetId: string,
  versionId: string,
  projectId: string,
): CatalogInstall {
  return {
    id,
    projectId,
    assetId,
    versionId,
    targetUiId: null,
    targetKey: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("projectComponentRows", () => {
  const assets = [asset("navbar", "navbar-v2"), asset("card", "card-v1")];
  const versions = [
    version("navbar-v1", "navbar", 1),
    version("navbar-v2", "navbar", 2),
    version("card-v1", "card", 1),
  ];
  const installs = [
    install("i1", "navbar", "navbar-v1", PROJECT),
    install("i2", "navbar", "navbar-v1", PROJECT),
    install("i3", "card", "card-v1", PROJECT),
    install("i4", "navbar", "navbar-v2", OTHER_PROJECT),
  ];

  test("groups copies and reports the lowest pin against the latest", () => {
    const rows = projectComponentRows({
      projectId: PROJECT,
      installs,
      assets,
      versions,
    });
    expect(rows.map((row) => [row.name, row.copies])).toEqual([
      ["CARD", 1],
      ["NAVBAR", 2],
    ]);
    const navbar = rows.find((row) => row.assetId === "navbar")!;
    expect(navbar).toMatchObject({
      installedVersion: 1,
      latestVersion: 2,
      upToDate: false,
    });
    expect(rows.find((row) => row.assetId === "card")).toMatchObject({
      installedVersion: 1,
      latestVersion: 1,
      upToDate: true,
    });
  });

  test("is up to date when every copy sits on the latest version", () => {
    const rows = projectComponentRows({
      projectId: OTHER_PROJECT,
      installs,
      assets,
      versions,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ assetId: "navbar", upToDate: true });
  });

  test("skips installs whose asset is gone and unknown projects", () => {
    expect(
      projectComponentRows({
        projectId: "missing",
        installs,
        assets,
        versions,
      }),
    ).toEqual([]);
    const rows = projectComponentRows({
      projectId: PROJECT,
      installs: [install("x", "deleted-asset", "v1", PROJECT)],
      assets,
      versions,
    });
    expect(rows).toEqual([]);
  });
});
