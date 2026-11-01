import {
  applyRemoteEntry,
  getHistory,
  normalizeEntry,
  subscribeHistory,
} from "./history";
import type { HistoryEntry, SpecRevision } from "./history";
import {
  applyRemoteProject,
  getProjects,
  reconcileProjectSlugs,
  sanitizeProjects,
  subscribeProjects,
} from "@/lib/projects/projects";
import type { Project } from "@/lib/projects/projects";
import {
  applyRemoteMembership,
  getMemberships,
  reconcileProjectRoutes,
  sanitizeMemberships,
  subscribeMemberships,
} from "@/lib/projects/memberships";
import type { ProjectMembership } from "@/lib/projects/memberships";

/**
 * Local-first account sync (plan Q7): localStorage stays the working copy;
 * when a session exists we debounce-and-push entry changes to `uis` and merge
 * on start with last-write-wins (`updatedAt` vs `updated_at`). Fire-and-
 * forget — the app never blocks on Supabase.
 *
 * Plan 064 runs the SAME machinery as a second loop over `projects`
 * (`startTableSync` + `projectsSyncSpec`), and plan 065 as a third over
 * `project_screens` (`membershipsSyncSpec`): the loop is parameterized
 * over table + row/entity mappers so every loop shares ONE status dot and
 * ONE `flushSync` path (design decision 1) instead of a parallel sync
 * service.
 */

export type SyncStatus = "idle" | "syncing" | "saved" | "offline";

interface QueryResult {
  error: { message: string } | null;
}
interface SelectResult extends QueryResult {
  data: unknown[] | null;
}

/** The slice of the Supabase client sync uses — mockable in tests.
 *  `select` returns a thenable builder: sync adds `.eq`/`.in` filters
 *  before awaiting (plan 055 A: column-slimmed, owner-filtered pulls). */
export interface SelectBuilder extends PromiseLike<SelectResult> {
  eq(column: string, value: unknown): SelectBuilder;
  in(column: string, values: unknown[]): SelectBuilder;
}
interface TableOps {
  select(columns?: string): SelectBuilder;
  upsert(rows: Record<string, unknown>[]): PromiseLike<QueryResult>;
  delete(): { in(column: string, ids: string[]): PromiseLike<QueryResult> };
}
export interface SyncClient {
  from(table: string): TableOps;
}

let status: SyncStatus = "idle";
const statusListeners = new Set<() => void>();
/** Per-loop status, keyed by table — the single status dot aggregates every
 *  running loop (064 decision 1: one indicator, not one per loop). */
const loopStates = new Map<string, SyncStatus>();
/** One "Upload now" path across every running loop (064 decision 1). */
const flushes = new Set<() => void>();

export function getSyncStatus(): SyncStatus {
  return status;
}

/** Forces an immediate push outside the debounce — the "Upload now" action,
 *  run against EVERY running loop (one flush path, 064 decision 1). */
export function flushSync(): void {
  for (const flush of flushes) flush();
}

export function subscribeSyncStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

/** Collapse the per-loop states into the one published status. */
function publishStatus(): void {
  const states = [...loopStates.values()];
  let next: SyncStatus = "idle";
  if (states.includes("syncing")) {
    next = "syncing";
  } else if (states.includes("offline")) {
    next = "offline";
  } else if (states.length > 0) {
    next = "saved";
  }
  if (next === status) return;
  status = next;
  for (const listener of statusListeners) listener();
}

function setLoopStatus(table: string, next: SyncStatus): void {
  if (loopStates.get(table) === next) return;
  loopStates.set(table, next);
  publishStatus();
}

function releaseLoop(table: string): void {
  loopStates.delete(table);
  publishStatus();
}

interface UisRow {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  prompt: string | null;
  revisions: SpecRevision[] | null;
  head: number | null;
  created_at: string;
  updated_at: string;
}

function isUisRow(value: unknown): value is UisRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Partial<UisRow>;
  return (
    typeof row.id === "string" &&
    typeof row.owner_id === "string" &&
    typeof row.name === "string" &&
    typeof row.slug === "string" &&
    typeof row.created_at === "string" &&
    typeof row.updated_at === "string"
  );
}

