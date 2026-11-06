import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Spec } from "@json-render/core";
import type { ForkClient } from "./install";

type CatalogModule = typeof import("./catalog");
type InstallModule = typeof import("./install");
type HistoryModule = typeof import("@/lib/history/history");
type MembershipsModule = typeof import("@/lib/projects/memberships");

let catalog: CatalogModule;
let flows: InstallModule;
let history: HistoryModule;
let memberships: MembershipsModule;
let storage: Map<string, string>;

const PROJECT = "11111111-2222-4333-8444-555555555555";

function makeSpec(title: string): Spec {
  return {
    root: "root",
    elements: { root: { type: "Card", props: { title } } },
  };
}

/** A host screen with one child — component expansions land beside it. */
function makeHostSpec(): Spec {
  return {
    root: "root",
    elements: {
      root: { type: "Stack", props: {}, children: ["card-1"] },
      "card-1": { type: "Card", props: { title: "Host" } },
    },
  };
}

function makeComponentSpec(title: string): Spec {
  return {
    root: "comp-root",
    elements: { "comp-root": { type: "Card", props: { title } } },
  };
}

/** The full `uis` row shape the fork RPC returns (`to_jsonb(v_row)`). */
function forkUisRow(id: string): Record<string, unknown> {
  return {
    id,
    owner_id: "owner-1",
    name: "Forked copy",
    slug: "forked-copy-00000000",
    prompt: "Forked copy",
    revisions: [
      { spec: makeSpec("forked"), label: "generate", createdAt: 1000 },
    ],
    head: 0,
    created_at: new Date(1000).toISOString(),
    updated_at: new Date(2000).toISOString(),
  };
}

function makeForkClient(response: {
  data?: unknown;
  error?: { message: string } | null;
}): ForkClient & {
  calls: { fn: string; args: Record<string, unknown> }[];
} {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  return {
    calls,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return { data: response.data ?? null, error: response.error ?? null };
    },
  };
}

/** Reset every store this file touches through its own API (cache +
 *  storage agree) — the module instances are shared process-wide. */
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
  history.clearHistory();
  storage.delete(catalog.CATALOG_STORAGE_KEY);
  storage.delete(catalog.CATALOG_SEEDED_STORAGE_KEY);
  storage.delete(memberships.MEMBERSHIP_STORAGE_KEY);
  storage.delete("genui-history");
}

