/**
 * Project membership entity (plan 065, decision 1): which screens (history
 * entries) belong to a project, with an optional configured route and a
 * stable position. One row per (project, screen) pair — a screen can live in
 * several projects at once, which `HistoryEntry.projectId` (a single pointer)
 * could never express.
 *
 * **Local-first, account-synced** (decision 2): the module store follows the
 * `projects.ts` pattern — localStorage-backed working copy, SSR-safe server
 * snapshots, and (WS4) a third `startTableSync` loop mirroring rows into the
 * `project_screens` table under plain LWW (`updatedAt` vs `updated_at`).
 *
 * `entry.projectId` stays as the device-local "born into" hint (061/062
 * contract, sync spec carries it); membership rows are the source of truth
 * for workspace membership, routes, and ordering. The backfill below seeds
 * rows from existing `projectId` pointers on first load.
 */

import {
  copyEntry,
  getHistory,
  removeEntry,
  setEntryProject,
} from "@/lib/history";
import type { HistoryEntry } from "@/lib/history";
import { getProjects, setProjectHomeScreenId } from "@/lib/projects/projects";

export const MEMBERSHIP_STORAGE_KEY = "genui-project-memberships";

export interface ProjectMembership {
  /** Membership row id (client-generated uuid — local-first like Project). */
  id: string;
  projectId: string;
  /** The `HistoryEntry`/`uis` id of the member screen. */
  screenId: string;
  /**
   * Configured `{param}` route pattern (same syntax as the spec-level
   * `route`, plan 061-3), or null for exact-slug-only membership. Unique per
   * project (decision 7) — the DB enforces it, the store rejects collisions
   * at write time.
   */
  route: string | null;
  /** Order within the project — deterministic tie-break below the route
   *  precedence (decision 6). Appended at the end on add. */
  position: number;
  createdAt: number;
  /** Last mutation — the LWW tie-breaker for account sync. */
  updatedAt: number;
}

const EMPTY: ProjectMembership[] = [];

/**
 * Normalize a route to its stored form: trimmed, outer slashes stripped,
 * empty → null (the shared shape with `specRoutePattern`, so a route written
 * through either seam stores identically).
 */
function normalizeRoute(route: string): string | null {
  const trimmed = route
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .trim();
  return trimmed === "" ? null : trimmed;
}

function isValidMembership(value: unknown): value is ProjectMembership {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ProjectMembership>;
  return (
    typeof candidate.id === "string" &&
    candidate.id !== "" &&
    typeof candidate.projectId === "string" &&
    candidate.projectId !== "" &&
    typeof candidate.screenId === "string" &&
    candidate.screenId !== "" &&
    typeof candidate.createdAt === "number"
  );
}

/**
 * Drop anything that doesn't parse as a membership, then restore the two
 * invariants the DB constraints own: at most one row per (project, screen)
 * and at most one row per (project, route) — later duplicates keep their
 * membership but lose the colliding route (decision 9's shape: never drop a
 * membership to satisfy a uniqueness constraint). Exported as the
 * sanitization discipline for REMOTE rows too (064 pattern).
 */
export function sanitizeMemberships(raw: unknown): ProjectMembership[] {
  if (!Array.isArray(raw)) return EMPTY;
  const seenPairs = new Set<string>();
  const seenRoutes = new Set<string>();
  const cleaned: ProjectMembership[] = [];
  for (const candidate of raw) {
    if (!isValidMembership(candidate)) continue;
    const stored = candidate as ProjectMembership & {
      route?: unknown;
      position?: unknown;
      updatedAt?: unknown;
    };
    const pairKey = `${stored.projectId}\u0000${stored.screenId}`;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);
    let route = normalizeRoute(String(stored.route ?? ""));
    if (route !== null) {
      const routeKey = `${stored.projectId}\u0000${route}`;
      if (seenRoutes.has(routeKey)) route = null;
      else seenRoutes.add(routeKey);
    }
    cleaned.push({
      id: stored.id,
      projectId: stored.projectId,
      screenId: stored.screenId,
      route,
      position:
        typeof stored.position === "number" && Number.isFinite(stored.position)
          ? Math.max(0, Math.trunc(stored.position))
          : 0,
      createdAt: stored.createdAt,
      updatedAt:
        typeof stored.updatedAt === "number"
          ? stored.updatedAt
          : stored.createdAt,
    });
  }
  return cleaned;
}

