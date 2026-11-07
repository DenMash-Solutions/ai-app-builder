/**
 * Project template installer (plan 073, decision 5): a PURE module over the
 * existing stores — one deterministic run creates a template's screens,
 * memberships, routes and home, then expands every slot mapping through the
 * picker's own seam (`insertCatalogComponent`), so 071's update/rollback
 * fan-out works on template-installed copies exactly like hand-installed
 * ones.
 *
 * Nothing is validated lazily: the asset, its manifest, the target project
 * and EVERY referenced component resolve before the first write, and a
 * failure mid-run returns the step that failed (a partial project is the
 * documented recovery state — the preview banner's Discard, or a normal
 * project deletion, cleans it up).
 *
 * Idempotence: a screen whose name AND route already exist in the project is
 * skipped rather than duplicated, so re-running into the same project adds
 * only what is missing.
 */
import type { Spec } from "@json-render/core";
import {
  CATALOG_TYPES,
  getCatalogAssets,
  getCatalogVersions,
  isSpecPayload,
  type CatalogAsset,
  type CatalogAssetVersion,
} from "@/lib/catalog/catalog";
import type { ProjectManifest } from "@/lib/catalog/manifest";
import { isProjectManifest } from "@/lib/catalog/manifest";
import { insertCatalogComponent } from "@/lib/catalog/install";
import {
  addEntry,
  createEntry,
  getHistory,
  REVISION_LABELS,
  replaceEntrySpec,
} from "@/lib/history";
import type { HistoryEntry } from "@/lib/history";
import { getProjects, setProjectHomeScreenId } from "@/lib/projects/projects";
import {
  addScreenToProject,
  getMembership,
  getProjectMemberships,
  setMembershipRoute,
} from "@/lib/projects/memberships";

/** Steps a failed run can report — the UI maps these to copy. */
export const PROJECT_INSTALL_STEPS = {
  asset: "asset",
  version: "version",
  manifest: "manifest",
  project: "project",
  component: "component",
  screen: "screen",
  route: "route",
  slot: "slot",
  home: "home",
} as const;

export type ProjectInstallStep =
  (typeof PROJECT_INSTALL_STEPS)[keyof typeof PROJECT_INSTALL_STEPS];

export interface InstalledScreen {
  /** The `uis` row the template created for this screen. */
  screenId: string;
  name: string;
  route: string | null;
}

export interface ProjectInstallResult {
  ok: boolean;
  projectId: string;
  screens: InstalledScreen[];
  /** Component expansions written (one install row each). */
  installs: number;
  /** Manifest screens skipped because the project already held them. */
  skipped: number;
  /** The step that failed — `null` on success. */
  failedStep: ProjectInstallStep | null;
}

/** Normalized route for comparison — the membership store's stored shape. */
function normalizeRoute(route: string | null): string | null {
  if (route === null) return null;
  const trimmed = route
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .trim();
  return trimmed === "" ? null : trimmed;
}

function findComponent(
  id: string,
): { asset: CatalogAsset; version: CatalogAssetVersion } | null {
  const asset = getCatalogAssets().find(
    (row) => row.id === id && row.type === CATALOG_TYPES.component,
  );
  if (!asset?.latestVersionId) return null;
  const version = getCatalogVersions().find(
    (row) => row.id === asset.latestVersionId && row.assetId === asset.id,
  );
  if (!version || !isSpecPayload(version.spec)) return null;
  return { asset, version };
}

/**
 * Installs `assetId`'s latest manifest into `projectId`. Returns `ok: false`
 * with the failing step and NO further writes from that point; callers treat
 * a partial project as recoverable (Discard / delete).
 */
