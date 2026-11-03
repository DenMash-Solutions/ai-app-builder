import {
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  expect,
  test,
} from "bun:test";
import type { Spec } from "@json-render/core";
import type { SyncClient } from "@/lib/history/sync";

type CatalogModule = typeof import("./catalog");
type BrowseModule = typeof import("./browse");

let catalog: CatalogModule;
let browse: BrowseModule;
let storage: Map<string, string>;

function makeSpec(title: string): Spec {
  return {
    root: "root",
    elements: { root: { type: "Card", props: { title } } },
  };
}

function assetRow(
  id: string,
  ownerId: string,
  overrides: {
    visibility?: string;
    updatedAt?: number;
    name?: string;
    table?: string;
  } = {},
): Record<string, unknown> {
  return {
    id,
    owner_id: ownerId,
    name: overrides.name ?? "Shared card",
    description: null,
    type: "component",
    visibility: overrides.visibility ?? "public",
    latest_version_id: null,
    created_at: new Date(1000).toISOString(),
    updated_at: new Date(overrides.updatedAt ?? 5000).toISOString(),
    __table: overrides.table ?? "catalog_assets",
  };
}

function versionRow(
  id: string,
  assetId: string,
  ownerId: string,
  overrides: { updatedAt?: number; table?: string } = {},
): Record<string, unknown> {
  return {
    id,
    owner_id: ownerId,
    asset_id: assetId,
    version: 1,
    spec: makeSpec("remote"),
    changelog: null,
    created_at: new Date(1000).toISOString(),
    updated_at: new Date(overrides.updatedAt ?? 5000).toISOString(),
    __table: overrides.table ?? "catalog_asset_versions",
  };
}

/** The browse's SyncClient slice — records every select's columns/filters
 *  (the no-`SELECT *` pin) and can fail one of the two queries on demand. */
function makeBrowseClient(
  rows: Record<string, unknown>[],
  fail?: "assets" | "versions",
): { client: SyncClient; selects: Record<string, unknown>[] } {
  const selects: Record<string, unknown>[] = [];
  const run = (
    table: string,
    columns: string | undefined,
    filters: { kind: "eq" | "in"; column: string; values: unknown[] }[],
  ): { data: unknown[] | null; error: { message: string } | null } => {
    selects.push({ table, columns, filters });
    if (
      (fail === "assets" && table === "catalog_assets") ||
      (fail === "versions" && table === "catalog_asset_versions")
    ) {
      return { data: null, error: { message: "boom" } };
    }
    let out = rows
      .filter((row) => row.__table === table)
      .map((row) => ({ ...row }));
    for (const filter of filters) {
      out = out.filter((row) =>
        filter.kind === "eq"
          ? row[filter.column] === filter.values[0]
          : filter.values.includes(row[filter.column]),
      );
    }
    if (columns !== undefined && columns !== "*") {
      const keys = columns.split(",").map((key) => key.trim());
      out = out.map((row) =>
        Object.fromEntries(keys.map((key) => [key, row[key]])),
      );
    }
    return { data: out, error: null };
  };
  const client = {
    from: (table: string) => ({
      select: (columns?: string) => {
        const filters: {
          kind: "eq" | "in";
          column: string;
          values: unknown[];
        }[] = [];
        const builder = {
          eq: (column: string, value: unknown) => {
            filters.push({ kind: "eq", column, values: [value] });
            return builder;
          },
          in: (column: string, values: unknown[]) => {
            filters.push({ kind: "in", column, values });
            return builder;
          },
          then: (
            onfulfilled?: (value: {
              data: unknown[] | null;
              error: { message: string } | null;
            }) => void,
            onrejected?: (reason: unknown) => void,
          ) =>
            Promise.resolve(run(table, columns, filters)).then(
              onfulfilled,
              onrejected,
            ),
        };
        return builder;
      },
      // The browse never upserts or deletes — stubs satisfy SyncClient.
      upsert: async () => ({ error: null }),
      delete: () => ({ in: async () => ({ error: null }) }),
    }),
  };
  return { client: client as unknown as SyncClient, selects };
}

/** Reset the catalog through its own API (cache + storage agree). */
function resetCatalog(): void {
  for (const asset of [...catalog.getCatalogAssets()]) {
    catalog.removeCatalogAsset(asset.id);
  }
  for (const install of [...catalog.getCatalogInstalls()]) {
    catalog.removeCatalogInstall(install.id);
  }
  storage.delete(catalog.CATALOG_STORAGE_KEY);
  storage.delete(catalog.CATALOG_SEEDED_STORAGE_KEY);
}