/**
 * Backfill (plan 065 task 1): every entry whose `projectId` resolves to a
 * project in the store gets a membership row, so screens grouped by the
 * 061/062 pointer keep their membership across the entity change. Dangling
 * ids (project deleted on this device or never pulled) are skipped — the
 * entry keeps falling into the "no project" bucket (062 migration note).
 * Idempotent: existing (project, screen) pairs are left untouched.
 */
function backfillFromEntries(
  memberships: ProjectMembership[],
  entries: ReturnType<typeof getHistory>,
  projects: ReturnType<typeof getProjects>,
): {
  rows: ProjectMembership[];
  changed: boolean;
  /** Initial home fills for projects whose membership set is created NOW
   *  (decision 13) — applied by the caller after the cache is set. */
  homeSeeds: Array<{ projectId: string; screenId: string }>;
} {
  const projectIds = new Set(projects.map((project) => project.id));
  const held = new Set(
    memberships.map((row) => `${row.projectId}\u0000${row.screenId}`),
  );
  // Projects that already have rows are NOT first-time: seeding their home
  // here would resurrect a deliberately cleared one on every reload
  // (decision 13's rejection).
  const rowsByProject = new Map<string, number>();
  for (const row of memberships) {
    rowsByProject.set(
      row.projectId,
      (rowsByProject.get(row.projectId) ?? 0) + 1,
    );
  }
  const homeSeeds: Array<{ projectId: string; screenId: string }> = [];
  let nextPosition = memberships.reduce(
    (max, row) => Math.max(max, row.position),
    -1,
  );
  const added: ProjectMembership[] = [];
  // Deterministic order: positions follow CREATION order (oldest first —
  // `getHistory()` is newest-first, so iterate reversed). Appends land after
  // the current tail, so backfill never reshuffles explicit ordering.
  for (const entry of [...entries].reverse()) {
    if (!entry.projectId || !projectIds.has(entry.projectId)) continue;
    const key = `${entry.projectId}\u0000${entry.id}`;
    if (held.has(key)) continue;
    held.add(key);
    const isFirstForRow =
      (rowsByProject.get(entry.projectId) ?? 0) === 0 &&
      !homeSeeds.some((seed) => seed.projectId === entry.projectId);
    if (isFirstForRow) {
      rowsByProject.set(entry.projectId, 1);
      const project = projects.find(
        (candidate) => candidate.id === entry.projectId,
      );
      if ((project?.homeScreenId ?? null) === null) {
        // Oldest member first (iteration order) — the initial fill only.
        homeSeeds.push({
          projectId: entry.projectId,
          screenId: entry.id,
        });
      }
    } else {
      rowsByProject.set(
        entry.projectId,
        (rowsByProject.get(entry.projectId) ?? 0) + 1,
      );
    }
    nextPosition += 1;
    added.push({
      id: crypto.randomUUID(),
      projectId: entry.projectId,
      screenId: entry.id,
      route: null,
      position: nextPosition,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    });
  }
  if (added.length === 0) {
    return { rows: memberships, changed: false, homeSeeds: [] };
  }
  return { rows: [...memberships, ...added], changed: true, homeSeeds };
}

function readStored(): ProjectMembership[] {
  try {
    const stored = window.localStorage.getItem(MEMBERSHIP_STORAGE_KEY);
    if (!stored) return EMPTY;
    return sanitizeMemberships(JSON.parse(stored));
  } catch {
    // Unreadable/corrupt value — fall back to an empty membership list.
    return EMPTY;
  }
}

const listeners = new Set<() => void>();

let cache: ProjectMembership[] | null = null;

function load(): ProjectMembership[] {
  if (cache !== null) return cache;
  if (typeof window === "undefined") {
    cache = EMPTY;
    return cache;
  }
  const rows = readStored();
  // Self-healing backfill on first client read (same discipline as the
  // slug backfill inside `sanitizeProjects`): a listener re-entering
  // `getMemberships` from `notify` finds the cache already set.
  const backfilled = backfillFromEntries(rows, getHistory(), getProjects());
  cache = backfilled.rows;
  if (backfilled.changed) persist();
  // Initial home fills (decision 13) AFTER the cache is set — the setter
  // persists the projects store, whose listeners may re-enter this module.
  for (const seed of backfilled.homeSeeds) {
    setProjectHomeScreenId(seed.projectId, seed.screenId);
  }
  return cache;
}

function persist(): void {
  try {
    window.localStorage.setItem(
      MEMBERSHIP_STORAGE_KEY,
      JSON.stringify(cache ?? EMPTY),
    );
  } catch {
    // Quota exceeded or storage unavailable — store stays for this session.
  }
  for (const listener of listeners) listener();
}