describe("install/update/fork flows (plan 066 task 3)", () => {
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
    flows = (await import("./install")) as InstallModule;
    history = (await import("@/lib/history/history")) as HistoryModule;
    memberships =
      (await import("@/lib/projects/memberships")) as MembershipsModule;
  });

  beforeEach(() => {
    resetAll();
  });

  test("screen install: uis row at revision 0 + membership + version pin", () => {
    const { asset, version } = catalog.createCatalogAsset({
      name: "Detail screen",
      type: catalog.CATALOG_TYPES.screen,
      spec: makeSpec("v1"),
    })!;

    const installed = flows.installScreenAsset({
      asset,
      version,
      projectId: PROJECT,
    });
    expect(installed).not.toBeNull();
    const { entry, install } = installed!;

    // Snapshot copy: fresh identity, revision 0, project-stamped.
    expect(entry.name).toBe("Detail screen");
    expect(entry.spec).toEqual(makeSpec("v1"));
    expect(entry.revisions).toHaveLength(1);
    expect(entry.head).toBe(0);
    expect(entry.projectId).toBe(PROJECT);
    expect(history.getHistory().map((row) => row.id)).toContain(entry.id);

    // Decision 8: membership lands it in the active project's drawer.
    const membership = memberships
      .getMemberships()
      .find((row) => row.projectId === PROJECT && row.screenId === entry.id);
    expect(membership).toBeDefined();

    // Decision 1: the pin points at the materialized copy.
    expect(install.versionId).toBe(version.id);
    expect(install.targetUiId).toBe(entry.id);
    expect(install.targetKey).toBeNull();
    expect(install.projectId).toBe(PROJECT);

    // The version's spec is detached — later source edits never leak in.
    (version.spec.elements.root.props as { title: string }).title = "changed";
    expect(entry.spec.elements.root.props.title).toBe("v1");
  });

  test("screen install guards: type, version ownership, project, store rows", () => {
    const screen = catalog.createCatalogAsset({
      name: "Screen",
      type: catalog.CATALOG_TYPES.screen,
      spec: makeSpec("v1"),
    })!;
    const component = catalog.createCatalogAsset({
      name: "Component",
      type: catalog.CATALOG_TYPES.component,
      spec: makeComponentSpec("v1"),
    })!;

    const before = () =>
      history.getHistory().length +
      memberships.getMemberships().length +
      catalog.getCatalogInstalls().length;

    const baseline = before();
    expect(
      flows.installScreenAsset({
        asset: component.asset,
        version: component.version,
        projectId: PROJECT,
      }),
    ).toBeNull();
    expect(
      flows.installScreenAsset({
        asset: screen.asset,
        version: component.version, // belongs to another asset
        projectId: PROJECT,
      }),
    ).toBeNull();
    expect(
      flows.installScreenAsset({
        asset: screen.asset,
        version: screen.version,
        projectId: "   ",
      }),
    ).toBeNull();
    expect(
      flows.installScreenAsset({
        asset: { ...screen.asset, id: "ghost" }, // not in the store
        version: screen.version,
        projectId: PROJECT,
      }),
    ).toBeNull();
    expect(before()).toBe(baseline); // nothing written on any rejection
  });

  test("component insert: fresh keys + provenance + install against host", () => {
    const { asset, version } = catalog.createCatalogAsset({
      name: "Badge",
      type: catalog.CATALOG_TYPES.component,
      spec: makeComponentSpec("v1"),
    })!;
    const host = history.createEntry("Host", makeHostSpec(), PROJECT);
    history.addEntry(host);

    const result = flows.insertCatalogComponent(host.spec, {
      parentKey: "root",
      asset,
      version,
      hostUiId: host.id,
      projectId: PROJECT,
    });
    expect(result).not.toBeNull();

    // Expansion: new root beside the existing child, provenance stamped.
    const newKey = result!.key;
    const root = result!.spec.elements.root;
    expect(root.children).toEqual(["card-1", newKey]);
    expect(
      (result!.spec.elements[newKey].props as Record<string, unknown>)[
        "data-template-id"
      ],
    ).toBe(asset.id);
    expect(result!.spec.elements[newKey].props.title).toBe("v1");

    // The install records host + expanded root + the pin.
    const install = catalog
      .getCatalogInstalls()
      .find((row) => row.id === result!.install.id);
    expect(install?.targetUiId).toBe(host.id);
    expect(install?.targetKey).toBe(newKey);
    expect(install?.versionId).toBe(version.id);

    // Guards: wrong type / missing parent / empty project write nothing.
    const baseline = catalog.getCatalogInstalls().length;
    expect(
      flows.insertCatalogComponent(host.spec, {
        parentKey: "root",
        asset: { ...asset, type: "screen" as never },
        version,
        hostUiId: host.id,
        projectId: PROJECT,
      }),
    ).toBeNull();
    expect(
      flows.insertCatalogComponent(host.spec, {
        parentKey: "ghost",
        asset,
        version,
        hostUiId: host.id,
        projectId: PROJECT,
      }),
    ).toBeNull();
    expect(
      flows.insertCatalogComponent(host.spec, {
        parentKey: "root",
        asset,
        version,
        hostUiId: host.id,
        projectId: "  ",
      }),
    ).toBeNull();
    expect(catalog.getCatalogInstalls()).toHaveLength(baseline);
  });

  test("getInstallStatus: installed vs latest drives the update affordance", () => {
    const { asset, version } = catalog.createCatalogAsset({
      name: "Card",
      type: catalog.CATALOG_TYPES.screen,
      spec: makeSpec("v1"),
    })!;
    const { install } = flows.installScreenAsset({
      asset,
      version,
      projectId: PROJECT,
    })!;

    expect(flows.getInstallStatus(install)).toEqual({
      installedVersionId: version.id,
      latestVersionId: version.id,
      upToDate: true,
    });

    const v2 = catalog.publishCatalogVersion(asset.id, makeSpec("v2"))!;
    const behind = flows.getInstallStatus(install);
    expect(behind.upToDate).toBe(false);
    expect(behind.latestVersionId).toBe(v2.id);
    expect(behind.installedVersionId).toBe(version.id);
  });

  test("screen update swaps content through the revision stack; rollback restores", () => {
    const { asset, version } = catalog.createCatalogAsset({
      name: "Card",
      type: catalog.CATALOG_TYPES.screen,
      spec: makeSpec("v1"),
    })!;
    const { entry, install } = flows.installScreenAsset({
      asset,
      version,
      projectId: PROJECT,
    })!;
    const v2 = catalog.publishCatalogVersion(asset.id, makeSpec("v2"))!;

    const updated = flows.updateCatalogInstall(install.id);
    expect(updated).not.toBeNull();
    expect(updated!.applied).toBe(true);
    expect(updated!.install.versionId).toBe(v2.id);

    // Content swapped AND appended — the previous version stays undoable.
    const target = history.getHistory().find((row) => row.id === entry.id)!;
    expect(target.spec.elements.root.props.title).toBe("v2");
    expect(target.revisions).toHaveLength(2);
    expect(target.head).toBe(1);
    expect(target.revisions[1].label).toBe("catalog:v2");
    expect(flows.getInstallStatus(updated!.install).upToDate).toBe(true);

    // Rollback = the same flow pinned to the older version.
    const rolledBack = flows.updateCatalogInstall(install.id, version.id);
    expect(rolledBack!.applied).toBe(true);
    expect(rolledBack!.install.versionId).toBe(version.id);
    const restored = history.getHistory().find((row) => row.id === entry.id)!;
    expect(restored.spec.elements.root.props.title).toBe("v1");
    expect(restored.revisions).toHaveLength(3);

    // Idempotence and rejections: same pin, unknown ids, foreign version.
    expect(flows.updateCatalogInstall(install.id, version.id)).toBeNull();
    expect(flows.updateCatalogInstall("ghost")).toBeNull();
    const other = catalog.createCatalogAsset({
      name: "Other",
      type: catalog.CATALOG_TYPES.screen,
      spec: makeSpec("x"),
    })!;
    expect(flows.updateCatalogInstall(install.id, other.version.id)).toBeNull();
  });

  test("screen update with a deleted copy re-points the pin only", () => {
    const { asset, version } = catalog.createCatalogAsset({
      name: "Card",
      type: catalog.CATALOG_TYPES.screen,
      spec: makeSpec("v1"),
    })!;
    const { entry, install } = flows.installScreenAsset({
      asset,
      version,
      projectId: PROJECT,
    })!;
    const v2 = catalog.publishCatalogVersion(asset.id, makeSpec("v2"))!;
    history.removeEntry(entry.id); // user deleted the materialized copy

    const updated = flows.updateCatalogInstall(install.id);
    expect(updated).not.toBeNull();
    expect(updated!.applied).toBe(false); // nothing to swap into
    expect(updated!.install.versionId).toBe(v2.id); // pin still moved
  });

  test("component update re-expands at the old position with fresh keys", () => {
    const { asset, version } = catalog.createCatalogAsset({
      name: "Badge",
      type: catalog.CATALOG_TYPES.component,
      spec: makeComponentSpec("V1"),
    })!;
    const host = history.createEntry("Host", makeHostSpec(), PROJECT);
    history.addEntry(host);
    const inserted = flows.insertCatalogComponent(host.spec, {
      parentKey: "root",
      asset,
      version,
      hostUiId: host.id,
      projectId: PROJECT,
    })!;
    history.replaceEntrySpec(host.id, inserted.spec, "structure:insert:Badge");
    const v2 = catalog.publishCatalogVersion(
      asset.id,
      makeComponentSpec("V2"),
    )!;

    const updated = flows.updateCatalogInstall(inserted.install.id);
    expect(updated).not.toBeNull();
    expect(updated!.applied).toBe(true);
    expect(updated!.install.versionId).toBe(v2.id);

    const target = history.getHistory().find((row) => row.id === host.id)!;
    // Exactly one provenance-stamped copy, carrying the NEW content, at
    // the old index (children order: the pre-existing child first).
    const stamped = Object.entries(target.spec.elements).filter(
      ([, element]) =>
        (element.props as Record<string, unknown>)["data-template-id"] ===
        asset.id,
    );
    expect(stamped).toHaveLength(1);
    const [newKey, newElement] = stamped[0];
    expect(newElement.props.title).toBe("V2");
    expect(target.spec.elements.root.children).toEqual(["card-1", newKey]);
    expect(target.revisions.at(-1)?.label).toBe("catalog:v2");

    // The host's own child never moved or changed.
    expect(target.spec.elements["card-1"].props.title).toBe("Host");
  });

  test("fork adopts the RPC row, mirrors target and adds membership", async () => {
    const { asset, version } = catalog.createCatalogAsset({
      name: "Shared",
      type: catalog.CATALOG_TYPES.screen,
      spec: makeSpec("v1"),
    })!;
    const install = catalog.addCatalogInstall({
      projectId: PROJECT,
      assetId: asset.id,
      versionId: version.id,
      targetUiId: "ui-old",
    })!;
    const forkedId = "f0000000-0000-4000-8000-000000000001";
    const client = makeForkClient({
      data: {
        uis_id: forkedId,
        version_id: version.id,
        install_id: install.id,
        membership_swapped: false,
        uis_row: forkUisRow(forkedId),
      },
    });

    const result = await flows.forkCatalogAsset(client, {
      assetId: asset.id,
      projectId: PROJECT,
    });

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].fn).toBe("fork_catalog_asset");
    expect(client.calls[0].args).toEqual({
      p_asset_id: asset.id,
      p_version_id: null,
      p_project_id: PROJECT,
    });
    expect(result).toEqual({
      uisId: forkedId,
      versionId: version.id,
      installId: install.id,
      membershipAdded: true,
    });

    // The forked entry is adopted immediately (revision 0 + project stamp).
    const entry = history.getHistory().find((row) => row.id === forkedId);
    expect(entry).toBeDefined();
    expect(entry!.revisions).toHaveLength(1);
    expect(entry!.spec.elements.root.props.title).toBe("forked");

    // Membership added through 065's store (the RPC had none to swap)…
    const membership = memberships
      .getMemberships()
      .find((row) => row.projectId === PROJECT && row.screenId === forkedId);
    expect(membership).toBeDefined();
    // …and the install's target mirrors the DB swap locally.
    expect(
      catalog.getCatalogInstalls().find((row) => row.id === install.id)
        ?.targetUiId,
    ).toBe(forkedId);
  });

  test("fork skips the membership add when the RPC swapped one", async () => {
    const { asset, version } = catalog.createCatalogAsset({
      name: "Shared",
      type: catalog.CATALOG_TYPES.screen,
      spec: makeSpec("v1"),
    })!;
    const forkedId = "f0000000-0000-4000-8000-000000000002";
    const client = makeForkClient({
      data: {
        uis_id: forkedId,
        version_id: version.id,
        install_id: null,
        membership_swapped: true,
        uis_row: forkUisRow(forkedId),
      },
    });

    const result = await flows.forkCatalogAsset(client, {
      assetId: asset.id,
      versionId: version.id,
      projectId: PROJECT,
    });

    expect(result?.membershipAdded).toBe(false);
    expect(
      memberships.getMemberships().filter((row) => row.screenId === forkedId),
    ).toHaveLength(0);
  });

  test("fork without a project neither adds membership nor needs one", async () => {
    const { asset } = catalog.createCatalogAsset({
      name: "Solo",
      type: catalog.CATALOG_TYPES.screen,
      spec: makeSpec("v1"),
    })!;
    const forkedId = "f0000000-0000-4000-8000-000000000003";
    const client = makeForkClient({
      data: {
        uis_id: forkedId,
        version_id: "v-id",
        install_id: null,
        membership_swapped: false,
        uis_row: forkUisRow(forkedId),
      },
    });

    const result = await flows.forkCatalogAsset(client, { assetId: asset.id });
    expect(result?.membershipAdded).toBe(false);
    expect(memberships.getMemberships()).toHaveLength(0);
    expect(client.calls[0].args.p_project_id).toBeNull();
  });

  test("fork failures write nothing locally", async () => {
    const { asset } = catalog.createCatalogAsset({
      name: "Private",
      type: catalog.CATALOG_TYPES.screen,
      spec: makeSpec("v1"),
    })!;
    const baseline = () =>
      history.getHistory().length + memberships.getMemberships().length;

    const before = baseline();
    const refused = makeForkClient({
      error: { message: "plan 066 decision 4: asset not found" },
    });
    expect(
      await flows.forkCatalogAsset(refused, {
        assetId: asset.id,
        projectId: PROJECT,
      }),
    ).toBeNull();

    const junk = makeForkClient({ data: "not-an-object" });
    expect(
      await flows.forkCatalogAsset(junk, { assetId: asset.id }),
    ).toBeNull();

    const missingIds = makeForkClient({ data: { uis_id: "" } });
    expect(
      await flows.forkCatalogAsset(missingIds, { assetId: asset.id }),
    ).toBeNull();

    expect(
      await flows.forkCatalogAsset(makeForkClient({}), { assetId: "  " }),
    ).toBeNull();
    expect(baseline()).toBe(before);
  });

  test("fork mirrors an RPC-created install under the same id (10c)", async () => {
    const { asset, version } = catalog.createCatalogAsset({
      name: "Shared",
      type: catalog.CATALOG_TYPES.screen,
      spec: makeSpec("v1"),
    })!;
    // The project has NO install for the asset — the RPC creates one.
    expect(catalog.getCatalogInstalls()).toHaveLength(0);

    const serverInstallId = "f0000000-0000-4000-8000-000000000009";
    const forkedId = "f0000000-0000-4000-8000-000000000008";
    const client = makeForkClient({
      data: {
        uis_id: forkedId,
        version_id: version.id,
        install_id: serverInstallId,
        membership_swapped: false,
        uis_row: forkUisRow(forkedId),
      },
    });

    const result = await flows.forkCatalogAsset(client, {
      assetId: asset.id,
      projectId: PROJECT,
    });

    expect(result?.installId).toBe(serverInstallId);
    // Local mirror under the SAME id — both stores agree before the next pull.
    const install = catalog
      .getCatalogInstalls()
      .find((row) => row.id === serverInstallId);
    expect(install).toBeDefined();
    expect(install!.projectId).toBe(PROJECT);
    expect(install!.versionId).toBe(version.id);
    expect(install!.targetUiId).toBe(forkedId);
    expect(install!.targetKey).toBeNull(); // cleared with the swap (10a)
  });

  test("update swaps the WHOLE spec when target_key was cleared (10a)", () => {
    const { asset, version } = catalog.createCatalogAsset({
      name: "Card",
      type: catalog.CATALOG_TYPES.component,
      spec: makeComponentSpec("v1"),
    })!;
    const v2 = catalog.publishCatalogVersion(
      asset.id,
      makeComponentSpec("v2"),
    )!;
    // A forked copy: the install points at a STANDALONE ui row with
    // target_key cleared — the target IS the working copy.
    const copy = history.createEntry(
      "Working copy",
      makeSpec("draft"),
      PROJECT,
    );
    history.addEntry(copy);
    const install = catalog.addCatalogInstall({
      projectId: PROJECT,
      assetId: asset.id,
      versionId: version.id,
      targetUiId: copy.id,
      targetKey: null,
    })!;

    const result = flows.updateCatalogInstall(install.id, v2.id);
    expect(result?.applied).toBe(true);
    const updated = history.getHistory().find((row) => row.id === copy.id)!;
    // Whole-spec swap, NOT a re-expansion inside the copy.
    expect(updated.spec).toEqual(makeComponentSpec("v2"));
    expect(updated.revisions.at(-1)?.label).toBe("catalog:v2");
  });

  test("publish-update takes the working copy's current spec (screen)", () => {
    const { asset, version } = catalog.createCatalogAsset({
      name: "Detail",
      type: catalog.CATALOG_TYPES.screen,
      spec: makeSpec("v1"),
    })!;
    const installed = flows.installScreenAsset({
      asset,
      version,
      projectId: PROJECT,
    })!;
    const edited = {
      root: "root",
      elements: { root: { type: "Card", props: { title: "edited" } } },
    };
    history.replaceEntrySpec(installed.entry.id, edited, "edit");

    const published = flows.publishCatalogInstallUpdate(
      installed.install.id,
      "",
    );
    expect(published).not.toBeNull();
    expect(published!.version).toBe(2);
    // The version snapshots the copy's CURRENT spec, not the pinned v1.
    expect(published!.spec).toEqual(edited);
    expect(catalog.getAssetVersions(asset.id)).toHaveLength(2);
    expect(
      catalog.getCatalogAssets().find((row) => row.id === asset.id)
        ?.latestVersionId,
    ).toBe(published!.id);

    // Missing install / missing copy: null, nothing written.
    expect(flows.publishCatalogInstallUpdate("ghost", "")).toBeNull();
    const orphan = catalog.addCatalogInstall({
      projectId: PROJECT,
      assetId: asset.id,
      versionId: version.id,
      targetUiId: null,
    })!;
    expect(flows.publishCatalogInstallUpdate(orphan.id, "")).toBeNull();
  });

  test("publish-update extracts the subtree and refuses foreign assets", () => {
    const { asset, version } = catalog.createCatalogAsset({
      name: "Badge",
      type: catalog.CATALOG_TYPES.component,
      spec: makeComponentSpec("v1"),
    })!;
    const host = history.createEntry("Host", makeHostSpec(), PROJECT);
    history.addEntry(host);
    const install = catalog.addCatalogInstall({
      projectId: PROJECT,
      assetId: asset.id,
      versionId: version.id,
      targetUiId: host.id,
      targetKey: "card-1",
    })!;

    const published = flows.publishCatalogInstallUpdate(install.id, "");
    expect(published).not.toBeNull();
    // The EXPANDED SUBTREE only — never the whole host spec.
    expect(published!.spec.root).toBe("card-1");
    expect(Object.keys(published!.spec.elements)).toEqual(["card-1"]);

    // Decision 11 guard: a browse-adopted FOREIGN asset publishes only
    // under its owner's session (else the F2 insert policy refuses the
    // push — an offline loop).
    catalog.applyRemoteCatalogAsset({ ...asset, ownerId: "other-user" });
    expect(flows.publishCatalogInstallUpdate(install.id, "me")).toBeNull();
    expect(
      flows.publishCatalogInstallUpdate(install.id, "other-user"),
    ).not.toBeNull();
  });

  test("asset update moves every copy in the project and leaves other projects alone", () => {
    const OTHER_PROJECT = "99999999-8888-4777-8666-555555555555";
    const { asset, version } = catalog.createCatalogAsset({
      name: "Badge",
      type: catalog.CATALOG_TYPES.component,
      spec: makeComponentSpec("v1"),
    })!;

    // Three screens share one component — the 070 navbar shape.
    const copies = [0, 1, 2].map((index) => {
      const host = history.createEntry(
        `Host ${index}`,
        makeHostSpec(),
        PROJECT,
      );
      history.addEntry(host);
      const inserted = flows.insertCatalogComponent(host.spec, {
        parentKey: "root",
        asset,
        version,
        hostUiId: host.id,
        projectId: PROJECT,
      })!;
      history.replaceEntrySpec(
        host.id,
        inserted.spec,
        `structure:insert:${index}`,
      );
      return inserted.install;
    });

    // A second project holds the same component and must NOT move.
    const outsideHost = history.createEntry(
      "Outside host",
      makeHostSpec(),
      OTHER_PROJECT,
    );
    history.addEntry(outsideHost);
    const outside = flows.insertCatalogComponent(outsideHost.spec, {
      parentKey: "root",
      asset,
      version,
      hostUiId: outsideHost.id,
      projectId: OTHER_PROJECT,
    })!;
    history.replaceEntrySpec(
      outsideHost.id,
      outside.spec,
      "structure:insert:x",
    );

    const v2 = catalog.publishCatalogVersion(
      asset.id,
      makeComponentSpec("v2"),
    )!;

    const result = flows.updateCatalogAssetInstalls(asset.id, PROJECT)!;
    expect(result.updates).toHaveLength(copies.length);
    expect(result.unchanged).toBe(0);
    for (const update of result.updates) {
      expect(update.install.versionId).toBe(v2.id);
      expect(update.applied).toBe(true);
    }
    const inProject = catalog
      .getCatalogInstalls()
      .filter((row) => row.assetId === asset.id && row.projectId === PROJECT);
    expect(inProject).toHaveLength(copies.length);
    expect(inProject.every((row) => row.versionId === v2.id)).toBe(true);

    const stillOutside = catalog
      .getCatalogInstalls()
      .find((row) => row.id === outside.install.id)!;
    expect(stillOutside.versionId).toBe(version.id);

    // Idempotence: a second run moves nothing, all copies already current.
    const again = flows.updateCatalogAssetInstalls(asset.id, PROJECT)!;
    expect(again.updates).toHaveLength(0);
    expect(again.unchanged).toBe(copies.length);
  });

  test("asset update re-pins a deleted host and rejects unknown ids", () => {
    const { asset, version } = catalog.createCatalogAsset({
      name: "Badge",
      type: catalog.CATALOG_TYPES.component,
      spec: makeComponentSpec("v1"),
    })!;
    const host = history.createEntry("Host", makeHostSpec(), PROJECT);
    history.addEntry(host);
    const install = catalog.addCatalogInstall({
      projectId: PROJECT,
      assetId: asset.id,
      versionId: version.id,
      targetUiId: host.id,
      targetKey: "card-1",
    })!;
    const v2 = catalog.publishCatalogVersion(
      asset.id,
      makeComponentSpec("v2"),
    )!;

    // The copy is gone, the pin still moves (066's documented contract).
    history.removeEntry(host.id);
    const result = flows.updateCatalogAssetInstalls(asset.id, PROJECT)!;
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0].applied).toBe(false);
    expect(result.updates[0].install.id).toBe(install.id);
    expect(result.updates[0].install.versionId).toBe(v2.id);

    expect(flows.updateCatalogAssetInstalls("ghost", PROJECT)).toBeNull();
    expect(flows.updateCatalogAssetInstalls(asset.id, "")).toBeNull();
    expect(
      flows.updateCatalogAssetInstalls(asset.id, "no-such-project"),
    ).toBeNull();
    expect(
      flows.updateCatalogAssetInstalls(asset.id, PROJECT, "ghost"),
    ).toBeNull();
  });
});
