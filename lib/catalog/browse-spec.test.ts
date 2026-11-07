import { describe, expect, test } from "bun:test";
import type { Spec } from "@json-render/core";
import { CATALOG_TYPES } from "@/lib/catalog/catalog";
import type { CatalogAsset, CatalogAssetVersion } from "@/lib/catalog/catalog";
import {
  buildCatalogDetailSpec,
  buildCatalogSpec,
  catalogCardRow,
  catalogDetailModel,
  type CatalogCardLabels,
} from "@/lib/catalog/browse-spec";

const OWNER = "b2300000-0000-4000-8000-000000000001";
const COMPONENT_ID = "b2300000-0000-4000-8000-00000000000c";

const LABELS: CatalogCardLabels = {
  template: "Template",
  screen: "Screen",
  component: "Component",
  screensUnit: "screens",
};

function makeSpec(title: string): Spec {
  return {
    root: "root",
    elements: { root: { type: "Card", props: { title } } },
  };
}

function makeManifest() {
  return {
    screens: [
      {
        name: "Home",
        route: null,
        home: true,
        spec: makeSpec("Home"),
        slots: {},
      },
      { name: "Products", route: "products/{id}", spec: makeSpec("Products") },
    ],
    components: [COMPONENT_ID],
  };
}

function asset(overrides: Partial<CatalogAsset> = {}): CatalogAsset {
  return {
    id: "asset-1",
    name: "Storefront",
    description: "An ecommerce template",
    type: CATALOG_TYPES.project,
    visibility: "public",
    latestVersionId: "version-1",
    ownerId: "",
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function version(
  overrides: Partial<CatalogAssetVersion> = {},
): CatalogAssetVersion {
  return {
    id: "version-1",
    assetId: "asset-1",
    version: 1,
    spec: makeManifest(),
    changelog: null,
    ownerId: "",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("catalog browse builders (plan 073 decision 10)", () => {
  test("a template row carries the type/scope facet fields and a summary", () => {
    const row = catalogCardRow(asset(), version(), OWNER, LABELS);
    expect(row).toEqual({
      assetId: "asset-1",
      name: "Storefront",
      description: "An ecommerce template",
      type: CATALOG_TYPES.project,
      scope: "mine",
      summary: "Template · 2 screens",
    });
  });

  test("an adopted public asset scopes as public; a NULL description reads empty", () => {
    const row = catalogCardRow(
      asset({ ownerId: "someone-else", description: null }),
      version(),
      OWNER,
      LABELS,
    );
    expect(row?.scope).toBe("public");
    expect(row?.description).toBe("");
  });

  test("a screen row summarizes by type and a broken payload is dropped", () => {
    const screen = catalogCardRow(
      asset({ type: CATALOG_TYPES.screen }),
      version({ spec: makeSpec("Screen") }),
      OWNER,
      LABELS,
    );
    expect(screen?.summary).toBe("Screen");

    // A project asset whose version holds a plain spec cannot be browsed.
    expect(
      catalogCardRow(
        asset(),
        version({ spec: makeSpec("Not a manifest") }),
        OWNER,
        LABELS,
      ),
    ).toBeNull();
    expect(catalogCardRow(asset(), null, OWNER, LABELS)).toBeNull();
  });

  test("detail model lists screens with route placeholders and counts", () => {
    const detail = catalogDetailModel(asset(), version(), LABELS)!;
    expect(detail.screens).toEqual([
      { name: "Home", route: "—" },
      { name: "Products", route: "products/{id}" },
    ]);
    expect(detail.screenCount).toBe(2);
    expect(detail.componentCount).toBe(1);
    expect(detail.typeLabel).toBe("Template");
    expect(detail.empty).toBe(false);
  });

  test("detail model of a component asset has no screen list", () => {
    const detail = catalogDetailModel(
      asset({ type: CATALOG_TYPES.component }),
      version({ spec: makeSpec("Card") }),
      LABELS,
    )!;
    expect(detail.screens).toEqual([]);
    expect(detail.screenCount).toBe(0);
    expect(detail.typeLabel).toBe("Component");
  });

  test("buildCatalogSpec seeds every filter stage and preserves the frame copy", () => {
    const base: Spec = {
      root: "page",
      state: { copy: { title: "Catalog" }, catalog: { query: "x" } },
      elements: { page: { type: "Stack", props: {}, children: [] } },
    };
    const rows = [catalogCardRow(asset(), version(), OWNER, LABELS)!];
    const built = buildCatalogSpec(base, rows);
    const catalog = (built.state as { catalog: Record<string, unknown> })
      .catalog;
    expect(catalog.items).toEqual(rows);
    expect(catalog.stageSearch).toEqual(rows);
    expect(catalog.stageType).toEqual(rows);
    expect(catalog.visible).toEqual(rows);
    expect(catalog.query).toBe("");
    expect(catalog.type).toBe("");
    expect(catalog.scope).toBe("");
    expect(catalog.empty).toBe(false);
    expect((built.state as { copy: unknown }).copy).toEqual({
      title: "Catalog",
    });

    const empty = buildCatalogSpec(base, []);
    expect((empty.state as { catalog: { empty: boolean } }).catalog.empty).toBe(
      true,
    );
  });

  test("buildCatalogDetailSpec merges the detail state over the frame copy", () => {
    const base: Spec = {
      root: "page",
      state: { copy: { back: "Back" }, detail: { assetId: "" } },
      elements: { page: { type: "Stack", props: {}, children: [] } },
    };
    const detail = catalogDetailModel(asset(), version(), LABELS)!;
    const built = buildCatalogDetailSpec(base, detail);
    expect((built.state as { detail: unknown }).detail).toEqual(detail);
    expect((built.state as { copy: unknown }).copy).toEqual({ back: "Back" });
  });
});