export function installProjectTemplate(request: {
  projectId: string;
  assetId: string;
}): ProjectInstallResult {
  const { projectId, assetId } = request;
  const result: ProjectInstallResult = {
    ok: false,
    projectId,
    screens: [],
    installs: 0,
    skipped: 0,
    failedStep: null,
  };
  const fail = (step: ProjectInstallStep): ProjectInstallResult => ({
    ...result,
    failedStep: step,
  });

  const project = getProjects().find((row) => row.id === projectId);
  if (!project) return fail(PROJECT_INSTALL_STEPS.project);

  const asset = getCatalogAssets().find((row) => row.id === assetId);
  if (!asset || asset.type !== CATALOG_TYPES.project) {
    return fail(PROJECT_INSTALL_STEPS.asset);
  }
  const version = asset.latestVersionId
    ? getCatalogVersions().find(
        (row) => row.id === asset.latestVersionId && row.assetId === asset.id,
      )
    : undefined;
  if (!version) return fail(PROJECT_INSTALL_STEPS.version);
  if (!isProjectManifest(version.spec)) {
    return fail(PROJECT_INSTALL_STEPS.manifest);
  }
  const manifest: ProjectManifest = version.spec;

  // Validate EVERY referenced component before the first write, so an
  // unknown id cannot leave half a project behind.
  const components = new Map<
    string,
    { asset: CatalogAsset; version: CatalogAssetVersion }
  >();
  for (const componentId of manifest.components) {
    const found = findComponent(componentId);
    if (!found) return fail(PROJECT_INSTALL_STEPS.component);
    components.set(componentId, found);
  }

  // Existing screens of this project — the idempotence baseline.
  const existing = getProjectMemberships(projectId).map((membership) => {
    const entry = getHistory().find((row) => row.id === membership.screenId);
    return { name: entry?.name ?? "", route: membership.route };
  });

  const created: Array<{
    screen: ProjectManifest["screens"][number];
    entry: HistoryEntry;
  }> = [];
  for (const screen of manifest.screens) {
    const route = normalizeRoute(screen.route);
    const held = existing.some(
      (row) =>
        row.name.toLowerCase() === screen.name.toLowerCase() &&
        row.route === route,
    );
    if (held) {
      result.skipped += 1;
      continue;
    }
    const entry = createEntry(
      screen.name,
      structuredClone(screen.spec),
      projectId,
    );
    addEntry(entry);
    // The membership store heals itself off history commits, so the row for
    // a just-added entry may already exist (route-less) before this call —
    // the `copyScreenToProject` discipline: an unexplained null is the
    // failure, a held row is ours to configure.
    if (
      addScreenToProject(projectId, entry.id, route) === null &&
      getMembership(projectId, entry.id) === null
    ) {
      return fail(PROJECT_INSTALL_STEPS.route);
    }
    if (
      route !== null &&
      getMembership(projectId, entry.id)?.route !== route &&
      !setMembershipRoute(projectId, entry.id, route)
    ) {
      return fail(PROJECT_INSTALL_STEPS.route);
    }
    created.push({ screen, entry });
    result.screens.push({ screenId: entry.id, name: screen.name, route });
  }

  // Home: the manifest's explicit flag, else the first screen it declares.
  // A FRESH install (every screen created now) takes the manifest's home
  // even though the membership store's first-member fill already picked one;
  // an install into a project that already has screens only fills an empty
  // home (065's explicit-home contract).
  const homeScreen =
    manifest.screens.find((screen) => screen.home === true) ??
    manifest.screens[0];
  const freshInstall = created.length === manifest.screens.length;
  const currentHome =
    getProjects().find((row) => row.id === projectId)?.homeScreenId ?? null;
  if (homeScreen && (freshInstall || currentHome === null)) {
    const homeEntry = created.find((row) => row.screen === homeScreen)?.entry;
    if (homeEntry) {
      setProjectHomeScreenId(projectId, homeEntry.id);
    } else {
      // The home screen was skipped (already installed): resolve its row.
      const held = getProjectMemberships(projectId).find((membership) => {
        const entry = getHistory().find(
          (row) => row.id === membership.screenId,
        );
        return (
          entry?.name.toLowerCase() === homeScreen.name.toLowerCase() &&
          membership.route === normalizeRoute(homeScreen.route)
        );
      });
      if (!held) return fail(PROJECT_INSTALL_STEPS.home);
      setProjectHomeScreenId(projectId, held.screenId);
    }
  }

  // Slot expansion — the picker's own seam (fresh keys + provenance +
  // install row with the real host and root target).
  for (const { screen, entry } of created) {
    let spec: Spec = entry.spec;
    for (const [slotKey, componentId] of Object.entries(screen.slots ?? {})) {
      const component = components.get(componentId);
      if (!component) return fail(PROJECT_INSTALL_STEPS.component);
      const inserted = insertCatalogComponent(spec, {
        parentKey: slotKey,
        asset: component.asset,
        version: component.version,
        hostUiId: entry.id,
        projectId,
      });
      if (!inserted) return fail(PROJECT_INSTALL_STEPS.slot);
      spec = inserted.spec;
      result.installs += 1;
    }
    if (spec !== entry.spec) {
      if (!replaceEntrySpec(entry.id, spec, REVISION_LABELS.catalog)) {
        return fail(PROJECT_INSTALL_STEPS.slot);
      }
    }
  }

  return { ...result, ok: true };
}
