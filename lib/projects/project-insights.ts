/**
 * Read-only project insights for the workspace panel (plan 073, P6): the
 * union of data sources declared across a project's screens (the publish
 * dialog's configured/missing distinction) and the project's catalog
 * installs with their pinned → latest versions (071's update flow).
 *
 * Both are PURE builders over the stores' snapshots — the panel subscribes
 * and passes rows in, so nothing here mutates or caches. No new store.
 */
import type { Spec } from "@json-render/core";
import type {
  CatalogAsset,
  CatalogAssetVersion,
  CatalogInstall,
} from "@/lib/catalog/catalog";
import {
  DATA_SOURCE_PROVIDERS,
  dataSourceDefSchema,
  queryDefSchema,
  resourceDefSchema,
  withDataBlocks,
} from "@/lib/data-sources/types";

/** `config.auth` — the server-keyed lane's ref (plan 050, 067 gate). */
const API_AUTH_CONFIG_KEY = "auth";
const UNKNOWN_PROVIDER = "unknown";
const KEY_SEPARATOR = "\u0000";

/** One declared data source, deduped across every screen that uses it. */
export interface ProjectSourceRow {
  /** Name + provider + config identity — the dedupe key. */
  key: string;
  name: string;
  provider: string;
  /** Collections (resources) and reads (queries) this source serves. */
  collections: string[];
  queries: string[];
  /** Screens whose specs declare it (their display names). */
  screens: string[];
  /**
   * An `api` source with no `config.auth.ref` can only read inside the
   * author's own session — a project screen loads for visitors who have
   * none of those credentials (067 Task 4a), so the publish dialog blocks
   * it. Surfaced here with the same meaning.
   */
  needsConfig: boolean;
}

interface ScreenSpec {
  name: string;
  spec: Spec;
}

function stableConfig(value: unknown): string {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return JSON.stringify(value) ?? "null";
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([a], [b]) => a.localeCompare(b),
  );
  return `{${entries.map(([k, v]) => `${k}:${stableConfig(v)}`).join(",")}}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Union of `dataSources` across the project's screens. Two screens using
 * the same declaration collapse into one row that lists both; the same name
 * with a different provider or config stays a separate row (a real conflict
 * the user should see, not something to silently merge).
 */
export function projectSources(
  screens: readonly ScreenSpec[],
): ProjectSourceRow[] {
  const rows = new Map<string, ProjectSourceRow>();

  for (const screen of screens) {
    const { dataSources, resources, queries } = withDataBlocks(screen.spec);
    if (!isPlainObject(dataSources)) continue;

    // Resource → source name, and query → resource, both scoped per screen
    // (the blocks live inside that screen's spec).
    const resourceSource = new Map<string, string>();
    const resourceCollection = new Map<string, string>();
    if (isPlainObject(resources)) {
      for (const [name, def] of Object.entries(resources)) {
        const parsed = resourceDefSchema.safeParse(def);
        if (!parsed.success) continue;
        resourceSource.set(name, parsed.data.dataSource);
        resourceCollection.set(name, parsed.data.collection ?? name);
      }
    }
    const queryResource = new Map<string, string>();
    if (isPlainObject(queries)) {
      for (const [name, def] of Object.entries(queries)) {
        const parsed = queryDefSchema.safeParse(def);
        if (!parsed.success) continue;
        queryResource.set(name, parsed.data.resource);
      }
    }

    for (const [name, raw] of Object.entries(dataSources)) {
      const parsed = dataSourceDefSchema.safeParse(raw);
      const provider = parsed.success ? parsed.data.provider : UNKNOWN_PROVIDER;
      const config = parsed.success ? (parsed.data.config ?? {}) : {};
      const key = `${name}${KEY_SEPARATOR}${provider}${KEY_SEPARATOR}${stableConfig(config)}`;
      const needsConfig =
        provider === DATA_SOURCE_PROVIDERS.api &&
        !isPlainObject(config[API_AUTH_CONFIG_KEY]);

      let row = rows.get(key);
      if (!row) {
        row = {
          key,
          name,
          provider,
          collections: [],
          queries: [],
          screens: [],
          needsConfig,
        };
        rows.set(key, row);
      }
      if (!row.screens.includes(screen.name)) row.screens.push(screen.name);

      for (const [resourceName, sourceName] of resourceSource) {
        if (sourceName !== name) continue;
        const collection = resourceCollection.get(resourceName) ?? resourceName;
        if (!row.collections.includes(collection)) {
          row.collections.push(collection);
        }
      }
      for (const [queryName, resourceName] of queryResource) {
        if (resourceSource.get(resourceName) !== name) continue;
        if (!row.queries.includes(queryName)) row.queries.push(queryName);
      }
    }
  }

  // The key tie-break keeps same-name/same-provider rows deterministic.
  return [...rows.values()].sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      a.provider.localeCompare(b.provider) ||
      a.key.localeCompare(b.key),
  );
}

/** One catalog asset installed into the project, with its copy count. */
export interface ProjectComponentRow {
  assetId: string;
  name: string;
  type: string;
  /** How many expanded copies live in the project (070 installs N). */
  copies: number;
  /** The LOWEST pinned version — what an update would move (071). */
  installedVersion: number;
  latestVersion: number;
  /** Every copy is already on the latest version. */
  upToDate: boolean;
}

/**
 * The project's catalog installs grouped per asset (071's "one row speaks
 * for every copy in the project"): copies count, lowest pinned version vs
 * the asset's latest, and whether anything is behind.
 */
export function projectComponentRows({
  projectId,
  installs,
  assets,
  versions,
}: {
  projectId: string;
  installs: readonly CatalogInstall[];
  assets: readonly CatalogAsset[];
  versions: readonly CatalogAssetVersion[];
}): ProjectComponentRow[] {
  if (projectId === "") return [];
  const versionNumber = new Map(versions.map((row) => [row.id, row.version]));
  const groups = new Map<string, CatalogInstall[]>();
  for (const install of installs) {
    if (install.projectId !== projectId) continue;
    const list = groups.get(install.assetId);
    if (list) list.push(install);
    else groups.set(install.assetId, [install]);
  }

  const rows: ProjectComponentRow[] = [];
  for (const [assetId, copies] of groups) {
    const asset = assets.find((row) => row.id === assetId);
    if (!asset) continue; // an inventory entry with no asset cannot render
    const pins = copies
      .map((copy) => versionNumber.get(copy.versionId) ?? null)
      .filter((value): value is number => value !== null);
    const latestVersion = asset.latestVersionId
      ? (versionNumber.get(asset.latestVersionId) ?? null)
      : null;
    const installedVersion =
      pins.length > 0 ? Math.min(...pins) : (latestVersion ?? 1);
    const latest = latestVersion ?? installedVersion;
    rows.push({
      assetId,
      name: asset.name,
      type: asset.type,
      copies: copies.length,
      installedVersion,
      latestVersion: latest,
      upToDate:
        asset.latestVersionId === null ||
        copies.every((copy) => copy.versionId === asset.latestVersionId),
    });
  }

  return rows.sort((a, b) => a.name.localeCompare(b.name));
}