/** Client snapshot for `useSyncExternalStore`. */
export function getMemberships(): ProjectMembership[] {
  return load();
}

/** Server snapshot — the client re-renders with stored rows after hydration. */
export function getServerMemberships(): ProjectMembership[] {
  return EMPTY;
}

export function subscribeMemberships(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The memberships of one project, in display/route order: `position` first,
 * then `createdAt`, then id — fully deterministic so two devices with the
 * same rows resolve ties identically (decision 6).
 */
export function getProjectMemberships(projectId: string): ProjectMembership[] {
  return load()
    .filter((row) => row.projectId === projectId)
    .sort(
      (a, b) =>
        a.position - b.position ||
        a.createdAt - b.createdAt ||
        a.id.localeCompare(b.id),
    );
}

/** The membership of (project, screen), or null when not a member. */
export function getMembership(
  projectId: string,
  screenId: string,
): ProjectMembership | null {
  return (
    load().find(
      (row) => row.projectId === projectId && row.screenId === screenId,
    ) ?? null
  );
}

/**
 * Add an existing screen to a project (decision 3: membership row only —
 * never a new screen). No-ops (null) on unknown/duplicate membership or when
 * the route is already configured on another member of the same project
 * (decision 7 — the store rejects at write time, the DB constraint is the
 * backstop). New members append after the current tail.
 */
export function addScreenToProject(
  projectId: string,
  screenId: string,
  route?: string | null,
): ProjectMembership | null {
  const rows = load();
  if (
    rows.some((row) => row.projectId === projectId && row.screenId === screenId)
  ) {
    return null;
  }
  const normalized = route == null ? null : normalizeRoute(route);
  if (
    normalized !== null &&
    rows.some((row) => row.projectId === projectId && row.route === normalized)
  ) {
    return null;
  }
  const now = Date.now();
  const position =
    rows.reduce((max, row) => Math.max(max, row.position), -1) + 1;
  const membership: ProjectMembership = {
    id: crypto.randomUUID(),
    projectId,
    screenId,
    route: normalized,
    position,
    createdAt: now,
    updatedAt: now,
  };
  cache = [...rows, membership];
  persist();
  // Initial home fill (decision 13): the first member seeds an empty home
  // — never a reassignment (decision 5). Unknown project ids no-op inside
  // the setter, so membership-only callers need no guard here.
  const project = getProjects().find((candidate) => candidate.id === projectId);
  if (project && (project.homeScreenId ?? null) === null) {
    setProjectHomeScreenId(projectId, screenId);
  }
  return membership;
}

/**
 * Remove a screen from ONE project (decision 3: membership only — the
 * screen survives in its other projects and in history). Unknown pairs are a
 * no-op (false).
 *
 * Pointer hygiene (decision 12): when the entry's device-local
 * `projectId` points at THIS project it is cleared alongside the row —
 * otherwise the idempotent backfill would re-add the membership on the
 * next load. The screen drops to the "no project" bucket in legacy
 * grouping (membership-driven grouping is plan 065 task 4).
 */
export function removeScreenFromProject(
  projectId: string,
  screenId: string,
): boolean {
  const rows = load();
  const next = rows.filter(
    (row) => !(row.projectId === projectId && row.screenId === screenId),
  );
  if (next.length === rows.length) return false;
  cache = next;
  const entry = getHistory().find((candidate) => candidate.id === screenId);
  if (entry?.projectId === projectId) setEntryProject(screenId, undefined);
  // Decision 5: removing the home screen does NOT reassign — the root
  // entry point goes empty until the next fill (decision 13) or an
  // explicit pick through the task-4 setter.
  const project = getProjects().find((candidate) => candidate.id === projectId);
  if (project && (project.homeScreenId ?? null) === screenId) {
    setProjectHomeScreenId(projectId, null);
  }
  persist();
  return true;
}

/**
 * Copy a member screen into ANOTHER project as a NEW screen (decision 3):
 * the copy gets a fresh `HistoryEntry`/`uis` identity at revision 0 and a
 * membership row in the destination — the source membership, entry and its
 * revisions are untouched. The destination membership never carries a
 * route (a fresh screen has no route contract yet). No-ops (null) when the
 * source isn't a member, the projects are the same, the source entry is
 * missing, or the destination membership cannot be written (the copy is
 * rolled back so no orphan entry is left behind).
 */
export function copyScreenToProject(
  fromProjectId: string,
  toProjectId: string,
  screenId: string,
): HistoryEntry | null {
  if (fromProjectId === toProjectId) return null;
  const rows = load();
  if (
    !rows.some(
      (row) => row.projectId === fromProjectId && row.screenId === screenId,
    )
  ) {
    return null;
  }
  const source = getHistory().find((entry) => entry.id === screenId);
  if (!source) return null;
  const copy = copyEntry(source, toProjectId);
  if (addScreenToProject(toProjectId, copy.id) === null) {
    // Destination pair already exists (corrupt input) — never leave an
    // orphan entry behind.
    removeEntry(copy.id);
    return null;
  }
  return copy;
}

/**
 * Move a member screen between projects (decision 3): remove the source
 * membership, add it at the destination's tail — the entry's id, spec and
 * revisions are preserved (no fork, no deep copy). The destination
 * membership starts route-less (routes are per-project URL contracts) and
 * the device-local pointer re-stamps to the destination (decision 12), so
 * the backfill never resurrects the source membership on reload. No-ops
 * (false) when the pair isn't a source member, already is a destination
 * member, or the projects are the same.
 */
export function moveScreenBetweenProjects(
  fromProjectId: string,
  toProjectId: string,
  screenId: string,
): boolean {
  if (fromProjectId === toProjectId) return false;
  const rows = load();
  if (
    !rows.some(
      (row) => row.projectId === fromProjectId && row.screenId === screenId,
    ) ||
    rows.some(
      (row) => row.projectId === toProjectId && row.screenId === screenId,
    )
  ) {
    return false;
  }
  if (!removeScreenFromProject(fromProjectId, screenId)) return false;
  // Cannot fail: the destination pair was checked free above and a null
  // route never collides — but guard anyway, restoring the source row.
  if (addScreenToProject(toProjectId, screenId) === null) {
    addScreenToProject(fromProjectId, screenId);
    return false;
  }
  setEntryProject(screenId, toProjectId);
  return true;
}

/**
 * Set (or with null, clear) a member's configured route. Rejects (false) when
 * another member of the same project already holds the route (decision 7) or
 * the pair isn't a member. An unchanged route is a no-op (false) so callers
 * can treat false as "nothing written".
 */
export function setMembershipRoute(
  projectId: string,
  screenId: string,
  route: string | null,
): boolean {
  const rows = load();
  const index = rows.findIndex(
    (row) => row.projectId === projectId && row.screenId === screenId,
  );
  if (index === -1) return false;
  const normalized = route == null ? null : normalizeRoute(route);
  const collision =
    normalized !== null &&
    rows.some(
      (row, i) =>
        i !== index && row.projectId === projectId && row.route === normalized,
    );
  if (collision) return false;
  if (rows[index].route === normalized) return false;
  const now = Date.now();
  cache = rows.map((row, i) =>
    i === index ? { ...row, route: normalized, updatedAt: now } : row,
  );
  persist();
  return true;
}

/**
 * Rewrite member positions from an explicit ordering (decision 6): ids not
 * listed keep their relative order after the listed ones; unknown ids are
 * ignored. Positions are dense 0..n-1 afterwards. No-op (false) when the
 * order matches what's stored.
 */
export function reorderProjectMembers(
  projectId: string,
  orderedScreenIds: readonly string[],
): boolean {
  const rows = load();
  const members = rows
    .filter((row) => row.projectId === projectId)
    .sort(
      (a, b) =>
        a.position - b.position ||
        a.createdAt - b.createdAt ||
        a.id.localeCompare(b.id),
    );
  if (members.length === 0) return false;
  const listed = new Set(orderedScreenIds);
  const head = orderedScreenIds
    .map((id) => members.find((row) => row.screenId === id))
    .filter((row): row is ProjectMembership => row !== undefined);
  const tail = members.filter((row) => !listed.has(row.screenId));
  const reordered = [...head, ...tail];
  if (
    reordered.every((row, i) => members[i].id === row.id) &&
    members.every((row, i) => row.position === i)
  ) {
    return false;
  }
  const now = Date.now();
  const byId = new Map(
    reordered.map((row, i) => [
      row.id,
      { ...row, position: i, updatedAt: now },
    ]),
  );
  cache = rows.map((row) =>
    row.projectId === projectId && byId.has(row.id)
      ? (byId.get(row.id) as ProjectMembership)
      : row,
  );
  persist();
  return true;
}

/* ------------------------------------------------------------------ */
/* Account sync (decision 2 — the `membershipsSyncSpec` write paths)   */
/* ------------------------------------------------------------------ */

/** The (project, screen) pair key the uniqueness constraint owns. */
function pairKey(row: { projectId: string; screenId: string }): string {
  return `${row.projectId}\u0000${row.screenId}`;
}

/**
 * Adopt a remote row that won the LWW compare (the loop has already
 * decided) — insert-or-replace, preserving the row's own timestamps.
 *
 * Pair duplicates (decision 11): one row per (project, screen). The REMOTE
 * id is the DB identity (that row already exists in `project_screens`), so
 * a locally NEWER twin is re-keyed onto it (its content then overwrites the
 * remote row on the next push under LWW) and an older one yields to the
 * remote content. Route collisions with OTHER members (decision 9): the
 * adopted row's route is DB-constraint truth — a colliding local holder
 * clears its route (membership kept, re-stamped), never drops.
 */
export function applyRemoteMembership(remote: ProjectMembership): void {
  const rows = load();
  const twin = rows.find(
    (row) => row.id !== remote.id && pairKey(row) === pairKey(remote),
  );
  const keepLocal = twin !== undefined && twin.updatedAt >= remote.updatedAt;
  const adopted: ProjectMembership = keepLocal
    ? { ...twin, id: remote.id }
    : remote;
  const dropIds = new Set<string>([remote.id]);
  if (twin) dropIds.add(twin.id);
  const now = Date.now();
  const next = rows
    .filter((row) => !dropIds.has(row.id))
    .map((row) =>
      row.projectId === adopted.projectId &&
      row.route !== null &&
      row.route === adopted.route
        ? { ...row, route: null, updatedAt: now }
        : row,
    );
  cache = sanitizeMemberships([...next, adopted]);
  persist();
}

/**
 * Push-time reconcile (decisions 9/11 — runs against the push's slim view
 * BEFORE the payload is built, `reconcileProjectSlugs`' shape):
 *
 * - a local row whose PAIR a remote row of a different id already owns is
 *   re-keyed onto that id (its content wins or loses at LWW by timestamp —
 *   either way exactly one row exists per pair); when the id is already
 *   taken locally (corrupt input) the twin is dropped instead,
 * - a local row holding a ROUTE a remote row of a different id owns gets
 *   the route cleared (membership kept, re-stamped) — a route is a URL
 *   contract, never suffixed (decision 9).
 *
 * May persist a change, which re-schedules this loop's own debounced push;
 * the second pass finds nothing left to fix (idempotent).
 */
export function reconcileProjectRoutes(
  remote: readonly {
    id: string;
    project_id?: unknown;
    screen_id?: unknown;
    route?: unknown;
  }[],
): void {
  const pairIds = new Map<string, string>();
  const routeIds = new Map<string, string>();
  for (const row of remote) {
    if (
      typeof row.project_id !== "string" ||
      typeof row.screen_id !== "string"
    ) {
      continue;
    }
    pairIds.set(`${row.project_id}\u0000${row.screen_id}`, row.id);
    if (typeof row.route === "string") {
      const normalized = normalizeRoute(row.route);
      if (normalized !== null) {
        routeIds.set(`${row.project_id}\u0000${normalized}`, row.id);
      }
    }
  }
  if (pairIds.size === 0 && routeIds.size === 0) return;
  const rows = load();
  const now = Date.now();
  let changed = false;
  const next: ProjectMembership[] = [];
  for (const row of rows) {
    let out = row;
    const pairOwner = pairIds.get(pairKey(row));
    if (pairOwner !== undefined && pairOwner !== row.id) {
      const taken =
        pairOwner === row.id || // unreachable, kept for clarity
        next.some((candidate) => candidate.id === pairOwner) ||
        rows.some((candidate) => candidate.id === pairOwner);
      if (taken) {
        // Corrupt input: the remote id is already used locally for another
        // row — drop the twin; the pull adopts the remote copy.
        changed = true;
        continue;
      }
      out = { ...row, id: pairOwner };
    }
    if (out.route !== null) {
      const routeOwner = routeIds.get(`${out.projectId}\u0000${out.route}`);
      if (routeOwner !== undefined && routeOwner !== out.id) {
        out = { ...out, route: null, updatedAt: now };
      }
    }
    if (out !== row) changed = true;
    next.push(out);
  }
  if (!changed) return;
  cache = next;
  persist();
}