describe("public browse adoption (plan 066 decision 11)", () => {
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
    // Dynamic imports after the window exists — the SAME instances the
    // other test files drive (shared process), reset through APIs below.
    catalog = (await import("./catalog")) as CatalogModule;
    browse = (await import("./browse")) as BrowseModule;
  });

  beforeEach(() => {
    resetCatalog();
  });

  afterEach(() => {
    resetCatalog();
  });

  test("adopts foreign public rows with their real ownerId; own rows skipped", async () => {
    const foreignAssetId = "aaaaaaaa-4444-4888-9999-0000000000a1";
    const ownAssetId = "bbbbbbbb-4444-4888-9999-0000000000b1";
    const { client, selects } = makeBrowseClient([
      assetRow(foreignAssetId, "other-user"),
      assetRow(ownAssetId, "me"),
      versionRow(
        "cccccccc-4444-4888-9999-0000000000c1",
        foreignAssetId,
        "other-user",
      ),
      versionRow("dddddddd-4444-4888-9999-0000000000d1", ownAssetId, "me"),
    ]);

    const adopted = await browse.adoptPublicCatalog(client, "me");

    // One foreign asset + one foreign version — own rows never adopt.
    expect(adopted).toBe(2);
    const foreign = catalog
      .getCatalogAssets()
      .find((row) => row.id === foreignAssetId);
    expect(foreign).toBeDefined();
    expect(foreign!.ownerId).toBe("other-user"); // the REAL owner travels
    expect(foreign!.visibility).toBe("public");
    expect(
      catalog.getCatalogVersions().find((row) => row.assetId === foreignAssetId)
        ?.ownerId,
    ).toBe("other-user");
    expect(
      catalog.getCatalogAssets().some((row) => row.id === ownAssetId),
    ).toBe(false);

    // Explicit column lists on both queries — never `SELECT *`.
    expect(selects[0]).toEqual({
      table: "catalog_assets",
      columns:
        "id, owner_id, name, description, type, visibility, latest_version_id, created_at, updated_at",
      filters: [{ kind: "eq", column: "visibility", values: ["public"] }],
    });
    expect(selects[1]).toEqual({
      table: "catalog_asset_versions",
      columns:
        "id, owner_id, asset_id, version, spec, changelog, created_at, updated_at",
      filters: [{ kind: "in", column: "asset_id", values: [foreignAssetId] }],
    });
  });

  test("never clobbers a local copy that is already as new (LWW)", async () => {
    const assetId = "aaaaaaaa-4444-4888-9999-0000000000e1";
    // Adopted earlier at updatedAt 9000 (the local winner)…
    catalog.applyRemoteCatalogAsset({
      id: assetId,
      name: "Newer local copy",
      description: null,
      type: "component",
      visibility: "public",
      latestVersionId: null,
      ownerId: "other-user",
      createdAt: 1000,
      updatedAt: 9000,
    });
    // …the browse now sees the SAME row at 5000 — it must lose.
    const { client } = makeBrowseClient([
      assetRow(assetId, "other-user", {
        name: "Stale remote copy",
        updatedAt: 5000,
      }),
    ]);

    await browse.adoptPublicCatalog(client, "me");

    const row = catalog.getCatalogAssets().find((item) => item.id === assetId);
    expect(row!.name).toBe("Newer local copy");
    expect(row!.updatedAt).toBe(9000);
  });

  test("a newer remote row wins the compare and replaces the local copy", async () => {
    const assetId = "aaaaaaaa-4444-4888-9999-0000000000f1";
    catalog.applyRemoteCatalogAsset({
      id: assetId,
      name: "Older local copy",
      description: null,
      type: "component",
      visibility: "public",
      latestVersionId: null,
      ownerId: "other-user",
      createdAt: 1000,
      updatedAt: 2000,
    });
    const { client } = makeBrowseClient([
      assetRow(assetId, "other-user", {
        name: "Fresh remote copy",
        updatedAt: 8000,
      }),
    ]);

    await browse.adoptPublicCatalog(client, "me");

    const row = catalog.getCatalogAssets().find((item) => item.id === assetId);
    expect(row!.name).toBe("Fresh remote copy");
    expect(row!.updatedAt).toBe(8000);
    expect(row!.ownerId).toBe("other-user");
  });

  test("an asset-query error ends the adoption early (fire-and-forget)", async () => {
    const { client } = makeBrowseClient(
      [assetRow("aaaaaaaa-4444-4888-9999-0000000000a2", "other-user")],
      "assets",
    );

    const adopted = await browse.adoptPublicCatalog(client, "me");

    expect(adopted).toBe(0);
    expect(catalog.getCatalogAssets()).toHaveLength(0);
  });

  test("a versions-query error keeps the adopted assets (partial by design)", async () => {
    const assetId = "aaaaaaaa-4444-4888-9999-0000000000a3";
    const { client } = makeBrowseClient(
      [
        assetRow(assetId, "other-user"),
        versionRow(
          "cccccccc-4444-4888-9999-0000000000c3",
          assetId,
          "other-user",
        ),
      ],
      "versions",
    );

    const adopted = await browse.adoptPublicCatalog(client, "me");

    expect(adopted).toBe(1); // the asset landed; the version fetch failed
    expect(catalog.getCatalogAssets().some((row) => row.id === assetId)).toBe(
      true,
    );
    expect(catalog.getCatalogVersions()).toHaveLength(0);
  });
});
