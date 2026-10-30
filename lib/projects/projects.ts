/**
 * Project entity (plan 061, A1): a named group for the screens (history
 * entries) of one app — one project = one multi-screen UI in the making.
 *
 * **Local-only in v1** (061 Q1, 2026-10-29): a module store backed by
 * localStorage, no supabase table and no second sync loop — cross-device
 * project sync is follow-up F17. Entries reference a project through
 * `HistoryEntry.projectId`; entries without one (or with a dangling id after a
 * project is deleted) group under the "no project" bucket.
 *
 * Follows the module-store pattern (`playground/model-store.ts`,
 * `editor/templates.ts`): `getServerProjects()`/`getServerActiveProjectId()`
 * return the SSR-safe defaults so hydration never mismatches, and
 * localStorage is best-effort (quota/unavailable → store lives for the
 * session).
 */

import { clearProjectFromEntries } from "@/lib/history";

export const PROJECT_STORAGE_KEY = "genui-projects";
export const ACTIVE_PROJECT_STORAGE_KEY = "genui-active-project";

export interface Project {
  id: string;
  name: string;
  /**
   * URL namespace segment (plan 061-3, decision 9): `/{locale}/{slug}` is
   * this project's route root — the home screen serves the bare segment and
   * in-project routes (`/pokedex/4`) resolve below it. Derived from the name
   * (NFD + diacritics stripped, "Pokédex" → "pokedex"), unique-ified within
   * the store, re-derived on rename. Device-local like the rest of the
   * entity (F17 would sync it).
   */
  slug: string;
  createdAt: number;
  /** Last rename — the timestamp grouping headers sort/refresh on. */
  updatedAt: number;
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
 * so an unchanged name never bumps itself.
 */
function uniqueSlug(
  wanted: string,
  projects: readonly Project[],
  ignoreId?: string,
): string {
  const taken = new Set(
    projects.filter((project) => project.id !== ignoreId).map((p) => p.slug),
  );
  if (!taken.has(wanted)) return wanted;
  let suffix = 2;
  while (taken.has(`${wanted}-${suffix}`)) suffix += 1;
  return `${wanted}-${suffix}`;
}

/**
 * Drop anything that doesn't parse as a project — corrupt entries never
 * reach the UI — and backfill the route slug: a stored pre-061-3 project has
 * none (derived here from its name, unique-ified across the batch).
 */
function sanitize(raw: unknown): Project[] {
  if (!Array.isArray(raw)) return EMPTY;
  const seen: Project[] = [];
  return raw.filter(isValidProject).map((stored) => {
    const project = stored as Project & { slug?: unknown };
    const wanted =
      typeof project.slug === "string" && project.slug !== ""
        ? project.slug
        : slugifyProjectName(project.name);
    const slug = uniqueSlug(wanted, seen);
    const next: Project = {
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      updatedAt:
        typeof project.updatedAt === "number"
          ? project.updatedAt
          : project.createdAt,
      slug,
    };
    seen.push(next);
    return next;
  });
}

function readStored(): Project[] {
  try {
    const stored = window.localStorage.getItem(PROJECT_STORAGE_KEY);
    if (!stored) return EMPTY;
    return sanitize(JSON.parse(stored));
  } catch {
    // Unreadable/corrupt value — fall back to an empty project list.
    return EMPTY;
  }
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
 * Empty names are rejected (`null`, no-op).
 */
export function createProject(name: string): Project | null {
  const trimmed = name.trim();
  if (trimmed === "") return null;
  const now = Date.now();
  const existing = load();
  const project: Project = {
    id: crypto.randomUUID(),
    name: trimmed,
    slug: uniqueSlug(slugifyProjectName(trimmed), existing),
    createdAt: now,
    updatedAt: now,
  };
  cache = [...existing, project];
  persist();
  setActiveProjectId(project.id);
  return project;
}

/**
 * Rename a project — the slug is **re-derived** from the new name (061-3:
 * the URL namespace follows the project), unique-ified against the others so
 * a rename can never steal a live namespace. Empty names, unchanged names
 * and unknown ids are no-ops.
 */
export function renameProject(id: string, name: string): void {
  const trimmed = name.trim();
  const projects = load();
  const target = projects.find((project) => project.id === id);
  if (trimmed === "" || !target || target.name === trimmed) return;
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
 * Removes a project. Its entries survive and fall back to the "no project"
 * bucket (`clearProjectFromEntries`), and the project is deactivated when it
 * was the active one. Unknown ids are a no-op.
 */
export function removeProject(id: string): void {
  const projects = load();
  if (!projects.some((project) => project.id === id)) return;
  cache = projects.filter((project) => project.id !== id);
  persist();
  if (loadActive() === id) setActiveProjectId(null);
  clearProjectFromEntries(id);
}

/** Selects the project new screens are created into. Unknown ids are a no-op. */
export function setActiveProjectId(id: string | null): void {
  if (id !== null && !load().some((project) => project.id === id)) return;
  if (loadActive() === id) return;
  activeCache = id;
  activeLoaded = true;
  persistActive();
}
