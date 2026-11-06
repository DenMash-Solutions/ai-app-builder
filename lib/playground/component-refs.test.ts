import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Spec } from "@json-render/core";
import type { ComponentRefResolution } from "./component-refs";

type CatalogModule = typeof import("@/lib/catalog/catalog");
type ComponentRefsModule = typeof import("./component-refs");

let catalog: CatalogModule;
let refs: ComponentRefsModule;
let storage: Map<string, string>;

const PROJECT = "11111111-2222-4333-8444-555555555555";
const HOST_UI = "99999999-8888-7777-6666-555555555555";

function componentSpec(title: string): Spec {
  return {
    root: "comp-root",
    elements: { "comp-root": { type: "Card", props: { title } } },
  };
}

/** root → [marker, card-1]: the marker's index is provable after expand. */
function markerSpec(ref: string): Spec {
  return {
    root: "root",
    elements: {
      root: { type: "Stack", props: {}, children: ["marker", "card-1"] },
      marker: {
        type: "Stack",
        props: { "data-component-ref": ref },
        children: [],
      },
      "card-1": { type: "Card", props: { title: "Host" } },
    },
  };
}

const TEMPLATE_SUBTREE = {
  rootKey: "tpl-root",
  elements: { "tpl-root": { type: "Badge", props: { label: "Saved" } } },
};

