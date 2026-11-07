import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Spec } from "@json-render/core";

type CatalogModule = typeof import("./catalog");
type TemplatesModule = typeof import("@/lib/editor/templates");

let catalog: CatalogModule;
let templates: TemplatesModule;
let storage: Map<string, string>;

function makeSpec(title: string): Spec {
  return {
    root: "root",
    elements: { root: { type: "Card", props: { title } } },
  };
}

/** A valid template as the library would hand it over for seeding. */
const SEED_TEMPLATE = {
  id: "tpl-seed-1",
  name: "Hero",
  createdAt: 1000,
  subtree: {
    rootKey: "card-1",
    elements: { "card-1": { type: "Card", props: {} } },
  },
};

/** Reset the catalog through its own API (cache + storage agree) and drop
 *  the one-time seed marker — the module instance is shared process-wide. */
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

function resetTemplates(): void {
  for (const template of [...templates.getTemplates()]) {
    templates.removeTemplate(template.id);
  }
  templates.setTemplateSavedListener(null);
}

describe("catalog store (plan 066)", () => {
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
    // Dynamic imports after the window exists — the same module instances
    // lib/history/sync.test.ts drives (shared process), so each file's
    // reset keeps the single cache coherent.
    catalog = (await import("./catalog")) as CatalogModule;
    templates = (await import("@/lib/editor/templates")) as TemplatesModule;
  });

  beforeEach(() => {
    resetCatalog();
    resetTemplates();
  });

  test("create makes an asset with version 1, detached spec and trimmed name", () => {
    const spec = makeSpec("v1");
    const created = catalog.createCatalogAsset({
      name: "  Card  ",
      description: "A card",
      type: catalog.CATALOG_TYPES.component,
      spec,
    });
    expect(created).not.toBeNull();
    const { asset, version } = created!;
    expect(asset.name).toBe("Card"); // trimmed
    expect(asset.description).toBe("A card");
    expect(asset.visibility).toBe(catalog.CATALOG_VISIBILITIES.private);
    expect(asset.latestVersionId).toBe(version.id);
    expect(version.version).toBe(1);
    expect(version.assetId).toBe(asset.id);
    expect(version.changelog).toBeNull();

    expect(catalog.getCatalogAssets()).toHaveLength(1);
    expect(catalog.getCatalogVersions()).toHaveLength(1);
    expect(catalog.getAssetVersions(asset.id)).toHaveLength(1);

    // Detached: later edits to the source spec never touch the store.
    const stored = version.spec as Spec;
    spec.elements.root.props.title = "changed";
    expect(stored.elements.root.props.title).toBe("v1");
  });

  test("create rejects empty names, invalid specs and junk types", () => {
    expect(
      catalog.createCatalogAsset({
        name: "   ",
        type: "component",
        spec: makeSpec("v1"),
      }),
    ).toBeNull();
    expect(
      catalog.createCatalogAsset({
        name: "Card",
        type: "component",
        spec: {} as Spec,
      }),
    ).toBeNull();
    expect(
      catalog.createCatalogAsset({
        name: "Card",
        type: "bogus" as never,
        spec: makeSpec("v1"),
      }),
    ).toBeNull();
    expect(catalog.getCatalogAssets()).toHaveLength(0);
  });

  test("publish keeps old versions, bumps monotonic + the latest pointer", () => {
    const { asset } = catalog.createCatalogAsset({
      name: "Card",
      type: catalog.CATALOG_TYPES.component,
      spec: makeSpec("v1"),
    })!;
    const v1 = catalog.getAssetVersions(asset.id)[0];

    const v2 = catalog.publishCatalogVersion(
      asset.id,
      makeSpec("v2"),
      "tweaks",
    );
    expect(v2?.version).toBe(2);
    expect(v2?.changelog).toBe("tweaks");
    const v3 = catalog.publishCatalogVersion(asset.id, makeSpec("v3"));
    expect(v3?.version).toBe(3);
    expect(v3?.changelog).toBeNull(); // empty/absent changelog normalizes

    const versions = catalog.getAssetVersions(asset.id);
    expect(versions.map((version) => version.version)).toEqual([1, 2, 3]);
    // Old versions stay byte-identical (decision 3 — immutable snapshots).
    expect(versions[0]).toEqual(v1);
    expect((versions[0].spec as Spec).elements.root.props.title).toBe("v1");

    const [updated] = catalog.getCatalogAssets();
    expect(updated.latestVersionId).toBe(v3!.id);
    expect(updated.updatedAt).toBeGreaterThanOrEqual(v3!.updatedAt);

    // Unknown asset / invalid spec → no-op.
    expect(catalog.publishCatalogVersion("nope", makeSpec("x"))).toBeNull();
    expect(catalog.publishCatalogVersion(asset.id, {} as Spec)).toBeNull();
    expect(catalog.getAssetVersions(asset.id)).toHaveLength(3);
  });

  test("update renames, re-describes and flips visibility; no-ops stay no-ops", () => {
    const { asset } = catalog.createCatalogAsset({
      name: "Card",
      type: catalog.CATALOG_TYPES.screen,
      spec: makeSpec("v1"),
    })!;
    let notified = 0;
    const unsubscribe = catalog.subscribeCatalog(() => {
      notified += 1;
    });

    expect(
      catalog.updateCatalogAsset(asset.id, {
        name: "Renamed",
        visibility: catalog.CATALOG_VISIBILITIES.public,
      }),
    ).toBe(true);
    const [updated] = catalog.getCatalogAssets();
    expect(updated.name).toBe("Renamed");
    expect(updated.visibility).toBe("public");
    expect(updated.description).toBeNull(); // untouched
    expect(notified).toBe(1);

    // Unchanged patch and unknown ids write nothing.
    expect(
      catalog.updateCatalogAsset(asset.id, {
        name: "Renamed",
        visibility: catalog.CATALOG_VISIBILITIES.public,
      }),
    ).toBe(false);
    expect(catalog.updateCatalogAsset("nope", { name: "X" })).toBe(false);
    expect(catalog.updateCatalogAsset(asset.id, { name: "   " })).toBe(false);
    expect(notified).toBe(1);
    unsubscribe();
  });

  test("remove takes versions and installs with it in one write", () => {
    const { asset, version } = catalog.createCatalogAsset({
      name: "Card",
      type: catalog.CATALOG_TYPES.component,
      spec: makeSpec("v1"),
    })!;
    const install = catalog.addCatalogInstall({
      projectId: "project-1",
      assetId: asset.id,
      versionId: version.id,
    });
    expect(install).not.toBeNull();
    expect(catalog.removeCatalogAsset(asset.id)).toBe(true);

    expect(catalog.getCatalogAssets()).toHaveLength(0);
    expect(catalog.getCatalogVersions()).toHaveLength(0);
    expect(catalog.getCatalogInstalls()).toHaveLength(0);
    expect(catalog.removeCatalogAsset(asset.id)).toBe(false); // unknown
  });

  test("install pins a version of the asset; mismatched pins are rejected", () => {
    const first = catalog.createCatalogAsset({
      name: "One",
      type: catalog.CATALOG_TYPES.screen,
      spec: makeSpec("v1"),
    })!;
    const other = catalog.createCatalogAsset({
      name: "Two",
      type: catalog.CATALOG_TYPES.screen,
      spec: makeSpec("v1"),
    })!;

    const install = catalog.addCatalogInstall({
      projectId: "project-1",
      assetId: first.asset.id,
      versionId: first.version.id,
      targetUiId: "ui-9",
    });
    expect(install?.versionId).toBe(first.version.id);
    expect(install?.targetUiId).toBe("ui-9");

    // The pin must belong to the asset (RLS WITH CHECK shape) and both
    // rows must exist; an empty project is rejected too.
    expect(
      catalog.addCatalogInstall({
        projectId: "project-1",
        assetId: first.asset.id,
        versionId: other.version.id,
      }),
    ).toBeNull();
    expect(
      catalog.addCatalogInstall({
        projectId: "project-1",
        assetId: "ghost",
        versionId: first.version.id,
      }),
    ).toBeNull();
    expect(
      catalog.addCatalogInstall({
        projectId: "  ",
        assetId: first.asset.id,
        versionId: first.version.id,
      }),
    ).toBeNull();
    expect(catalog.getCatalogInstalls()).toHaveLength(1);
  });

  test("updateCatalogInstallPin re-points pins with the WITH CHECK shape", () => {
    const first = catalog.createCatalogAsset({
      name: "One",
      type: catalog.CATALOG_TYPES.screen,
      spec: makeSpec("v1"),
    })!;
    const v2 = catalog.publishCatalogVersion(first.asset.id, makeSpec("v2"))!;
    const other = catalog.createCatalogAsset({
      name: "Two",
      type: catalog.CATALOG_TYPES.screen,
      spec: makeSpec("v1"),
    })!;
    const install = catalog.addCatalogInstall({
      projectId: "project-1",
      assetId: first.asset.id,
      versionId: first.version.id,
    })!;

    // The only writer of versionId after creation (Task 3 update/rollback).
    expect(catalog.updateCatalogInstallPin(install.id, v2.id)).toBe(true);
    expect(
      catalog.getCatalogInstalls().find((row) => row.id === install.id)
        ?.versionId,
    ).toBe(v2.id);

    // Rejections mirror the RLS WITH CHECK: a version of ANOTHER asset,
    // an unknown version, an unknown install — and an unchanged pin is a
    // no-op (idempotent), never a timestamp bump for nothing.
    expect(catalog.updateCatalogInstallPin(install.id, other.version.id)).toBe(
      false,
    );
    expect(catalog.updateCatalogInstallPin(install.id, "ghost")).toBe(false);
    expect(catalog.updateCatalogInstallPin("ghost", v2.id)).toBe(false);
    expect(catalog.updateCatalogInstallPin(install.id, v2.id)).toBe(false);
    expect(
      catalog.getCatalogInstalls().find((row) => row.id === install.id)
        ?.versionId,
    ).toBe(v2.id);
  });

  test("setCatalogInstallTarget mirrors the fork RPC's reference swap", () => {
    const { asset, version } = catalog.createCatalogAsset({
      name: "One",
      type: catalog.CATALOG_TYPES.screen,
      spec: makeSpec("v1"),
    })!;
    const install = catalog.addCatalogInstall({
      projectId: "project-1",
      assetId: asset.id,
      versionId: version.id,
      targetUiId: "ui-old",
    })!;

    expect(catalog.setCatalogInstallTarget(install.id, "ui-fork")).toBe(true);
    expect(
      catalog.getCatalogInstalls().find((row) => row.id === install.id)
        ?.targetUiId,
    ).toBe("ui-fork");

    // Same value / unknown install / empty target: no-ops.
    expect(catalog.setCatalogInstallTarget(install.id, "ui-fork")).toBe(false);
    expect(catalog.setCatalogInstallTarget("ghost", "ui-x")).toBe(false);
    expect(catalog.setCatalogInstallTarget(install.id, "   ")).toBe(false);

    // Decision 10a mirror: a component install's target_key clears WITH the
    // reference swap (the old key belonged to the old target).
    const component = catalog.addCatalogInstall({
      projectId: "project-1",
      assetId: asset.id,
      versionId: version.id,
      targetUiId: "host-1",
      targetKey: "card-1",
    })!;
    expect(catalog.setCatalogInstallTarget(component.id, "ui-fork-2")).toBe(
      true,
    );
    const mirrored = catalog
      .getCatalogInstalls()
      .find((row) => row.id === component.id);
    expect(mirrored?.targetUiId).toBe("ui-fork-2");
    expect(mirrored?.targetKey).toBeNull();
  });

  test("addCatalogInstall takes an explicit id for the fork-RPC mirror", () => {
    const { asset, version } = catalog.createCatalogAsset({
      name: "One",
      type: catalog.CATALOG_TYPES.screen,
      spec: makeSpec("v1"),
    })!;
    const explicit = "99999999-9999-4999-8999-999999999999";
    const install = catalog.addCatalogInstall({
      id: explicit,
      projectId: "project-1",
      assetId: asset.id,
      versionId: version.id,
      targetUiId: "ui-fork",
    })!;
    expect(install.id).toBe(explicit);

    // Same id again = the mirror no-op (a pull or an earlier mirror already
    // created the row) — returned untouched, never duplicated.
    const again = catalog.addCatalogInstall({
      id: explicit,
      projectId: "project-1",
      assetId: asset.id,
      versionId: version.id,
      targetUiId: "other",
    })!;
    expect(again.id).toBe(explicit);
    expect(again.targetUiId).toBe("ui-fork");
    expect(catalog.getCatalogInstalls()).toHaveLength(1);
  });

  test("sanitize backfills ownerId — missing reads as the local claim", () => {
    // Pre-decision-11 storage rows carry no ownerId: they read as "" (the
    // locally-created claim the push stamps over); real ids pass through.
    const [asset] = catalog.sanitizeCatalogAssets([
      {
        id: "aaaaaaaa-4444-4888-8999-0000000000a9",
        name: "Old row",
        description: null,
        type: "component",
        visibility: "public",
        latestVersionId: null,
        createdAt: 1000,
        updatedAt: 1000,
      },
    ]);
    expect(asset.ownerId).toBe("");

    const [foreign] = catalog.sanitizeCatalogAssets([
      {
        id: "aaaaaaaa-4444-4888-8999-0000000000b9",
        name: "Foreign row",
        description: null,
        type: "component",
        visibility: "public",
        latestVersionId: null,
        ownerId: "user-x",
        createdAt: 1000,
        updatedAt: 1000,
      },
    ]);
    expect(foreign.ownerId).toBe("user-x");

    const [version] = catalog.sanitizeCatalogVersions([
      {
        id: "bbbbbbbb-4444-4888-8999-0000000000c9",
        assetId: asset.id,
        version: 1,
        spec: makeSpec("v1"),
        changelog: null,
        createdAt: 1000,
        updatedAt: 1000,
      },
    ]);
    expect(version.ownerId).toBe("");
  });

  test("adopting a colliding remote version renumbers the local row, never drops it", () => {
    const { asset } = catalog.createCatalogAsset({
      name: "Card",
      type: catalog.CATALOG_TYPES.component,
      spec: makeSpec("v1"),
    })!;
    const local = catalog.publishCatalogVersion(asset.id, makeSpec("v2"))!;

    // Device two published ITS v2 with a different id (same unique slot).
    const remote = {
      id: "remote-v2",
      assetId: asset.id,
      version: 2,
      spec: makeSpec("remote two"),
      changelog: null,
      ownerId: "",
      createdAt: 5000,
      updatedAt: 5000,
    };
    catalog.applyRemoteCatalogVersion(remote);

    expect(catalog.getAssetVersions(asset.id).map((v) => v.version)).toEqual([
      1, 2, 3,
    ]);
    const mine = catalog
      .getCatalogVersions()
      .find((version) => version.id === local.id);
    expect(mine?.version).toBe(3); // renumbered — id untouched, pin-safe
    expect(catalog.getCatalogVersions().some((v) => v.id === "remote-v2")).toBe(
      true,
    );
  });

  test("push-time reconcile defuses the same collision without adoption", () => {
    const { asset } = catalog.createCatalogAsset({
      name: "Card",
      type: catalog.CATALOG_TYPES.component,
      spec: makeSpec("v1"),
    })!;
    const local = catalog.publishCatalogVersion(asset.id, makeSpec("v2"))!;

    catalog.reconcileCatalogVersions([
      { id: "remote-x", asset_id: asset.id, version: 2 },
      { id: "remote-x", version: 9 }, // no asset_id — ignored
      { id: "remote-y" }, // partial — ignored
    ]);
    const mine = catalog
      .getCatalogVersions()
      .find((version) => version.id === local.id);
    expect(mine?.version).toBe(3);

    // Idempotent: a second pass with the same remote rows changes nothing.
    const before = catalog
      .getCatalogVersions()
      .find((version) => version.id === local.id);
    catalog.reconcileCatalogVersions([
      { id: "remote-x", asset_id: asset.id, version: 2 },
    ]);
    const after = catalog
      .getCatalogVersions()
      .find((version) => version.id === local.id);
    expect(after).toEqual(before);
  });

  test("seed migrates templates idempotently — uuid becomes the asset id", () => {
    expect(catalog.seedCatalogFromTemplates([SEED_TEMPLATE as never])).toBe(1);
    const asset = catalog
      .getCatalogAssets()
      .find((candidate) => candidate.id === SEED_TEMPLATE.id);
    expect(asset).toBeDefined();
    expect(asset?.type).toBe(catalog.CATALOG_TYPES.component);
    expect(asset?.visibility).toBe("private");
    expect(asset?.createdAt).toBe(SEED_TEMPLATE.createdAt);

    const version = catalog
      .getCatalogVersions()
      .find((candidate) => candidate.assetId === SEED_TEMPLATE.id);
    expect(version?.version).toBe(1);
    expect((version?.spec as Spec).root).toBe("card-1"); // rootKey → spec.root

    // Second run: nothing new, no duplicate rows.
    expect(catalog.seedCatalogFromTemplates([SEED_TEMPLATE as never])).toBe(0);
    expect(catalog.getCatalogAssets()).toHaveLength(1);
    expect(catalog.getCatalogVersions()).toHaveLength(1);
  });

  test("startTemplateSeeding migrates once, mirrors saves, cleans up", () => {
    const existing = templates.saveTemplate(
      "Existing",
      makeSpec("v1"),
      "root",
    )!;

    const stop = catalog.startTemplateSeeding();
    expect(
      catalog.getCatalogAssets().some((asset) => asset.id === existing.id),
    ).toBe(true);

    // The seed marker keeps a deleted seeded asset from resurrecting.
    catalog.removeCatalogAsset(existing.id);
    const stopAgain = catalog.startTemplateSeeding();
    expect(catalog.getCatalogAssets()).toHaveLength(0);

    // While seeding runs, a new save mirrors into the catalog (decision 5).
    const mirrored = templates.saveTemplate(
      "Mirrored",
      makeSpec("v2"),
      "root",
    )!;
    expect(
      catalog.getCatalogAssets().some((asset) => asset.id === mirrored.id),
    ).toBe(true);

    // Cleanup unregisters the listener — signed out, saves stay local.
    stop();
    stopAgain();
    const localOnly = templates.saveTemplate("Local", makeSpec("v3"), "root")!;
    expect(
      catalog.getCatalogAssets().some((asset) => asset.id === localOnly.id),
    ).toBe(false);
    expect(templates.getTemplates()).toHaveLength(3); // library intact
  });

  test("server snapshot is empty — SSR never mismatches", () => {
    expect(catalog.getServerCatalog()).toEqual({
      assets: [],
      versions: [],
      installs: [],
    });
  });

  test("project assets carry a manifest; create validates per type (plan 073)", () => {
    const manifest = {
      screens: [{ name: "Home", route: null, spec: makeSpec("Home") }],
      components: ["b2300000-0000-4000-8000-00000000000a"],
    };
    const created = catalog.createCatalogAsset({
      name: "Storefront",
      type: catalog.CATALOG_TYPES.project,
      spec: manifest,
    });
    expect(created?.asset.type).toBe(catalog.CATALOG_TYPES.project);
    expect(created?.version.spec).toEqual(manifest);

    // Per-type rule: a manifest is refused for a screen/component asset and
    // a bare spec for a project asset.
    expect(
      catalog.createCatalogAsset({
        name: "Screen",
        type: catalog.CATALOG_TYPES.screen,
        spec: manifest,
      }),
    ).toBeNull();
    expect(
      catalog.createCatalogAsset({
        name: "Project",
        type: catalog.CATALOG_TYPES.project,
        spec: makeSpec("v1"),
      }),
    ).toBeNull();
  });

  test("publishCatalogVersion branches on the owning asset type (plan 073)", () => {
    const manifest = {
      screens: [{ name: "Home", route: null, spec: makeSpec("Home") }],
      components: ["b2300000-0000-4000-8000-00000000000a"],
    };
    const project = catalog.createCatalogAsset({
      name: "Storefront",
      type: catalog.CATALOG_TYPES.project,
      spec: manifest,
    })!;
    const screen = catalog.createCatalogAsset({
      name: "Card screen",
      type: catalog.CATALOG_TYPES.screen,
      spec: makeSpec("v1"),
    })!;

    // Manifest accepted on the project, refused on the screen; a spec is the
    // mirror image. Nothing is written for a refused publish.
    expect(
      catalog.publishCatalogVersion(project.asset.id, manifest),
    ).not.toBeNull();
    expect(
      catalog.publishCatalogVersion(project.asset.id, makeSpec("x")),
    ).toBeNull();
    expect(catalog.publishCatalogVersion(screen.asset.id, manifest)).toBeNull();
    expect(
      catalog.publishCatalogVersion(screen.asset.id, makeSpec("v2")),
    ).not.toBeNull();
    expect(catalog.getAssetVersions(project.asset.id)).toHaveLength(2);
    expect(catalog.getAssetVersions(screen.asset.id)).toHaveLength(2);
  });

  test("sanitize keeps a project asset and its manifest version (sync land path)", () => {
    const manifest = {
      screens: [{ name: "Home", route: "", spec: makeSpec("Home") }],
      components: ["b2300000-0000-4000-8000-00000000000a"],
    };
    const assets = catalog.sanitizeCatalogAssets([
      {
        id: "asset-1",
        name: "Storefront",
        type: "project",
        visibility: "public",
        latestVersionId: "version-1",
        ownerId: "user-1",
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    expect(assets).toHaveLength(1);
    const versions = catalog.sanitizeCatalogVersions([
      {
        id: "version-1",
        assetId: "asset-1",
        version: 1,
        spec: manifest,
        ownerId: "user-1",
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    expect(versions).toHaveLength(1);
    expect(versions[0]?.spec).toEqual(manifest);
  });
});
