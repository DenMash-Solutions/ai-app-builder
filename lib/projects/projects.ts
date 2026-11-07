/**
 * Project entity (plan 061, A1): a named group for the screens (history
 * entries) of one app — one project = one multi-screen UI in the making.
 *
 * **Account-synced since plan 064**: the module store stays localStorage-
 * backed (local-first), and a second sync loop in `lib/history/sync.ts`
 * mirrors rows into the `projects` table under plain LWW (`updatedAt` vs
 * `updated_at`) — local uuids upload as-is, so `HistoryEntry.projectId`
 * never needs remapping. Entries reference a project through
 * `HistoryEntry.projectId`; entries without one (or with a dangling id after a
 * project is deleted) group under the "no project" bucket.
 *
 * Follows the module-store pattern (`playground/model-store.ts`,
 * `editor/templates.ts`): `getServerProjects()`/`getServerActiveProjectId()`
 * return the SSR-safe defaults so hydration never mismatches, and
 * localStorage is best-effort (quota/unavailable → store lives for the
 * session).
 */

import {
  clearProjectFromEntries,
  createEntry,
  type HistoryEntry,
} from "@/lib/history";
import { purgeProjectData } from "@/lib/projects/purge-data";
import { isReservedRoute } from "@/lib/routes/registry";
import type { Spec } from "@json-render/core";

export const PROJECT_STORAGE_KEY = "genui-projects";
export const ACTIVE_PROJECT_STORAGE_KEY = "genui-active-project";
/**
 * Ids deleted locally whose remote row may still exist (plan 073). Without
 * it the sync loop's pull re-adopts a just-deleted project before its delete
 * pass runs — a template preview would come back after Discard. Persisted so
 * a reload before the delete lands does not resurrect the row either.
 */
export const PROJECT_DELETIONS_STORAGE_KEY = "genui-project-deletions";

export interface Project {
  id: string;
  name: string;
  /**
   * URL namespace segment (plan 061-3, decision 9): `/{locale}/{slug}` is
   * this project's route root — the home screen serves the bare segment and
   * in-project routes (`/pokedex/4`) resolve below it. Derived from the name
   * (NFD + diacritics stripped, "Pokédex" → "pokedex"), unique-ified within
   * the store, re-derived on rename. Synced like the rest of the entity
   * (064): `unique (owner_id, slug)` is the DB arbiter, so a local holder of
   * a slug another device already pushed gets bumped at adoption/push time
   * (`applyRemoteProject` / `reconcileProjectSlugs`).
   */
  slug: string;
  createdAt: number;
  /** Last rename — the timestamp grouping headers sort/refresh on. */
  updatedAt: number;
  /**
   * Shared `/session` value (061-4, A3 decision 5): seeded into every
   * member screen's initial state under the `session` key and written
   * through (debounced) by `<SessionSync>`, so a value set on one screen is
   * readable on the next. Screen-local state (drafts, pagination, open
   * dialogs) never lives here. Backfilled to `{}` for stored projects.
   */
  state: Record<string, unknown>;
  /**
   * The member screen that serves the bare `/{locale}/{slug}` namespace
   * (plan 065, decision 5) — EXPLICIT, never derived from creation order.
   * Absent/unknown = the project has no root entry point (the bare
   * namespace 404s). Seeded when empty by the first membership
   * (`addScreenToProject` / first-load backfill — decision 13), changed
   * only through `setProjectHomeScreenId` afterwards; removing the home
   * screen clears it rather than reassigning. Synced as
   * `projects.home_screen_id` (065 amends 064's "server-side fact" note).
   */
  homeScreenId?: string | null;
}

const EMPTY: Project[] = [];

function isValidProject(value: unknown): value is Project {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Project>;
  return (
    typeof candidate.id === "string" &&
    candidate.id !== "" &&
    typeof candidate.name === "string" &&
    candidate.name.trim() !== "" &&
    typeof candidate.createdAt === "number"
  );
}

/**
 * The shared `/session` value must be a plain JSON object to be stored —
 * a spec that writes a non-object to `session` never persists (061 A3:
 * write-through is object-shaped by design).
 */
