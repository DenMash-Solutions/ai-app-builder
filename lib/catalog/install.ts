/**
 * Install / update / fork flows for the UI catalog (plan 066 Task 3) —
 * decision 1's version-pinned SNAPSHOT semantics, all client-side except
 * the fork itself:
 *
 * - Screen install = new `uis` row (revision 0) + `project_screens`
 *   membership in the active project (decision 8) + a `catalog_installs`
 *   row pinning the version.
 * - Component install = expansion at insert time through playground's
 *   structure path (decision 2: fresh keys + `data-template-id`
 *   provenance) with the install row recording host ui + expanded root.
 * - Update/rollback = one explicit pin re-point (`updateCatalogInstallPin`)
 *   plus a best-effort content swap into the materialized copy: screens
 *   swap their spec through the revision stack, components re-expand at the
 *   old root's position. Confirmation UI ships with the Task 4 catalog tab
 *   (scope split recorded 2026-11-02) — this module is the logic only.
 * - Fork-on-edit (decision 4) runs in ONE database transaction via the
 *   `fork_catalog_asset` RPC: read version → create copy → initial
 *   revision → swap reference. The client only mirrors the result locally
 *   (install target + membership), so a partial client-side migration is
 *   impossible — the rejected alternative in decision 4.
 */

import type { Spec } from "@json-render/core";
import {
  addCatalogInstall,
  CATALOG_TYPES,
  getCatalogAssets,
  getCatalogInstalls,
  getCatalogVersions,
  setCatalogInstallTarget,
  updateCatalogInstallPin,
} from "@/lib/catalog/catalog";
import type {
  CatalogAsset,
  CatalogAssetVersion,
  CatalogInstall,
} from "@/lib/catalog/catalog";
import {
  childIndexOf,
  findParentKey,
  insertTemplate,
  removeElement,
} from "@/lib/editor/structure";
import {
  addEntry,
  applyRemoteEntry,
  createEntry,
  getHistory,
  REVISION_LABELS,
  replaceEntrySpec,
} from "@/lib/history/history";
import type { HistoryEntry } from "@/lib/history/history";
import { rowToEntry } from "@/lib/history/sync";
import { addScreenToProject } from "@/lib/projects/memberships";

/** Version-scoped label for catalog-driven content swaps — its own
 *  `REVISION_LABELS.catalog` namespace (structure edits keep their own). */
function catalogRevisionLabel(version: CatalogAssetVersion): string {
  return `${REVISION_LABELS.catalog}:v${version.version}`;
}

function isUsableAsset(asset: CatalogAsset | undefined): asset is CatalogAsset {
  return asset !== undefined;
}

/**
 * Installs a SCREEN asset: the version's spec becomes a brand-new `uis`
 * row at revision 0 (snapshot copy — never linked), the row joins the
 * active project's drawer via 065's membership store (decision 8: first
 * member also seeds an empty home), and the install pins `version`.
 * Returns `null` for a type mismatch, a version of another asset, an empty
 * project, or rows missing from the local store (nothing is written in
 * that case — validation happens before the first mutation).
 */
export function installScreenAsset(request: {
  asset: CatalogAsset;
  version: CatalogAssetVersion;
  projectId: string;
}): { entry: HistoryEntry; install: CatalogInstall } | null {
  const { asset, version, projectId } = request;
  if (asset.type !== CATALOG_TYPES.screen) return null;
  if (projectId.trim() === "") return null;
  // Validate against the STORE (not the caller's object): addCatalogInstall
  // re-checks the same rows, so a pass here makes the pin infallible.
  if (!isUsableAsset(getCatalogAssets().find((row) => row.id === asset.id))) {
    return null;
  }
  const stored = getCatalogVersions().find(
    (row) => row.id === version.id && row.assetId === asset.id,
  );
  if (!stored) return null;

  const entry = createEntry(asset.name, stored.spec, projectId);
  addEntry(entry);
  addScreenToProject(projectId, entry.id);
  const install = addCatalogInstall({
    projectId,
    assetId: asset.id,
    versionId: stored.id,
    targetUiId: entry.id,
    targetKey: null,
  });
  if (!install) return null; // unreachable after validation — defensive
  return { entry, install };
}