/** The slim compare-row pull's phase 1 returns (plan 055 A). `slug` rides
 *  along when a spec's slimColumns include it (projects — 064 reconcile);
 *  `project_id`/`screen_id`/`route` likewise for `project_screens` (065 —
 *  `reconcileProjectRoutes` needs them to resolve cross-device duplicates). */
export interface SlimRow {
  id: string;
  owner_id: string;
  updated_at: string;
  slug?: string;
  project_id?: string;
  screen_id?: string;
  route?: string | null;
}

function isSlimRow(value: unknown): value is SlimRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Partial<SlimRow>;
  return (
    typeof row.id === "string" &&
    typeof row.owner_id === "string" &&
    typeof row.updated_at === "string"
  );
}

export function rowToEntry(row: UisRow): HistoryEntry {
  const revisions = Array.isArray(row.revisions) ? row.revisions : [];
  const head =
    typeof row.head === "number"
      ? Math.min(Math.max(row.head, 0), Math.max(revisions.length - 1, 0))
      : Math.max(revisions.length - 1, 0);
  const spec = revisions[head]?.spec;
  return normalizeEntry({
    id: row.id,
    name: row.name,
    slug: row.slug,
    prompt: row.prompt ?? "",
    revisions,
    head,
    spec: spec ?? { root: "root", elements: {} },
    createdAt: Date.parse(row.created_at),
    updatedAt: Date.parse(row.updated_at),
  });
}

export function entryToRow(
  entry: HistoryEntry,
  ownerId: string,
): Record<string, unknown> {
  return {
    id: entry.id,
    owner_id: ownerId,
    name: entry.name,
    slug: entry.slug,
    prompt: entry.prompt,
    revisions: entry.revisions,
    head: entry.head,
    created_at: new Date(entry.createdAt).toISOString(),
    updated_at: new Date(entry.updatedAt).toISOString(),
  };
}

/** The `projects` row shape the full-row phase returns (064). `status` is
 *  deliberately absent: it belongs to plan 069 — sync reads past it and
 *  never writes it (see `projectToRow`). `home_screen_id` is modeled since
 *  plan 065 (decision 10's sync contract) and travels as an optional
 *  column. */
interface ProjectRow {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  state: unknown;
  created_at: string;
  updated_at: string;
  home_screen_id?: string | null;
}

function isProjectRow(value: unknown): value is ProjectRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Partial<ProjectRow>;
  return (
    typeof row.id === "string" &&
    typeof row.owner_id === "string" &&
    typeof row.name === "string" &&
    typeof row.slug === "string" &&
    typeof row.created_at === "string" &&
    typeof row.updated_at === "string"
  );
}

/** Row → `Project`: corrupt or partial remote rows come back `null` (the
 *  `normalizeEntry` discipline — junk never reaches the store); salvageable
 *  rows go through the store's sanitizer, which backfills slug/state and
 *  falls back `updatedAt` to `createdAt` for a junk stamp. */
export function rowToProject(raw: unknown): Project | null {
  if (!isProjectRow(raw)) return null;
  const createdAt = Date.parse(raw.created_at);
  if (!Number.isFinite(createdAt)) return null;
  const updatedAt = Date.parse(raw.updated_at);
  const homeScreenId =
    typeof raw.home_screen_id === "string" && raw.home_screen_id !== ""
      ? raw.home_screen_id
      : undefined;
  const [project] = sanitizeProjects([
    {
      id: raw.id,
      name: raw.name,
      slug: raw.slug,
      state: raw.state,
      createdAt,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : createdAt,
      ...(homeScreenId !== undefined ? { homeScreenId } : {}),
    },
  ]);
  return project ?? null;
}

/** `Project` → upsert row. `home_screen_id` travels since plan 065 (the
 *  explicit home is device-modeled and LWW-synced like the rest); `status`
 *  stays out — a server-side fact this device doesn't model (069), so
 *  PostgREST's partial upsert leaves it intact on update and a fresh
 *  insert takes the DB default. */
export function projectToRow(
  project: Project,
  ownerId: string,
): Record<string, unknown> {
  return {
    id: project.id,
    owner_id: ownerId,
    name: project.name,
    slug: project.slug,
    state: project.state,
    home_screen_id: project.homeScreenId ?? null,
    created_at: new Date(project.createdAt).toISOString(),
    updated_at: new Date(project.updatedAt).toISOString(),
  };
}