function isSessionState(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The URL segment for a project name: NFD-normalized (so "Pokédex" →
 * "pokedex"), lowercased, non-alphanumerics collapsed to `-`, trimmed.
 * Unsluggable names collapse to `project` — a slug is never empty.
 */
export function slugifyProjectName(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "project" : slug;
}

/**
 * Make a slug collision-free within the store: `pokedex`, `pokedex-2`,
 * `pokedex-3`… — the project being renamed keeps its own slug (`ignoreId`),
 * so an unchanged name never bumps itself. `extraTaken` adds slugs owned by
 * OTHER sources (remote rows, 064) to the avoided set — a bumped suffix must
 * satisfy the DB's `unique (owner_id, slug)`, not just the local store.
 *
 * Reserved segments are never claimable (064): `admin` is shadowed by the
 * admin route, so the suffix loop skips both taken AND reserved candidates —
 * which also heals a stored/adopted legacy `admin` row to `admin-2` through
 * the sanitizer, adoption and reconcile paths.
 */
function uniqueSlug(
  wanted: string,
  projects: readonly Project[],
  ignoreId?: string,
  extraTaken: ReadonlySet<string> = new Set(),
): string {
  const taken = new Set(
    projects.filter((project) => project.id !== ignoreId).map((p) => p.slug),
  );
  for (const slug of extraTaken) taken.add(slug);
  const isFree = (slug: string): boolean =>
    !taken.has(slug) && !isReservedRoute(slug);
  if (isFree(wanted)) return wanted;
  let suffix = 2;
  while (!isFree(`${wanted}-${suffix}`)) suffix += 1;
  return `${wanted}-${suffix}`;
}

/**
 * The rejection reason a project NAME earns at create/rename time, or null
 * when it is acceptable (064) — the UI-facing predicate: callers check it
 * BEFORE writing so a reserved name shows an i18n error and keeps the input
 * open, while the store rejects the same names as defense in depth. Only the
 * derived slug matters: the name is free text, but a name whose slug lands on
 * a reserved segment is rejected rather than silently re-suffixed.
 */
export function projectNameError(name: string): "reserved" | null {
  return isReservedRoute(slugifyProjectName(name)) ? "reserved" : null;
}

/**
 * Drop anything that doesn't parse as a project — corrupt entries never
 * reach the UI — and backfill the route slug: a stored pre-061-3 project has
 * none (derived here from its name, unique-ified across the batch).
 *
 * Exported (064) as the sanitization discipline for REMOTE rows too: the
 * sync mappers run candidate rows through this before they touch the store,
 * so a partial/corrupt account copy behaves exactly like corrupt storage.
 */
export function sanitizeProjects(raw: unknown): Project[] {
  if (!Array.isArray(raw)) return EMPTY;
  const seen: Project[] = [];
  return raw.filter(isValidProject).map((stored) => {
    const project = stored as Project & { slug?: unknown };
    const wanted =
      typeof project.slug === "string" && project.slug !== ""
        ? project.slug
        : slugifyProjectName(project.name);
    const slug = uniqueSlug(wanted, seen);
    // Home screen (065 decision 5): a valid string rides through; anything
    // else (absent, null, junk) normalizes to ABSENT — "no home". The seed
    // paths (decision 13) treat absent and cleared identically, so the
    // distinction never needs to survive a round trip.
    const homeScreenId =
      typeof project.homeScreenId === "string" && project.homeScreenId !== ""
        ? project.homeScreenId
        : undefined;
    const next: Project = {
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      updatedAt:
        typeof project.updatedAt === "number"
          ? project.updatedAt
          : project.createdAt,
      slug,
      // Older stored projects (pre-061-4) carry no shared state.
      state: isSessionState(project.state) ? project.state : {},
      ...(homeScreenId !== undefined ? { homeScreenId } : {}),
    };
    seen.push(next);
    return next;
  });
}

function readStored(): Project[] {
  try {
    const stored = window.localStorage.getItem(PROJECT_STORAGE_KEY);
    if (!stored) return EMPTY;
    return sanitizeProjects(JSON.parse(stored));
  } catch {
    // Unreadable/corrupt value — fall back to an empty project list.
    return EMPTY;
  }
}

/** Ids of projects deleted locally whose remote delete is still pending. */
function readStoredDeletions(): Set<string> {
  try {
    const stored = window.localStorage.getItem(PROJECT_DELETIONS_STORAGE_KEY);
    if (!stored) return new Set();
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

function writeStoredDeletions(ids: ReadonlySet<string>): void {
  try {
    if (ids.size === 0) {
      window.localStorage.removeItem(PROJECT_DELETIONS_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(
      PROJECT_DELETIONS_STORAGE_KEY,
      JSON.stringify([...ids]),
    );
  } catch {
    // Best-effort — the in-memory set still guards this session.
  }
}

let pendingDeletions: Set<string> | null = null;

function deletions(): Set<string> {
  if (pendingDeletions === null) pendingDeletions = readStoredDeletions();
  return pendingDeletions;
}

/** True while `id` awaits its remote delete (the pull must not re-adopt it). */
export function isProjectDeletionPending(id: string): boolean {
  return deletions().has(id);
}

/** Ids whose remote delete is still outstanding (the delete pass pushes
 *  them even when they never reached `syncedIds` this session — a preview
 *  discarded before its row was re-pulled is exactly that case, plan 073). */
export function getProjectDeletions(): string[] {
  return [...deletions()];
}

/** The delete pass removed these remotely — stop guarding them. */
export function clearProjectDeletions(ids: readonly string[]): void {
  const current = deletions();
  let changed = false;
  for (const id of ids) changed = current.delete(id) || changed;
  if (changed) writeStoredDeletions(current);
}

function readStoredActive(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY);
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();
const activeListeners = new Set<() => void>();

/**
 * Shared-session write recency (061-4, Activity races): every value carries
 * a stamp from this realm-wide monotonic clock, and the store remembers the
 * stamp of the last accepted value per project — a write is rejected when
 * its stamp is not strictly newer, so a stale hidden instance's late flush
 * can never overwrite a fresher value regardless of arrival order.
 *
 * Session-only (not persisted): a reload starts a fresh clock, and the
 * in-memory baseline resets with it. Cross-tab writes land through the
 * `storage` event below and reset the baseline to "now" (their own stamps
 * are unknowable here — conservative for v1, local-only projects).
 */
let sessionClock = 0;
const acceptedSessionStamps = new Map<string, number>();

/** Stamp a shared-session VALUE at the moment it is created. */
export function stampSessionValue(): number {
  sessionClock += 1;
  return sessionClock;
}

let cache: Project[] | null = null;
let activeCache: string | null = null;
let activeLoaded = false;

function load(): Project[] {
  if (cache === null)
    cache = typeof window === "undefined" ? EMPTY : readStored();
  return cache;
}

/** The active project id, validated against the store (a stale id reads as "no project"). */
function loadActive(): string | null {
  if (!activeLoaded) {
    const stored = typeof window === "undefined" ? null : readStoredActive();
    activeCache =
      stored !== null && load().some((project) => project.id === stored)
        ? stored
        : null;
    activeLoaded = true;
  }
  return activeCache;
}

/** Client snapshot for `useSyncExternalStore`. */
export function getProjects(): Project[] {
  return load();
}

/** The project whose route namespace is `slug` — preview-route resolution. */
export function projectBySlug(slug: string): Project | null {
  if (slug === "") return null;
  return load().find((project) => project.slug === slug) ?? null;
}

/** Server snapshot — the client re-renders with the stored projects after hydration. */
export function getServerProjects(): Project[] {
  return EMPTY;
}

export function subscribeProjects(listener: () => void): () => void {
  listeners.add(listener);
  ensureStorageListener();
  return () => {
    listeners.delete(listener);
    releaseStorageListener();
  };
}

export function getActiveProjectId(): string | null {
  return loadActive();
}

/** Server snapshot: no active project is rendered during SSR. */
export function getServerActiveProjectId(): string | null {
  return null;
}

export function subscribeActiveProject(listener: () => void): () => void {
  activeListeners.add(listener);
  ensureStorageListener();
  return () => {
    activeListeners.delete(listener);
    releaseStorageListener();
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}

function notifyActive(): void {
  for (const listener of activeListeners) listener();
}

function persist(): void {
  try {
    window.localStorage.setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify(cache ?? EMPTY),
    );
  } catch {
    // Quota exceeded or storage unavailable — store stays for this session.
  }
  notify();
}

function persistActive(): void {
  try {
    if (activeCache === null) {
      window.localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);
    } else {
      window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, activeCache);
    }
  } catch {
    // Quota exceeded or storage unavailable — selection stays for this session.
  }
  notifyActive();
}

// Cross-tab coherence (same contract as the history store): another tab's
// write to either key is re-read and re-broadcast.
function handleStorageEvent(event: StorageEvent): void {
  if (event.key === PROJECT_STORAGE_KEY || event.key === null) {
    cache = typeof window === "undefined" ? EMPTY : readStored();
    // Cross-tab: the remote content's own stamps are unknowable here, so
    // accept it as "just landed" — future local writes must be newer.
    for (const project of cache) {
      acceptedSessionStamps.set(project.id, sessionClock);
    }
    notify();
  }
  if (event.key === ACTIVE_PROJECT_STORAGE_KEY || event.key === null) {
    const stored = typeof window === "undefined" ? null : readStoredActive();
    activeCache =
      stored !== null && load().some((project) => project.id === stored)
        ? stored
        : null;
    activeLoaded = true;
    notifyActive();
  }
}

function canListen(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.addEventListener === "function"
  );
}

function ensureStorageListener(): void {
  if (listeners.size + activeListeners.size !== 1 || !canListen()) return;
  window.addEventListener("storage", handleStorageEvent);
}

function releaseStorageListener(): void {
  if (listeners.size + activeListeners.size !== 0 || !canListen()) return;
  window.removeEventListener("storage", handleStorageEvent);
}

/**
 * Creates a project and **activates it** (creating means working in it).
 * Empty names and names whose slug lands on a reserved segment (`admin`,
 * `ui`, `login`, `signup` — 064) are rejected (`null`, no-op); the UI shows
 * the reason through `projectNameError` before it ever gets here.
 */
export function createProject(name: string): Project | null {
  const trimmed = name.trim();
  if (trimmed === "" || projectNameError(trimmed) !== null) return null;
  const now = Date.now();
  const existing = load();
  const project: Project = {
    id: crypto.randomUUID(),
    name: trimmed,
    slug: uniqueSlug(slugifyProjectName(trimmed), existing),
    createdAt: now,
    updatedAt: now,
    state: {},
  };
  cache = [...existing, project];
  persist();
  setActiveProjectId(project.id);
  return project;
}

/**
 * Rename a project — the slug is **re-derived** from the new name (061-3:
 * the URL namespace follows the project), unique-ified against the others so
 * a rename can never steal a live namespace. Empty names, unchanged names,
 * unknown ids and reserved-segment names (064) are no-ops.
 */
export function renameProject(id: string, name: string): void {
  const trimmed = name.trim();
  const projects = load();
  const target = projects.find((project) => project.id === id);
  if (trimmed === "" || !target || target.name === trimmed) return;
  if (projectNameError(trimmed) !== null) return;
  cache = projects.map((project) =>
    project.id === id
      ? {
          ...project,
          name: trimmed,
          slug: uniqueSlug(slugifyProjectName(trimmed), projects, id),
          updatedAt: Date.now(),
        }
      : project,
  );
  persist();
}

/**
 * Set (or with null, clear) a project's EXPLICIT home screen — the seam
 * task 4's workspace UI uses (plan 065 decision 5). Unknown ids and
 * unchanged values are no-ops (false = nothing written).
 *
 * Membership of `screenId` is the CALLER's contract (decision 10: validated
 * app-side — `projectHomeScreenId` re-checks membership + existence at
 * resolve time as the backstop); the projects store must not import the
 * membership store (would be a cycle). A change re-stamps `updatedAt`: the
 * projects sync compares LWW timestamps, so a home pick has to travel.
 */
export function setProjectHomeScreenId(
  id: string,
  screenId: string | null,
): boolean {
  const projects = load();
  const index = projects.findIndex((project) => project.id === id);
  if (index === -1) return false;
  if ((projects[index].homeScreenId ?? null) === screenId) return false;
  cache = projects.map((project, i) =>
    i === index
      ? { ...project, homeScreenId: screenId, updatedAt: Date.now() }
      : project,
  );
  persist();
  return true;
}

/**
 * Removes a project. Its entries survive and fall back to the "no project"
 * bucket (`clearProjectFromEntries`), and the project is deactivated when it
 * was the active one. Unknown ids are a no-op.
 */
export function removeProject(id: string): void {
  const projects = load();
  if (!projects.some((project) => project.id === id)) return;
  cache = projects.filter((project) => project.id !== id);
  persist();
  // Guard the row against the sync pull re-adopting it before its delete
  // pass runs (plan 073: a discarded template preview must stay discarded).
  const pending = deletions();
  pending.add(id);
  writeStoredDeletions(pending);
  if (loadActive() === id) setActiveProjectId(null);
  clearProjectFromEntries(id);
  // Plan 067 decision 4: deletion owns the project's data — local rows now,
  // remote `genui_records` best-effort (never blocks or fails the delete).
  void purgeProjectData(id);
}

/** Selects the project new screens are created into. Unknown ids are a no-op. */
export function setActiveProjectId(id: string | null): void {
  if (id !== null && !load().some((project) => project.id === id)) return;
  if (loadActive() === id) return;
  activeCache = id;
  activeLoaded = true;
  persistActive();
}

/**
 * The shared `/session` value for a project — `undefined` when the id is
 * null/unknown (no project, SSR, dangling id). The seed side of 061 A3:
 * surfaces merge this under the `session` key before mounting.
 */
export function getSessionState(
  id: string | null | undefined,
): Record<string, unknown> | undefined {
  if (!id) return undefined;
  return load().find((project) => project.id === id)?.state;
}

/**
 * The write-through side of 061 A3: replaces the project's shared `/session`
 * value. No-ops on unknown ids, on non-object values (the session subtree is
 * an object by design), on content identical to what is stored (the seed
 * echo after mount writes nothing), and on stamps that are not strictly
 * newer than the last accepted write (stale-writer guard above). Stringify
 * equality matches how the value round-trips through localStorage. Returns
 * whether the write landed.
 *
 * An accepted write bumps `updatedAt` (064 decision 2): `/session` syncs
 * under plain LWW and the merge compares timestamps — a state change that
 * didn't move the stamp would be invisible to the other device's pull. This
 * supersedes 061's "updatedAt stays rename-owned" note; rename still bumps
 * it too.
 */
export function setSessionState(
  id: string,
  next: unknown,
  stamp: number,
): boolean {
  if (!isSessionState(next)) return false;
  const projects = load();
  const index = projects.findIndex((project) => project.id === id);
  if (index === -1) return false;
  if (JSON.stringify(projects[index].state) === JSON.stringify(next))
    return false;
  const accepted = acceptedSessionStamps.get(id) ?? 0;
  if (stamp <= accepted) return false;
  acceptedSessionStamps.set(id, stamp);
  cache = projects.map((project, i) =>
    i === index ? { ...project, state: next, updatedAt: Date.now() } : project,
  );
  persist();
  return true;
}

/**
 * Insert-or-replace preserving the project's own timestamps — the account-
 * sync write path (064), mirroring `applyRemoteEntry`: the sync loop has
 * already decided LWW (remote newer or unknown) before calling.
 *
 * Adoption-time slug collision under the same owner (decision 5): the
 * incoming remote row is the DB-constraint truth (`unique (owner_id, slug)`),
 * so a LOCAL holder of the same slug yields — bumped via `uniqueSlug`, never
 * dropped; both projects are kept. The adopted row also joins the session-
 * stamp baseline (like a cross-tab write), so a late stale `/session` flush
 * from this realm can't clobber the freshly adopted shared state.
 */
export function applyRemoteProject(remote: Project): void {
  // A locally deleted project is gone by intent — the pull must not bring it
  // back while the delete pass is still on its way.
  if (isProjectDeletionPending(remote.id)) return;
  const projects = load();
  const adoptedSlugs = new Set([remote.slug]);
  const next = projects.map((project) => {
    if (project.id === remote.id || project.slug !== remote.slug) {
      return project;
    }
    return {
      ...project,
      slug: uniqueSlug(project.slug, projects, project.id, adoptedSlugs),
      updatedAt: Date.now(),
    };
  });
  const exists = next.some((project) => project.id === remote.id);
  cache = exists
    ? next.map((project) => (project.id === remote.id ? remote : project))
    : [...next, remote];
  acceptedSessionStamps.set(remote.id, sessionClock);
  persist();
}

/**
 * Push-time slug reconcile (064 decision 5): every local project holding a
 * slug that a REMOTE row of a different id owns is bumped via `uniqueSlug`
 * against the union of local and remote slugs — never dropped, so the
 * upsert can never trip `unique (owner_id, slug)` from a stale local
 * namespace. Runs inside the sync loop's push, before the payload is built.
 *
 * Bumps re-stamp `updatedAt` (a slug change is a rename) and persist, which
 * re-schedules that loop's debounced push — the second pass finds nothing
 * left to bump (idempotent).
 */
export function reconcileProjectSlugs(
  remote: readonly { id: string; slug?: string }[],
): void {
  const remoteRows: { id: string; slug: string }[] = [];
  const taken = new Set<string>();
  for (const row of remote) {
    if (typeof row.slug === "string" && row.slug !== "") {
      remoteRows.push({ id: row.id, slug: row.slug });
      taken.add(row.slug);
    }
  }
  if (remoteRows.length === 0) return;
  const projects = load();
  let changed = false;
  const next = projects.map((project) => {
    const takenByAnother = remoteRows.some(
      (row) => row.id !== project.id && row.slug === project.slug,
    );
    if (!takenByAnother) return project;
    changed = true;
    const slug = uniqueSlug(project.slug, projects, project.id, taken);
    // Later bumps must avoid this one's new suffix too.
    taken.add(slug);
    return { ...project, slug, updatedAt: Date.now() };
  });
  if (!changed) return;
  cache = next;
  persist();
}

/**
 * Create a history entry stamped with the **active** project (061 A3): both
 * creation seams — generation and JSON import — route through here, so
 * "screens are born into the project you are working in" is one testable
 * rule instead of two call sites that can drift.
 */
export function createProjectEntry(prompt: string, spec: Spec): HistoryEntry {
  return createEntry(prompt, spec, getActiveProjectId() ?? undefined);
}
