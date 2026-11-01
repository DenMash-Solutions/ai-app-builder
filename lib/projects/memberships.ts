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

import { getHistory } from "@/lib/history";
import { getProjects } from "@/lib/projects/projects";

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
): { rows: ProjectMembership[]; changed: boolean } {
  const projectIds = new Set(projects.map((project) => project.id));
  const held = new Set(
    memberships.map((row) => `${row.projectId}\u0000${row.screenId}`),
  );
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
  if (added.length === 0) return { rows: memberships, changed: false };
  return { rows: [...memberships, ...added], changed: true };
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
  return membership;
}

/**
 * Remove a screen from ONE project (decision 3: membership only — the
 * screen survives in its other projects and in history). Unknown pairs are a
 * no-op (false).
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
  persist();
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
