/**
 * UI catalog (plan 066): versioned, installable assets — a screen or a
 * component published from the playground with public/private visibility.
 *
 * Local-first module store (the `lib/projects/projects.ts` discipline):
 * localStorage is the working copy; `lib/history/sync.ts` mirrors rows into
 * `catalog_assets` / `catalog_asset_versions` / `catalog_installs` under LWW
 * (decision 9). Versions are immutable (decision 3 — the DB trigger refuses
 * updates), so the store only ever APPENDS version rows: publish = new row
 * + `latestVersionId` bump; nothing rewrites an existing version. The sync
 * specs mark this table `immutableRows` for the same reason (strict `>`
 * compare, no delete pass — see `lib/history/sync.ts`).
 *
 * Component templates (plan 060) migrate here lazily and idempotently
 * (decision 5): a template's uuid BECOMES the asset id, so seeding the same
 * library twice can never duplicate; the separate `genui-catalog-seeded`
 * flag records that the one-time migration happened, so a template deleted
 * from the catalog is not resurrected on the next session. Seeding only
 * runs for a signed-in session (`startTemplateSeeding`, wired in
 * SyncEngine) — signed out the localStorage library keeps working untouched.
 *
 * One storage key holds all three collections so cross-entity operations
 * (delete asset → its versions + installs) land as one atomic write. No
 * cross-tab `storage` listener (065 memberships precedent — the sync loop
 * is the cross-device coherence path).
 */

import {
  getTemplates,
  setTemplateSavedListener,
  type ComponentTemplate,
} from "@/lib/editor/templates";
import type { Spec } from "@json-render/core";

export const CATALOG_STORAGE_KEY = "genui-catalog";
/** One-time template-library migration marker (decision 5) — a separate key
 *  so a reset (test or quota eviction of the rows) re-seeds cleanly. */
export const CATALOG_SEEDED_STORAGE_KEY = "genui-catalog-seeded";

export const CATALOG_TYPES = {
  screen: "screen",
  component: "component",
} as const;
export type CatalogAssetType =
  (typeof CATALOG_TYPES)[keyof typeof CATALOG_TYPES];

export const CATALOG_VISIBILITIES = {
  private: "private",
  public: "public",
} as const;
export type CatalogVisibility =
  (typeof CATALOG_VISIBILITIES)[keyof typeof CATALOG_VISIBILITIES];

export interface CatalogAsset {
  id: string;
  name: string;
  description: string | null;
  type: CatalogAssetType;
  /** Browse scope only (decision 6): an install copies, it never links, so
   *  flipping visibility never invalidates existing installations. */
  visibility: CatalogVisibility;
  /** `null` only for a corrupt/partial row — `create`/`publish` always set
   *  it; no FK by design (the asset and version tables sync as independent
   *  loops — Task 1 schema note). */
  latestVersionId: string | null;
  createdAt: number;
  /** Publish/metadata change — the LWW stamp the sync compares. */
  updatedAt: number;
}

export interface CatalogAssetVersion {
  id: string;
  assetId: string;
  /** Monotonic per asset, starting at 1 (`unique (asset_id, version)`). */
  version: number;
  spec: Spec;
  changelog: string | null;
  createdAt: number;
  /** Mirrors `createdAt` (rows never update) — the sync loop's shape. */
  updatedAt: number;
}

export interface CatalogInstall {
  id: string;
  /** The installing project (decision 8 wires membership separately). */
  projectId: string;
  assetId: string;
  /** Version pin: only the explicit update/rollback flow re-points this. */
  versionId: string;
  /** Materialized copy for screens (the new `uis` row); host ui for
   *  component expansions; `null` until the install flow creates it. */
  targetUiId: string | null;
  /** Expanded element key for components (null for screens). */
  targetKey: string | null;
  createdAt: number;
  /** Re-point/rollback stamp — installs never change on their own. */
  updatedAt: number;
}

interface CatalogState {
  assets: CatalogAsset[];
  versions: CatalogAssetVersion[];
  installs: CatalogInstall[];
}

const EMPTY: CatalogState = { assets: [], versions: [], installs: [] };