/**
 * Expands a COMPONENT asset into `spec` under `parentKey` and records the
 * install against the host ui (decision 2 + 062 decision 3): fresh keys
 * via `insertTemplate`, `data-template-id` stamped with the ASSET id, pin
 * on the given version. The expansion is pure — the caller commits the
 * returned spec as a revision (playground's structure path), so a `null`
 * return leaves the caller's spec untouched.
 */
export function insertCatalogComponent(
  spec: Spec,
  request: {
    parentKey: string;
    asset: CatalogAsset;
    version: CatalogAssetVersion;
    hostUiId: string;
    projectId: string;
  },
): { spec: Spec; key: string; install: CatalogInstall } | null {
  const { parentKey, asset, version, hostUiId, projectId } = request;
  if (asset.type !== CATALOG_TYPES.component) return null;
  if (projectId.trim() === "" || hostUiId.trim() === "") return null;
  if (!isUsableAsset(getCatalogAssets().find((row) => row.id === asset.id))) {
    return null;
  }
  const stored = getCatalogVersions().find(
    (row) => row.id === version.id && row.assetId === asset.id,
  );
  if (!stored) return null;

  const expanded = insertTemplate(spec, {
    parentKey,
    subtree: { rootKey: stored.spec.root, elements: stored.spec.elements },
    templateId: asset.id,
  });
  if (!expanded) return null; // parent missing — nothing written

  const install = addCatalogInstall({
    projectId,
    assetId: asset.id,
    versionId: stored.id,
    targetUiId: hostUiId,
    targetKey: expanded.key,
  });
  if (!install) return null; // unreachable after validation — defensive
  return { spec: expanded.spec, key: expanded.key, install };
}

export interface InstallStatus {
  /** The pinned version — only the explicit update flow re-points it. */
  installedVersionId: string;
  /** The asset's current latest, or `null` when it has none. */
  latestVersionId: string | null;
  /** `true` when there is nothing newer to update to. */
  upToDate: boolean;
}

/**
 * Installed-vs-latest comparison for the update affordance (Task 4 renders
 * it). An asset without a latest pointer reads as up to date — there is
 * nothing the flow could move to.
 */
export function getInstallStatus(install: CatalogInstall): InstallStatus {
  const asset = getCatalogAssets().find((row) => row.id === install.assetId);
  const latestVersionId = asset?.latestVersionId ?? null;
  return {
    installedVersionId: install.versionId,
    latestVersionId,
    upToDate: latestVersionId === null || latestVersionId === install.versionId,
  };
}

export interface UpdateInstallResult {
  install: CatalogInstall;
  /** Whether the materialized copy's content was swapped — `false` when
   *  the copy no longer exists (deleted by the user): the pin still
   *  re-points, nothing else to write. */
  applied: boolean;
}

/**
 * Explicit update/rollback (installs never change on their own): re-points
 * the pin to `toVersionId` — defaults to the asset's latest, and an older
 * version IS the rollback path — then best-effort swaps the materialized
 * copy's content to that version (screens: full spec through the revision
 * stack, undoable; components: re-expansion at the old root's position
 * with fresh keys + provenance). `null` = nothing to do (unknown ids, a
 * version of another asset, or the pin already there — idempotent).
 */
export function updateCatalogInstall(
  installId: string,
  toVersionId?: string,
): UpdateInstallResult | null {
  const install = getCatalogInstalls().find((row) => row.id === installId);
  if (!install) return null;
  const asset = getCatalogAssets().find((row) => row.id === install.assetId);
  if (!asset) return null;
  const versionId = toVersionId ?? asset.latestVersionId;
  if (!versionId) return null;
  const version = getCatalogVersions().find(
    (row) => row.id === versionId && row.assetId === install.assetId,
  );
  if (!version) return null;
  if (version.id === install.versionId) return null; // already pinned here

  if (!updateCatalogInstallPin(install.id, version.id)) return null; // validated above
  const applied = swapInstallContent(install, asset, version);
  const updated = getCatalogInstalls().find((row) => row.id === installId);
  return updated ? { install: updated, applied } : null;
}

/** Content swap into the materialized copy — best-effort by design (the
 *  pin is the source of truth; a deleted copy is a legitimate state). */