/** One synced table: the loop below is parameterized over row/entity shape
 *  so `uis` and `projects` share one status dot and one flush path (064
 *  decision 1). */
export interface SyncSpec<T extends { id: string; updatedAt: number }> {
  /** Table name — also this loop's key in the shared status registry. */
  table: string;
  /** Slim columns of BOTH phases — must include `id, owner_id, updated_at`. */
  slimColumns: string;
  /** Local working copy (the loop never touches storage itself). */
  read(): T[];
  /** Adopt a remote row that won the LWW compare (already decided by the
   *  loop — mirrors `applyRemoteEntry`, which trusts its caller). */
  apply(remote: T, local: T | undefined): void;
  /** Change subscription — every change schedules the debounced push. */
  subscribe(listener: () => void): () => void;
  /** Row → entity; `null` drops corrupt/partial rows (sanitized away). */
  toEntity(row: unknown): T | null;
  /** Entity → upsert row (the `owner_id` stamp happens here). */
  toRow(entity: T, ownerId: string): Record<string, unknown>;
  /** Runs against the push's slim view before the payload is built: fixes
   *  up local data colliding with remote rows (slug uniqueness, 064
   *  decision 5). Absent for entries — their namespaces reconcile today. */
  reconcile?(remote: readonly SlimRow[]): void;
}

/**
 * Starts syncing ONE table for a session: one full merge (download account
 * copies that are newer or unknown, upload local winners), then a debounced
 * push on every change until the returned stop function is called. The loop
 * reports its status under `spec.table`; `flushSync` runs its push directly.
 */