function isSpec(value: unknown): value is Spec {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Spec>;
  return (
    typeof candidate.root === "string" &&
    typeof candidate.elements === "object" &&
    candidate.elements !== null
  );
}

function nonEmptyId(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function isCatalogType(value: unknown): value is CatalogAssetType {
  return value === CATALOG_TYPES.screen || value === CATALOG_TYPES.component;
}

function asVisibility(value: unknown): CatalogVisibility {
  return value === CATALOG_VISIBILITIES.public
    ? CATALOG_VISIBILITIES.public
    : CATALOG_VISIBILITIES.private;
}

function asDescription(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function asOptionalId(value: unknown): string | null {
  return nonEmptyId(value) ? value : null;
}

function isValidAsset(value: unknown): value is CatalogAsset {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CatalogAsset>;
  return (
    nonEmptyId(candidate.id) &&
    typeof candidate.name === "string" &&
    candidate.name.trim() !== "" &&
    isCatalogType(candidate.type) &&
    typeof candidate.createdAt === "number"
  );
}

function isValidVersion(value: unknown): value is CatalogAssetVersion {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CatalogAssetVersion>;
  return (
    nonEmptyId(candidate.id) &&
    nonEmptyId(candidate.assetId) &&
    typeof candidate.version === "number" &&
    Number.isInteger(candidate.version) &&
    candidate.version >= 1 &&
    isSpec(candidate.spec) &&
    typeof candidate.createdAt === "number"
  );
}

function isValidInstall(value: unknown): value is CatalogInstall {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CatalogInstall>;
  return (
    nonEmptyId(candidate.id) &&
    nonEmptyId(candidate.projectId) &&
    nonEmptyId(candidate.assetId) &&
    nonEmptyId(candidate.versionId) &&
    typeof candidate.createdAt === "number"
  );
}

/** Drop junk, backfill the optional fields — the `sanitizeProjects`
 *  discipline, exported for the sync mappers (remote rows run through the
 *  same sanitizer as corrupt storage). */
export function sanitizeCatalogAssets(raw: unknown): CatalogAsset[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidAsset).map((stored) => ({
    id: stored.id,
    name: stored.name,
    description: asDescription(stored.description),
    type: stored.type,
    // Fail closed: a corrupt visibility reads as private, never public.
    visibility: asVisibility(stored.visibility),
    latestVersionId: asOptionalId(stored.latestVersionId),
    createdAt: stored.createdAt,
    updatedAt:
      typeof stored.updatedAt === "number"
        ? stored.updatedAt
        : stored.createdAt,
  }));
}

export function sanitizeCatalogVersions(raw: unknown): CatalogAssetVersion[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidVersion).map((stored) => ({
    id: stored.id,
    assetId: stored.assetId,
    version: stored.version,
    spec: stored.spec,
    changelog:
      typeof stored.changelog === "string" && stored.changelog.trim() !== ""
        ? stored.changelog
        : null,
    createdAt: stored.createdAt,
    updatedAt:
      typeof stored.updatedAt === "number"
        ? stored.updatedAt
        : stored.createdAt,
  }));
}

export function sanitizeCatalogInstalls(raw: unknown): CatalogInstall[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidInstall).map((stored) => ({
    id: stored.id,
    projectId: stored.projectId,
    assetId: stored.assetId,
    versionId: stored.versionId,
    targetUiId: asOptionalId(stored.targetUiId),
    targetKey: asOptionalId(stored.targetKey),
    createdAt: stored.createdAt,
    updatedAt:
      typeof stored.updatedAt === "number"
        ? stored.updatedAt
        : stored.createdAt,
  }));
}

function readStored(): CatalogState {
  try {
    const stored = window.localStorage.getItem(CATALOG_STORAGE_KEY);
    if (!stored) return EMPTY;
    const raw: unknown = JSON.parse(stored);
    if (typeof raw !== "object" || raw === null) return EMPTY;
    const candidate = raw as Partial<CatalogState>;
    return {
      assets: sanitizeCatalogAssets(candidate.assets),
      versions: sanitizeCatalogVersions(candidate.versions),
      installs: sanitizeCatalogInstalls(candidate.installs),
    };
  } catch {
    // Unreadable/corrupt value — fall back to an empty catalog.
    return EMPTY;
  }
}