function swapInstallContent(
  install: CatalogInstall,
  asset: CatalogAsset,
  version: CatalogAssetVersion,
): boolean {
  if (!install.targetUiId) return false;
  const host = getHistory().find((entry) => entry.id === install.targetUiId);
  if (!host) return false;
  const label = catalogRevisionLabel(version);

  if (asset.type === CATALOG_TYPES.screen) {
    // The target IS the installed screen: swap its whole spec through the
    // revision stack (append — the previous version stays undoable).
    return replaceEntrySpec(host.id, version.spec, label) !== null;
  }

  // Component: re-expand at the old root's position. The subtree root must
  // still exist and have a parent (a removed component or a screen whose
  // root WAS the component cannot be swapped in place — pin only).
  const rootKey = install.targetKey;
  if (!rootKey) return false;
  const parentKey = findParentKey(host.spec, rootKey);
  if (parentKey === null) return false;
  const index = childIndexOf(host.spec, rootKey);
  const removed = removeElement(host.spec, rootKey);
  if (!removed) return false;
  const expanded = insertTemplate(removed, {
    parentKey,
    subtree: { rootKey: version.spec.root, elements: version.spec.elements },
    templateId: asset.id,
    index,
  });
  if (!expanded) return false;
  return replaceEntrySpec(host.id, expanded.spec, label) !== null;
}

export interface ForkClient {
  /** The slice of the Supabase client the fork needs — mockable in tests
   *  (the `SyncClient` discipline from `lib/history/sync.ts`). */
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export interface ForkResult {
  /** The forked working copy — a fresh `uis` row at revision 0. */
  uisId: string;
  /** The version the copy was read from (requested, else the latest). */
  versionId: string;
  /** Install whose target the RPC swapped (`null` = no install in the
   *  project passed). */
  installId: string | null;
  /** Whether THIS client added the project membership after the call —
   *  `false` means the RPC swapped an existing row instead (or no project
   *  was passed). */
  membershipAdded: boolean;
}

interface ForkRpcRow {
  uis_id?: unknown;
  version_id?: unknown;
  install_id?: unknown;
  membership_swapped?: unknown;
  uis_row?: unknown;
}

/**
 * Fork-on-edit (decision 4): the database does copy + reference swap in
 * ONE transaction (`fork_catalog_asset`), so a partial migration is
 * impossible. This client only MIRRORS the outcome locally — the forked
 * entry (the RPC returns its full row, adopted like any remote row), the
 * install's swapped target, and — when the RPC had no membership row to
 * swap — the membership add through 065's store (position + home-fill
 * logic stays client-side where it already lives). `null` = the RPC
 * refused (asset not visible, not signed in, …) or returned junk; nothing
 * was written locally in that case.
 */
export async function forkCatalogAsset(
  client: ForkClient,
  request: {
    assetId: string;
    versionId?: string;
    projectId?: string;
  },
): Promise<ForkResult | null> {
  const { assetId, versionId, projectId } = request;
  if (assetId.trim() === "") return null;
  const { data, error } = await client.rpc("fork_catalog_asset", {
    p_asset_id: assetId,
    p_version_id: versionId ?? null,
    p_project_id: projectId ?? null,
  });
  if (error) return null;
  if (typeof data !== "object" || data === null) return null;
  const row = data as ForkRpcRow;
  if (typeof row.uis_id !== "string" || row.uis_id === "") return null;
  if (typeof row.version_id !== "string" || row.version_id === "") {
    return null;
  }
  const installId = typeof row.install_id === "string" ? row.install_id : null;
  const membershipSwapped = row.membership_swapped === true;

  // Adopt the created row immediately — the forked copy must be in the
  // local history before any membership/home logic runs against it (the
  // entries loop would pull the same row later; adoption is idempotent).
  if (typeof row.uis_row === "object" && row.uis_row !== null) {
    const entry = rowToEntry(row.uis_row as Parameters<typeof rowToEntry>[0]);
    if (entry.id === row.uis_id) applyRemoteEntry(entry);
  }

  if (installId) setCatalogInstallTarget(installId, row.uis_id);
  let membershipAdded = false;
  if (projectId && projectId.trim() !== "" && !membershipSwapped) {
    membershipAdded = addScreenToProject(projectId, row.uis_id) !== null;
  }

  return {
    uisId: row.uis_id,
    versionId: row.version_id,
    installId,
    membershipAdded,
  };
}