export function startTableSync<T extends { id: string; updatedAt: number }>(
  client: SyncClient,
  ownerId: string,
  spec: SyncSpec<T>,
  options: { debounceMs?: number } = {},
): () => void {
  const debounceMs = options.debounceMs ?? 800;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let syncedIds = new Set<string>();
  let chain: Promise<void> = Promise.resolve();

  const isOnline = () =>
    typeof navigator === "undefined" || navigator.onLine !== false;

  /** Download remote-only / remote-newer rows (LWW).
   *
   *  Two-phase (plan 055 A): phase 1 fetches only the slim compare columns
   *  with a server-side owner filter — the LWW decision needs nothing else;
   *  phase 2 pulls full rows solely for ids that actually win the compare. */
  async function pull(): Promise<void> {
    const slim = await client
      .from(spec.table)
      .select(spec.slimColumns)
      .eq("owner_id", ownerId);
    if (stopped || slim.error) return;

    const localById = new Map(
      spec.read().map((entity) => [entity.id, entity] as const),
    );
    const needIds: string[] = [];
    for (const raw of slim.data ?? []) {
      if (!isSlimRow(raw)) continue;
      // Defense in depth (F7): the server filters by owner; re-check anyway.
      if (raw.owner_id !== ownerId) continue;
      const local = localById.get(raw.id);
      if (!local || Date.parse(raw.updated_at) > local.updatedAt) {
        needIds.push(raw.id);
      }
    }
    if (needIds.length === 0) return;

    const full = await client.from(spec.table).select("*").in("id", needIds);
    if (stopped || full.error) return;
    // Re-read AFTER the awaits: a local write newer than phase 1's snapshot
    // must still win the compare (never clobber what was typed mid-pull).
    const currentById = new Map(
      spec.read().map((entity) => [entity.id, entity] as const),
    );
    for (const raw of full.data ?? []) {
      if (!isSlimRow(raw)) continue;
      // Never adopt rows owned by another account (RLS audit F7): an admin
      // sees every row under the SELECT policy, so without this guard an
      // admin's pull would copy foreign data into the local store and the
      // next push would re-upsert it with `owner_id = admin` — a silent
      // ownership transfer (RLS can't block it: writing owner_id = self
      // passes WITH CHECK for an admin). Phase 1's server-side filter
      // already excluded foreign rows; this re-check is defense in depth.
      if (raw.owner_id !== ownerId) continue;
      const remote = spec.toEntity(raw);
      if (!remote) continue; // corrupt/partial row — sanitized away
      const local = currentById.get(remote.id);
      if (!local || remote.updatedAt > local.updatedAt) {
        spec.apply(remote, local);
      }
    }
  }

  /** Upload local winners, delete rows removed locally since the last sync. */
  async function push(): Promise<void> {
    // A queued chain item can outlive stop() (sign-out) — never resurrect a
    // released loop's status from a push that races the teardown.
    if (stopped) return;
    if (!isOnline()) {
      setLoopStatus(spec.table, "offline");
      return;
    }
    setLoopStatus(spec.table, "syncing");
    // Only rows the remote copy is missing or older than — never clobber a
    // fresher write from another device. Column-slimmed (plan 055 A): the
    // compare reads `updated_at`, the guards read `owner_id`, the delete
    // pass reads `id` — no payload columns. Deliberately UNfiltered by
    // owner (decision 5): the F7 guard below must SEE foreign rows to
    // refuse upserting them.
    const { data, error } = await client
      .from(spec.table)
      .select(spec.slimColumns);
    if (stopped) return;
    if (error) {
      setLoopStatus(spec.table, "offline");
      return;
    }
    const slimRows = (data ?? []).filter(isSlimRow);
    const remoteById = new Map(slimRows.map((row) => [row.id, row]));

    // Reconcile BEFORE the payload (064 decision 5): local rows holding a
    // slug a remote row of a different id owns get bumped — never dropped —
    // so the upsert can never trip `unique (owner_id, slug)`. Only OUR rows
    // count: uniqueness is per-owner, and an admin's see-all select must not
    // bump local names off someone else's slugs. May persist a bump, which
    // re-schedules this loop's own debounce; the second pass finds nothing
    // left to bump (idempotent).
    spec.reconcile?.(slimRows.filter((row) => row.owner_id === ownerId));

    const local = spec.read();
    const localIds = new Set(local.map((entity) => entity.id));
    const payload = local
      .filter((entity) => {
        const remote = remoteById.get(entity.id);
        // Belt to pull's braces: never overwrite a row another account
        // owns — the upsert stamps owner_id = us and would steal it (F7).
        if (remote && remote.owner_id !== ownerId) return false;
        // Missing remotely, or local write not older than the remote copy —
        // never clobber a fresher write from another device.
        return !remote || entity.updatedAt >= Date.parse(remote.updated_at);
      })
      .map((entity) => spec.toRow(entity, ownerId));

    if (payload.length > 0) {
      const { error: upsertError } = await client
        .from(spec.table)
        .upsert(payload);
      if (stopped) return;
      if (upsertError) {
        setLoopStatus(spec.table, "offline");
        return;
      }
    }

    const removed = [...syncedIds].filter((id) => {
      if (localIds.has(id)) return false;
      // A stale local copy of another account's row must not delete it.
      const remote = remoteById.get(id);
      return !remote || remote.owner_id === ownerId;
    });
    if (removed.length > 0) {
      const { error: deleteError } = await client
        .from(spec.table)
        .delete()
        .in("id", removed);
      if (stopped) return;
      if (deleteError) {
        setLoopStatus(spec.table, "offline");
        return;
      }
    }

    syncedIds = localIds;
    setLoopStatus(spec.table, "saved");
  }

  async function run(): Promise<void> {
    if (stopped) return;
    await pull();
    if (stopped) return;
    await push();
  }

  function schedule(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      chain = chain.then(() => push());
    }, debounceMs);
  }

  // "Upload now" affordance: skips the debounce and pushes on the next tick.
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    chain = chain.then(() => push());
  };
  flushes.add(flush);

  setLoopStatus(spec.table, "syncing");
  chain = chain.then(() => run());

  const unsubscribe = spec.subscribe(schedule);
  const handleOnline = () => schedule();
  const handleOffline = () => setLoopStatus(spec.table, "offline");
  // Some test environments expose a partial `window` — feature-detect.
  const canListen =
    typeof window !== "undefined" &&
    typeof window.addEventListener === "function";
  if (canListen) {
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
  }

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    unsubscribe();
    flushes.delete(flush);
    if (canListen) {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    }
    releaseLoop(spec.table);
  };
}

/** The `uis` loop — plan Q7/055 A semantics, unchanged: 064 wraps it as the
 *  first spec so the entries contract stays byte-identical (061/055 tests
 *  pin it). */