describe("expandComponentRefs (072 F22 decision 1)", () => {
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
    // Dynamic imports after the window exists — shared module instances,
    // reset through APIs below (install.test.ts pattern).
    catalog = (await import("@/lib/catalog/catalog")) as CatalogModule;
    refs = (await import("./component-refs")) as ComponentRefsModule;
  });

  beforeEach(() => {
    for (const asset of [...catalog.getCatalogAssets()]) {
      catalog.removeCatalogAsset(asset.id);
    }
    for (const install of [...catalog.getCatalogInstalls()]) {
      catalog.removeCatalogInstall(install.id);
    }
    storage.delete(catalog.CATALOG_STORAGE_KEY);
    storage.delete(catalog.CATALOG_SEEDED_STORAGE_KEY);
  });

  function makeCatalogHit(): {
    asset: ReturnType<CatalogModule["createCatalogAsset"]> extends null
      ? never
      : NonNullable<ReturnType<CatalogModule["createCatalogAsset"]>>["asset"];
    version: NonNullable<
      ReturnType<CatalogModule["createCatalogAsset"]>
    >["version"];
    resolveCatalog: ComponentRefResolution["resolveCatalog"];
  } {
    const created = catalog.createCatalogAsset({
      name: "Navbar",
      type: catalog.CATALOG_TYPES.component,
      spec: componentSpec("Navbar"),
    })!;
    return {
      asset: created.asset,
      version: created.version,
      resolveCatalog: (id: string) =>
        id === created.asset.id
          ? { asset: created.asset, version: created.version }
          : null,
    };
  }

  const resolveTemplate = (id: string) =>
    id === "tpl-1" ? TEMPLATE_SUBTREE : null;

  test("catalog ref expands in place with provenance and a pending install", () => {
    const { asset, version, resolveCatalog } = makeCatalogHit();
    const result = refs.expandComponentRefs(markerSpec(asset.id), {
      projectId: PROJECT,
      resolveCatalog,
      resolveTemplate,
    });

    expect(result.dropped).toEqual([]);
    // The marker sat at index 0 — the expanded root takes exactly that slot.
    expect(result.spec.root).toBe("root");
    expect(result.spec.elements.root.children).toEqual([
      expect.any(String),
      "card-1",
    ]);
    const expandedKey = (result.spec.elements.root.children ?? [])[0];
    expect(expandedKey).not.toBe("marker");
    expect(result.spec.elements.marker).toBeUndefined();
    // Fresh keys + provenance (the insertTemplate contract), pinned latest.
    expect(
      (result.spec.elements[expandedKey].props as Record<string, unknown>)[
        "data-template-id"
      ],
    ).toBe(asset.id);
    expect(result.installs).toEqual([
      { assetId: asset.id, versionId: version.id, targetKey: expandedKey },
    ]);
  });

  test("unknown ref: dropped, marker removed, commit-ready spec", () => {
    const result = refs.expandComponentRefs(markerSpec("ghost-id"), {
      projectId: PROJECT,
      resolveCatalog: () => null,
      resolveTemplate,
    });

    expect(result.dropped).toEqual(["ghost-id"]);
    expect(result.spec.elements.marker).toBeUndefined();
    expect(result.spec.elements.root.children).toEqual(["card-1"]);
    expect(result.installs).toEqual([]);
    // Everything else untouched — the spec still commits.
    expect(result.spec.elements["card-1"]).toBeDefined();
  });

  test("template ref expands with provenance and no install row", () => {
    const result = refs.expandComponentRefs(markerSpec("tpl-1"), {
      projectId: PROJECT,
      resolveCatalog: () => null, // not in the catalog → saved-template path
      resolveTemplate,
    });

    expect(result.dropped).toEqual([]);
    expect(result.installs).toEqual([]);
    const expandedKey = (result.spec.elements.root.children ?? [])[0];
    expect(
      (result.spec.elements[expandedKey].props as Record<string, unknown>)[
        "data-template-id"
      ],
    ).toBe("tpl-1");
    expect(result.spec.elements.marker).toBeUndefined();
  });

  test("a marker in a slot expands into it as a wrapper, prop stripped", () => {
    const { resolveCatalog, asset } = makeCatalogHit();
    const spec: Spec = {
      root: "root",
      elements: {
        root: {
          type: "Stack",
          props: {},
          slots: { nav: ["marker"] },
          children: [],
        },
        marker: {
          type: "Stack",
          props: { "data-component-ref": asset.id },
          children: [],
        },
      },
    };
    const result = refs.expandComponentRefs(spec, {
      projectId: PROJECT,
      resolveCatalog,
      resolveTemplate,
    });

    // The marker held its slot position; the component lives inside it and
    // the prop is gone — a marker can never fire twice across completions.
    expect(result.spec.elements.root.slots?.nav).toEqual(["marker"]);
    expect(
      result.spec.elements.marker.props["data-component-ref"],
    ).toBeUndefined();
    expect(result.spec.elements.marker.children).toHaveLength(1);
    expect(result.installs).toHaveLength(1);
  });

  test("a marker with children of its own is kept as a wrapper (content preserved)", () => {
    const { resolveCatalog, asset } = makeCatalogHit();
    const spec: Spec = {
      root: "root",
      elements: {
        root: { type: "Stack", props: {}, children: ["marker"] },
        marker: {
          type: "Stack",
          props: { "data-component-ref": asset.id },
          children: ["inner"],
        },
        inner: { type: "Text", props: { text: "kept" } },
      },
    };
    const result = refs.expandComponentRefs(spec, {
      projectId: PROJECT,
      resolveCatalog,
      resolveTemplate,
    });

    expect(result.spec.elements.inner).toBeDefined();
    expect(
      result.spec.elements.marker.props["data-component-ref"],
    ).toBeUndefined();
    expect(result.spec.elements.marker.children).toHaveLength(2);
    expect(result.installs).toHaveLength(1);
  });

  test("the spec root as marker: expanded into, prop stripped, root kept", () => {
    const { resolveCatalog, asset } = makeCatalogHit();
    const spec: Spec = {
      root: "marker",
      elements: {
        marker: {
          type: "Stack",
          props: { "data-component-ref": asset.id },
          children: [],
        },
      },
    };
    const result = refs.expandComponentRefs(spec, {
      projectId: PROJECT,
      resolveCatalog,
      resolveTemplate,
    });

    expect(result.spec.root).toBe("marker");
    expect(
      result.spec.elements.marker.props["data-component-ref"],
    ).toBeUndefined();
    expect(result.spec.elements.marker.children).toHaveLength(1);
    expect(result.installs).toHaveLength(1);
  });

  test("two markers of the same ref yield two installs with distinct keys", () => {
    const { resolveCatalog, asset } = makeCatalogHit();
    const spec: Spec = {
      root: "root",
      elements: {
        root: {
          type: "Stack",
          props: {},
          children: ["marker-a", "marker-b"],
        },
        "marker-a": {
          type: "Stack",
          props: { "data-component-ref": asset.id },
          children: [],
        },
        "marker-b": {
          type: "Stack",
          props: { "data-component-ref": asset.id },
          children: [],
        },
      },
    };
    const result = refs.expandComponentRefs(spec, {
      projectId: PROJECT,
      resolveCatalog,
      resolveTemplate,
    });

    expect(result.installs).toHaveLength(2);
    expect(result.installs[0].targetKey).not.toBe(result.installs[1].targetKey);
    expect(result.spec.elements["marker-a"]).toBeUndefined();
    expect(result.spec.elements["marker-b"]).toBeUndefined();
  });

  test("no markers → byte-identical spec, nothing pending (idempotent)", () => {
    const spec = markerSpec("unused");
    spec.elements.root.children = ["card-1"];
    delete spec.elements.marker;
    const result = refs.expandComponentRefs(spec, {
      projectId: PROJECT,
      resolveCatalog: () => null,
      resolveTemplate,
    });
    expect(result.spec).toEqual(spec);
    expect(result.installs).toEqual([]);
    expect(result.dropped).toEqual([]);
  });

  test("a non-string or empty ref prop is not a marker", () => {
    const spec: Spec = {
      root: "root",
      elements: {
        root: { type: "Stack", props: {}, children: ["holder"] },
        holder: {
          type: "Stack",
          props: { "data-component-ref": "" },
          children: [],
        },
      },
    };
    const result = refs.expandComponentRefs(spec, {
      projectId: PROJECT,
      resolveCatalog: () => null,
      resolveTemplate,
    });
    expect(result.spec).toEqual(spec);
    expect(result.dropped).toEqual([]);
  });
});

