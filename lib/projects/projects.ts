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

/** Drop anything that doesn't parse as a project — corrupt entries never reach the UI. */
function sanitize(raw: unknown): Project[] {
  if (!Array.isArray(raw)) return EMPTY;
  return raw.filter(isValidProject);
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
  const project: Project = {
    id: crypto.randomUUID(),
    name: trimmed,
    createdAt: now,
    updatedAt: now,
  };
  cache = [...load(), project];
  persist();
  setActiveProjectId(project.id);
  return project;
}

/** Rename a project. Empty names, unchanged names and unknown ids are no-ops. */
export function renameProject(id: string, name: string): void {
  const trimmed = name.trim();
  const projects = load();
  const target = projects.find((project) => project.id === id);
  if (trimmed === "" || !target || target.name === trimmed) return;
  cache = projects.map((project) =>
    project.id === id
      ? { ...project, name: trimmed, updatedAt: Date.now() }
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