const listeners = new Set<() => void>();

let cache: CatalogState | null = null;

function load(): CatalogState {
  if (cache === null) {
    cache = typeof window === "undefined" ? EMPTY : readStored();
  }
  return cache;
}

/** Client snapshot for `useSyncExternalStore`. */
export function getCatalogAssets(): CatalogAsset[] {
  return load().assets;
}

export function getCatalogVersions(): CatalogAssetVersion[] {
  return load().versions;
}

export function getCatalogInstalls(): CatalogInstall[] {
  return load().installs;
}

/** Server snapshot — the client re-renders with the stored catalog after hydration. */
export function getServerCatalog(): CatalogState {
  return EMPTY;
}

export function subscribeCatalog(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function persist(): void {
  try {
    window.localStorage.setItem(
      CATALOG_STORAGE_KEY,
      JSON.stringify(cache ?? EMPTY),
    );
  } catch {
    // Quota exceeded or storage unavailable — catalog stays for this session.
  }
  for (const listener of listeners) listener();
}

/** Detach a spec before it enters the store (the `saveTemplate` discipline:
 *  later edits to a source spec never touch a stored version). */
function cloneSpec(spec: Spec): Spec {
  return structuredClone(spec);
}

/** Versions of one asset, ascending — the publish/monotonicity view. */
export function getAssetVersions(assetId: string): CatalogAssetVersion[] {
  return load()
    .versions.filter((version) => version.assetId === assetId)
    .sort((a, b) => a.version - b.version);
}

/**
 * Creates an asset together with its version 1 (an asset without a version
 * is never useful — publish assumes both exist). Empty names and invalid
 * specs are rejected (`null`, no-op).
 */
export function createCatalogAsset(request: {
  name: string;
  description?: string | null;
  type: CatalogAssetType;
  visibility?: CatalogVisibility;
  spec: Spec;
}): { asset: CatalogAsset; version: CatalogAssetVersion } | null {
  const name = request.name.trim();
  if (name === "" || !isSpec(request.spec)) return null;
  if (
    request.type !== CATALOG_TYPES.screen &&
    request.type !== CATALOG_TYPES.component
  ) {
    return null;
  }
  const now = Date.now();
  const assetId = crypto.randomUUID();
  const version: CatalogAssetVersion = {
    id: crypto.randomUUID(),
    assetId,
    version: 1,
    spec: cloneSpec(request.spec),
    changelog: null,
    createdAt: now,
    updatedAt: now,
  };
  const asset: CatalogAsset = {
    id: assetId,
    name,
    description: asDescription(request.description),
    type: request.type,
    visibility: asVisibility(request.visibility),
    latestVersionId: version.id,
    createdAt: now,
    updatedAt: now,
  };
  const state = load();
  cache = {
    ...state,
    assets: [...state.assets, asset],
    versions: [...state.versions, version],
  };
  persist();
  return { asset, version };
}

/**
 * Metadata update (rename / description / visibility — Task 4's toggle).
 * Unchanged values and unknown ids are no-ops (`false` = nothing written);
 * a visibility flip only touches THIS row, never an installation.
 */
export function updateCatalogAsset(
  id: string,
  patch: {
    name?: string;
    description?: string | null;
    visibility?: CatalogVisibility;
  },
): boolean {
  const state = load();
  const index = state.assets.findIndex((asset) => asset.id === id);
  if (index === -1) return false;
  const current = state.assets[index];
  const name = patch.name !== undefined ? patch.name.trim() : current.name;
  if (name === "") return false;
  const description =
    patch.description !== undefined
      ? asDescription(patch.description)
      : current.description;
  const visibility =
    patch.visibility !== undefined
      ? asVisibility(patch.visibility)
      : current.visibility;
  if (
    name === current.name &&
    description === current.description &&
    visibility === current.visibility
  ) {
    return false;
  }
  cache = {
    ...state,
    assets: state.assets.map((asset, i) =>
      i === index
        ? { ...asset, name, description, visibility, updatedAt: Date.now() }
        : asset,
    ),
  };
  persist();
  return true;
}

/**
 * Removes an asset WITH its versions and installs in the same write — the
 * local mirror of the DB's `ON DELETE CASCADE` (the immutability trigger
 * only lets versions go with their asset anyway).
 */
export function removeCatalogAsset(id: string): boolean {
  const state = load();
  if (!state.assets.some((asset) => asset.id === id)) return false;
  cache = {
    assets: state.assets.filter((asset) => asset.id !== id),
    versions: state.versions.filter((version) => version.assetId !== id),
    installs: state.installs.filter((install) => install.assetId !== id),
  };
  persist();
  return true;
}

/**
 * Publishes the next version: the old versions stay untouched (decision 3),
 * the new row takes `max(existing) + 1` (monotonic across adopted remote
 * rows too), and the asset's `latestVersionId` + `updatedAt` bump so the
 * LWW push carries the pointer. Unknown assets and invalid specs are
 * rejected (`null`).
 */
export function publishCatalogVersion(
  assetId: string,
  spec: Spec,
  changelog?: string | null,
): CatalogAssetVersion | null {
  if (!isSpec(spec)) return null;
  const state = load();
  const asset = state.assets.find((candidate) => candidate.id === assetId);
  if (!asset) return null;
  const next =
    state.versions
      .filter((version) => version.assetId === assetId)
      .reduce((max, version) => Math.max(max, version.version), 0) + 1;
  const now = Date.now();
  const version: CatalogAssetVersion = {
    id: crypto.randomUUID(),
    assetId,
    version: next,
    spec: cloneSpec(spec),
    changelog:
      typeof changelog === "string" && changelog.trim() !== ""
        ? changelog.trim()
        : null,
    createdAt: now,
    updatedAt: now,
  };
  cache = {
    ...state,
    versions: [...state.versions, version],
    assets: state.assets.map((candidate) =>
      candidate.id === assetId
        ? { ...candidate, latestVersionId: version.id, updatedAt: now }
        : candidate,
    ),
  };
  persist();
  return version;
}

/**
 * Records an installation pinning `versionId`. Defense in depth mirroring
 * the RLS `WITH CHECK`: the version must exist AND belong to the asset —
 * installing from a mismatched pin is rejected (`null`).
 */
export function addCatalogInstall(request: {
  projectId: string;
  assetId: string;
  versionId: string;
  targetUiId?: string | null;
  targetKey?: string | null;
}): CatalogInstall | null {
  const { projectId, assetId, versionId } = request;
  if (projectId.trim() === "") return null;
  const state = load();
  if (!state.assets.some((asset) => asset.id === assetId)) return null;
  const pinned = state.versions.some(
    (version) => version.id === versionId && version.assetId === assetId,
  );
  if (!pinned) return null;
  const now = Date.now();
  const install: CatalogInstall = {
    id: crypto.randomUUID(),
    projectId,
    assetId,
    versionId,
    targetUiId: asOptionalId(request.targetUiId),
    targetKey: asOptionalId(request.targetKey),
    createdAt: now,
    updatedAt: now,
  };
  cache = { ...state, installs: [...state.installs, install] };
  persist();
  return install;
}

/** Removes an installation record (the materialized copy is the caller's to
 *  clean up). Unknown ids are a no-op. */
export function removeCatalogInstall(id: string): boolean {
  const state = load();
  if (!state.installs.some((install) => install.id === id)) return false;
  cache = {
    ...state,
    installs: state.installs.filter((install) => install.id !== id),
  };
  persist();
  return true;
}

/**
 * Re-points an install's version pin (Task 3 update/rollback — the ONLY
 * writer of `versionId` after creation; installs never change on their
 * own). The new pin must be a version OF THE ASSET (the RLS WITH CHECK
 * shape); unchanged pins and unknown ids are no-ops (`false`).
 */
export function updateCatalogInstallPin(
  id: string,
  versionId: string,
): boolean {
  const state = load();
  const index = state.installs.findIndex((install) => install.id === id);
  if (index === -1) return false;
  const current = state.installs[index];
  if (current.versionId === versionId) return false;
  const pinned = state.versions.some(
    (version) =>
      version.id === versionId && version.assetId === current.assetId,
  );
  if (!pinned) return false;
  cache = {
    ...state,
    installs: state.installs.map((install, i) =>
      i === index ? { ...install, versionId, updatedAt: Date.now() } : install,
    ),
  };
  persist();
  return true;
}

/**
 * Local mirror of the fork RPC's reference swap (decision 4): the DB row's
 * `target_ui_id` already points at the forked copy — apply the same here so
 * the session sees it before the next pull. Unknown ids are a no-op: an
 * install synced from another device simply arrives with the new target.
 */
export function setCatalogInstallTarget(
  id: string,
  targetUiId: string,
): boolean {
  if (targetUiId.trim() === "") return false;
  const state = load();
  const index = state.installs.findIndex((install) => install.id === id);
  if (index === -1) return false;
  const current = state.installs[index];
  if (current.targetUiId === targetUiId) return false;
  cache = {
    ...state,
    installs: state.installs.map((install, i) =>
      i === index ? { ...install, targetUiId, updatedAt: Date.now() } : install,
    ),
  };
  persist();
  return true;
}

/**
 * Insert-or-replace for the sync write path — the loop has already decided
 * LWW before calling (the `applyRemoteProject` discipline).
 */
export function applyRemoteCatalogAsset(remote: CatalogAsset): void {
  const state = load();
  const exists = state.assets.some((asset) => asset.id === remote.id);
  cache = {
    ...state,
    assets: exists
      ? state.assets.map((asset) => (asset.id === remote.id ? remote : asset))
      : [...state.assets, remote],
  };
  persist();
}

/**
 * Adoption for versions, with the collision sweep (below): a remote row
 * landing on an (asset, version) a LOCAL row of another id holds means the
 * local copy was never pushed (the server's unique constraint would have
 * refused both), so the local row yields — renumbered, never dropped.
 */
export function applyRemoteCatalogVersion(remote: CatalogAssetVersion): void {
  const state = load();
  const exists = state.versions.some((version) => version.id === remote.id);
  const merged = exists
    ? state.versions.map((version) =>
        version.id === remote.id ? remote : version,
      )
    : [...state.versions, remote];
  const { next } = sweepVersionCollisions(merged, []);
  cache = { ...state, versions: next };
  persist();
}

export function applyRemoteCatalogInstall(remote: CatalogInstall): void {
  const state = load();
  const exists = state.installs.some((install) => install.id === remote.id);
  cache = {
    ...state,
    installs: exists
      ? state.installs.map((install) =>
          install.id === remote.id ? remote : install,
        )
      : [...state.installs, remote],
  };
  persist();
}

/**
 * Renumber local rows holding an (asset, version) owned by a different id
 * to `max + 1` for that asset. The row's ID never changes, so installs
 * pinning `version_id` and the asset's `latest_version_id` keep pointing at
 * the right rows; `updatedAt` re-stamps so the renumbered row pushes. Two
 * devices can both publish `v2` from a stale view (064 slug / 065 route
 * race, `unique (asset_id, version)` edition) — this is the reconcile.
 *
 * `foreign` carries the remote slim rows (id → asset/version) at push time;
 * at adoption time the adopted row is already inside `versions`, so the
 * caller passes `[]` and the sweep still sees it.
 */
function sweepVersionCollisions(
  versions: readonly CatalogAssetVersion[],
  foreign: readonly { id: string; assetId: string; version: number }[],
): { next: CatalogAssetVersion[]; changed: boolean } {
  const owners = new Map<string, string>(); // `${assetId}:${version}` → id
  const maxByAsset = new Map<string, number>();
  const note = (assetId: string, version: number, id: string): void => {
    owners.set(`${assetId}:${version}`, id);
    maxByAsset.set(assetId, Math.max(maxByAsset.get(assetId) ?? 0, version));
  };
  for (const version of versions)
    note(version.assetId, version.version, version.id);
  for (const row of foreign) note(row.assetId, row.version, row.id);

  let changed = false;
  const next = versions.map((version) => {
    const owner = owners.get(`${version.assetId}:${version.version}`);
    if (owner === undefined || owner === version.id) return version;
    const renumbered = (maxByAsset.get(version.assetId) ?? 0) + 1;
    maxByAsset.set(version.assetId, renumbered);
    owners.set(`${version.assetId}:${renumbered}`, version.id);
    changed = true;
    return { ...version, version: renumbered, updatedAt: Date.now() };
  });
  return { next, changed };
}

/** Push-time reconcile (the `reconcileProjectSlugs` seam): defuses
 *  cross-device `unique (asset_id, version)` collisions before the upsert
 *  batch is built. Persists only when something actually renumbered — the
 *  persist re-schedules the loop's debounce, the second pass finds nothing
 *  left to bump (idempotent). */
export function reconcileCatalogVersions(
  remote: readonly { id: string; asset_id?: string; version?: number }[],
): void {
  const foreign: { id: string; assetId: string; version: number }[] = [];
  for (const row of remote) {
    if (nonEmptyId(row.asset_id) && typeof row.version === "number") {
      foreign.push({ id: row.id, assetId: row.asset_id, version: row.version });
    }
  }
  if (foreign.length === 0) return;
  const state = load();
  const { next, changed } = sweepVersionCollisions(state.versions, foreign);
  if (!changed) return;
  cache = { ...state, versions: next };
  persist();
}

function isSeeded(): boolean {
  try {
    return window.localStorage.getItem(CATALOG_SEEDED_STORAGE_KEY) === "1";
  } catch {
    // Storage unavailable — re-seeding every session is harmless (id-keyed).
    return false;
  }
}

function markSeeded(): void {
  try {
    window.localStorage.setItem(CATALOG_SEEDED_STORAGE_KEY, "1");
  } catch {
    // Best-effort marker — see isSeeded.
  }
}

/**
 * Migrates the localStorage template library into catalog rows (decision 5):
 * a template's uuid BECOMES the asset id, so re-running never duplicates;
 * `templates` defaults to the live library and is passed explicitly by
 * tests. Returns how many assets were created.
 */
export function seedCatalogFromTemplates(
  templates: readonly ComponentTemplate[] = getTemplates(),
): number {
  const state = load();
  const known = new Set(state.assets.map((asset) => asset.id));
  const fresh = templates.filter((template) => !known.has(template.id));
  if (fresh.length === 0) return 0;
  let assets = state.assets;
  let versions = state.versions;
  for (const template of fresh) {
    // Seed rows carry the template's own save time — the LWW stamp is
    // honest about when the content was authored.
    const stamp = template.createdAt;
    const version: CatalogAssetVersion = {
      id: crypto.randomUUID(),
      assetId: template.id,
      version: 1,
      spec: {
        root: template.subtree.rootKey,
        elements: structuredClone(template.subtree.elements),
      },
      changelog: null,
      createdAt: stamp,
      updatedAt: stamp,
    };
    const asset: CatalogAsset = {
      id: template.id,
      name: template.name,
      description: null,
      type: CATALOG_TYPES.component,
      visibility: CATALOG_VISIBILITIES.private,
      latestVersionId: version.id,
      createdAt: stamp,
      updatedAt: stamp,
    };
    assets = [...assets, asset];
    versions = [...versions, version];
  }
  cache = { ...state, assets, versions };
  persist();
  return fresh.length;
}

/**
 * Session-scoped seeding (decision 5): migrates the existing library ONCE
 * (the `seeded` marker keeps a deleted asset from coming back) and mirrors
 * every save made while the session lasts. Returns the cleanup — SyncEngine
 * calls it on sign-out so signed-out saves stay local-only again.
 */
export function startTemplateSeeding(): () => void {
  if (!isSeeded()) {
    seedCatalogFromTemplates();
    markSeeded();
  }
  setTemplateSavedListener((template) => {
    seedCatalogFromTemplates([template]);
  });
  return () => setTemplateSavedListener(null);
}