describe("recordComponentInstalls (phase B)", () => {
  beforeAll(async () => {
    // Reuse the window + modules established above when the file runs in
    // one process; establish them when run standalone.
    if (!catalog) {
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
      catalog = (await import("@/lib/catalog/catalog")) as CatalogModule;
      refs = (await import("./component-refs")) as ComponentRefsModule;
    }
  });

  beforeEach(() => {
    for (const install of [...catalog.getCatalogInstalls()]) {
      catalog.removeCatalogInstall(install.id);
    }
    storage.delete(catalog.CATALOG_STORAGE_KEY);
  });

  test("records each pending row against the host, pinning the version", () => {
    const created = catalog.createCatalogAsset({
      name: "Navbar",
      type: catalog.CATALOG_TYPES.component,
      spec: componentSpec("Navbar"),
    })!;
    const recorded = refs.recordComponentInstalls(
      [
        {
          assetId: created.asset.id,
          versionId: created.version.id,
          targetKey: "nav-root",
        },
      ],
      { hostUiId: HOST_UI, projectId: PROJECT },
    );

    expect(recorded).toBe(1);
    const rows = catalog
      .getCatalogInstalls()
      .filter((row) => row.projectId === PROJECT);
    expect(rows).toHaveLength(1);
    expect(rows[0].targetUiId).toBe(HOST_UI);
    expect(rows[0].targetKey).toBe("nav-root");
    expect(rows[0].versionId).toBe(created.version.id);
  });

  test("no project → nothing written (legacy bucket has nowhere to record)", () => {
    const created = catalog.createCatalogAsset({
      name: "Badge",
      type: catalog.CATALOG_TYPES.component,
      spec: componentSpec("Badge"),
    })!;
    const recorded = refs.recordComponentInstalls(
      [
        {
          assetId: created.asset.id,
          versionId: created.version.id,
          targetKey: "badge",
        },
      ],
      { hostUiId: HOST_UI, projectId: null },
    );
    expect(recorded).toBe(0);
    expect(catalog.getCatalogInstalls()).toHaveLength(0);
  });

  test("empty pending list is a no-op", () => {
    expect(
      refs.recordComponentInstalls([], {
        hostUiId: HOST_UI,
        projectId: PROJECT,
      }),
    ).toBe(0);
  });
});

describe("mergePendingInstalls", () => {
  test("unions and dedupes by asset + target key", () => {
    const a = [
      { assetId: "a1", versionId: "v1", targetKey: "k1" },
      { assetId: "a1", versionId: "v1", targetKey: "k2" },
    ];
    const b = [
      { assetId: "a1", versionId: "v1", targetKey: "k2" }, // duplicate
      { assetId: "a2", versionId: "v9", targetKey: "k3" },
    ];
    const merged = refs.mergePendingInstalls(a, b);
    expect(merged).toHaveLength(3);
    expect(merged.map((row) => row.targetKey)).toEqual(["k1", "k2", "k3"]);
  });
});