export const entriesSyncSpec: SyncSpec<HistoryEntry> = {
  table: "uis",
  slimColumns: "id, owner_id, updated_at",
  read: getHistory,
  apply: (remote, local) =>
    applyRemoteEntry(
      // `uis` has no project column (061): a remote row winning the LWW
      // merge must not drop the local grouping — carry the device's own
      // projectId onto the adopted copy.
      local?.projectId ? { ...remote, projectId: local.projectId } : remote,
    ),
  subscribe: subscribeHistory,
  toEntity: (row) => (isUisRow(row) ? rowToEntry(row) : null),
  toRow: entryToRow,
};

/** The `projects` loop (plan 064): same machinery one table over — one
 *  status dot, one flush path (decision 1); adoption-time slug collisions
 *  bump the local copy, never dropping either side (decision 5). */
export const projectsSyncSpec: SyncSpec<Project> = {
  table: "projects",
  slimColumns: "id, owner_id, updated_at, slug",
  read: getProjects,
  apply: (remote) => applyRemoteProject(remote),
  subscribe: subscribeProjects,
  toEntity: rowToProject,
  toRow: projectToRow,
  reconcile: reconcileProjectSlugs,
};

/** The `project_screens` row shape the full-row phase returns (065). */
interface ProjectScreenRow {
  id: string;
  owner_id: string;
  project_id: string;
  screen_id: string;
  route: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

function isProjectScreenRow(value: unknown): value is ProjectScreenRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Partial<ProjectScreenRow>;
  return (
    typeof row.id === "string" &&
    typeof row.owner_id === "string" &&
    typeof row.project_id === "string" &&
    typeof row.screen_id === "string" &&
    typeof row.created_at === "string" &&
    typeof row.updated_at === "string"
  );
}

/** Row → `ProjectMembership`: corrupt/partial rows come back `null` (the
 *  `rowToProject` discipline); salvageable rows go through the store's
 *  sanitizer, which restores the two uniqueness invariants (065 decision
 *  7/11) and falls back `updatedAt` to `createdAt` for a junk stamp. */
export function rowToMembership(raw: unknown): ProjectMembership | null {
  if (!isProjectScreenRow(raw)) return null;
  const createdAt = Date.parse(raw.created_at);
  if (!Number.isFinite(createdAt)) return null;
  const updatedAt = Date.parse(raw.updated_at);
  const [membership] = sanitizeMemberships([
    {
      id: raw.id,
      projectId: raw.project_id,
      screenId: raw.screen_id,
      route: raw.route,
      position: raw.position,
      createdAt,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : createdAt,
    },
  ]);
  return membership ?? null;
}

/** `ProjectMembership` → upsert row (the `owner_id` stamp happens here). */
export function membershipToRow(
  membership: ProjectMembership,
  ownerId: string,
): Record<string, unknown> {
  return {
    id: membership.id,
    owner_id: ownerId,
    project_id: membership.projectId,
    screen_id: membership.screenId,
    route: membership.route,
    position: membership.position,
    created_at: new Date(membership.createdAt).toISOString(),
    updated_at: new Date(membership.updatedAt).toISOString(),
  };
}

/** The `project_screens` loop (plan 065): a third run of the same
 *  machinery — one status dot, one flush path (064 decision 1). The slim
 *  compare view carries pair + route so the push's reconcile can defuse
 *  cross-device duplicates before they poison the upsert batch (decisions
 *  9/11). */
export const membershipsSyncSpec: SyncSpec<ProjectMembership> = {
  table: "project_screens",
  slimColumns: "id, owner_id, updated_at, project_id, screen_id, route",
  read: getMemberships,
  apply: (remote) => applyRemoteMembership(remote),
  subscribe: subscribeMemberships,
  toEntity: rowToMembership,
  toRow: membershipToRow,
  reconcile: reconcileProjectRoutes,
};

/**
 * Starts the `uis` loop for a session (the original entry point).
 * `startTableSync` + `projectsSyncSpec` runs the second loop; the SyncEngine
 * starts both and stops both, sharing this module's status and flush paths.
 */
export function startSync(
  client: SyncClient,
  ownerId: string,
  options: { debounceMs?: number } = {},
): () => void {
  return startTableSync(client, ownerId, entriesSyncSpec, options);
}
