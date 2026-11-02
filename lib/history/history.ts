import type { Spec } from "@json-render/core";
import { i18nMissingTags } from "@/lib/i18n/spec-coverage";
import { uniqueSlugFrom } from "@/lib/slug";

export const STORAGE_KEY = "genui-playground-history";
const MAX_ENTRIES = 50;
const MAX_REVISIONS = 10;
const EMPTY_HISTORY: HistoryEntry[] = [];

export const REVISION_LABELS = {
  generate: "generate",
  import: "import",
  prompt: "prompt",
  property: "property",
  action: "action",
  freeform: "freeform",
  structure: "structure",
  /** Catalog-driven content swaps (plan 066 Task 3: install update/rollback
   *  and component re-expansion) — distinct from local structure edits. */
  catalog: "catalog",
} as const;

export interface SpecRevision {
  spec: Spec;
  label: string;
  createdAt: number;
}

export interface HistoryEntry {
  id: string;
  /** Human display name — seeded from the prompt, editable via rename. */
  name: string;
  /** URL slug for the preview route — seeded from the prompt, editable. */
  slug: string;
  prompt: string;
  spec: Spec;
  revisions: SpecRevision[];
  head: number;
  createdAt: number;
  /** Last local mutation — the LWW tie-breaker for account sync. */
  updatedAt: number;
  /**
   * Tags with missing translations at the last spec write — a non-blocking
   * ingest flag (device-local: the `uis` sync rows don't carry it).
   */
  i18nMissing?: string[];
  /**
   * Project grouping (plan 061 A1) — which project of screens this entry
   * belongs to. Device-local like `i18nMissing` (projects are local-only in
   * v1, F17 would sync them): absent on legacy entries, on entries whose
   * project was deleted, and on account-synced copies pulled from `uis`.
   */
  projectId?: string;
}

let cache: HistoryEntry[] | null = null;
const listeners = new Set<() => void>();

function isValidEntry(value: unknown): value is HistoryEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<HistoryEntry>;
  return (
    typeof entry.id === "string" &&
    typeof entry.prompt === "string" &&
    typeof entry.createdAt === "number" &&
    typeof entry.spec === "object" &&
    entry.spec !== null
  );
}

/**
 * Entries written before the name/slug fields get them back-filled (name ←
 * prompt, slug ← the full id, which is already unique and slug-shaped), and
 * entries written before the revisions model (or with corrupt revision data)
 * get a single revision from their stored spec — like git checking out a
 * branch with no history yet. Exported for unit tests.
 */
/**
 * Refresh the non-blocking translation flag after every spec write: the
 * tags with missing translations, absent when coverage is complete.
 */
function withCoverageFlag(entry: HistoryEntry): HistoryEntry {
  const missing = i18nMissingTags(entry.spec.state);
  const next = { ...entry };
  if (missing.length > 0) next.i18nMissing = missing;
  else delete next.i18nMissing;
  return next;
}

export function normalizeEntry(entry: HistoryEntry): HistoryEntry {
  const name =
    typeof entry.name === "string" && entry.name.trim() !== ""
      ? entry.name
      : entry.prompt;
  const slug =
    typeof entry.slug === "string" && entry.slug !== "" ? entry.slug : entry.id;
  const updatedAt =
    typeof entry.updatedAt === "number" ? entry.updatedAt : entry.createdAt;
  // Grouping is optional and must be a real id — a corrupt/non-string value
  // drops the entry back into the "no project" bucket.
  const projectId =
    typeof entry.projectId === "string" && entry.projectId !== ""
      ? entry.projectId
      : undefined;
  const base: HistoryEntry = { ...entry, name, slug, updatedAt };
  if (projectId === undefined) delete base.projectId;
  else base.projectId = projectId;
  const revisions =
    Array.isArray(entry.revisions) && entry.revisions.length > 0
      ? entry.revisions.filter(
          (revision) =>
            revision !== null &&
            typeof revision === "object" &&
            typeof revision.spec === "object" &&
            revision.spec !== null &&
            typeof revision.label === "string" &&
            typeof revision.createdAt === "number",
        )
      : [];

  if (revisions.length === 0) {
    return withCoverageFlag({
      ...base,
      revisions: [
        {
          spec: entry.spec,
          label: REVISION_LABELS.generate,
          createdAt: entry.createdAt,
        },
      ],
      head: 0,
    });
  }

  const head = Math.min(
    Math.max(
      typeof entry.head === "number" ? entry.head : revisions.length - 1,
      0,
    ),
    revisions.length - 1,
  );
  return withCoverageFlag({
    ...base,
    revisions,
    head,
    spec: revisions[head].spec,
  });
}

function readFromStorage(): HistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_HISTORY;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY_HISTORY;
    const entries = parsed
      .filter(isValidEntry)
      .map(normalizeEntry)
      .slice(0, MAX_ENTRIES);
    return entries.length > 0 ? entries : EMPTY_HISTORY;
  } catch {
    return EMPTY_HISTORY;
  }
}

function notify(): void {
  for (const listener of listeners) listener();
}

function handleStorageEvent(event: StorageEvent): void {
  if (event.key === STORAGE_KEY || event.key === null) {
    cache = readFromStorage();
    notify();
  }
}

export function getHistory(): HistoryEntry[] {
  if (cache === null) cache = readFromStorage();
  return cache;
}

export function getServerHistory(): HistoryEntry[] {
  return EMPTY_HISTORY;
}

export function subscribeHistory(listener: () => void): () => void {
  listeners.add(listener);
  if (
    listeners.size === 1 &&
    typeof window !== "undefined" &&
    typeof window.addEventListener === "function"
  ) {
    window.addEventListener("storage", handleStorageEvent);
  }
  return () => {
    listeners.delete(listener);
    if (
      listeners.size === 0 &&
      typeof window !== "undefined" &&
      typeof window.removeEventListener === "function"
    ) {
      window.removeEventListener("storage", handleStorageEvent);
    }
  };
}

function commit(entries: HistoryEntry[]): void {
  cache = entries;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota exceeded or storage unavailable — history stays in memory for this session.
  }
  notify();
}

export function addEntry(entry: HistoryEntry): void {
  // A provided updatedAt belongs to an account-synced copy — keep it so the
  // merge sees the original write time; local creations carry their own now.
  const stamped: HistoryEntry = {
    ...entry,
    updatedAt:
      typeof entry.updatedAt === "number" ? entry.updatedAt : Date.now(),
  };
  commit([stamped, ...getHistory()].slice(0, MAX_ENTRIES));
}

export function removeEntry(id: string): void {
  commit(getHistory().filter((entry) => entry.id !== id));
}

export function clearHistory(): void {
  commit(EMPTY_HISTORY);
}

export function updateEntry(updated: HistoryEntry): void {
  // Local mutation: stamp now — this is the LWW timestamp sync compares.
  commit(
    getHistory().map((entry) =>
      entry.id === updated.id ? { ...updated, updatedAt: Date.now() } : entry,
    ),
  );
}

/**
 * Insert-or-replace preserving the entry's own `updatedAt` — the account-sync
 * write path. Unlike `updateEntry` it never re-stamps: the remote write time
 * is the whole point (LWW decides which copy survives on the next push).
 */
export function applyRemoteEntry(remote: HistoryEntry): void {
  const history = getHistory();
  const exists = history.some((entry) => entry.id === remote.id);
  const next = exists
    ? history.map((entry) => (entry.id === remote.id ? remote : entry))
    : [remote, ...history];
  commit(next.slice(0, MAX_ENTRIES));
}

/**
 * Revisions are point-in-time snapshots: callers hand us spec objects that
 * json-render may later patch in place, so every stored spec must be a clone.
 */
function cloneSpec(spec: Spec): Spec {
  return structuredClone(spec);
}

/**
 * Git-style revision commit: records a snapshot after the current head and
 * drops any redo tail (a new edit after undo abandons the undone branch).
 * The oldest revisions fall off once MAX_REVISIONS is reached.
 */
export function commitRevision(
  entry: HistoryEntry,
  spec: Spec,
  label: string,
): HistoryEntry {
  const snapshot = cloneSpec(spec);
  const kept = entry.revisions.slice(0, entry.head + 1);
  const revisions = [
    ...kept,
    { spec: snapshot, label, createdAt: Date.now() },
  ].slice(-MAX_REVISIONS);
  return withCoverageFlag({
    ...entry,
    revisions,
    head: revisions.length - 1,
    spec: snapshot,
  });
}

/**
 * Replace an entry's spec through the revision stack (plan 063): identity,
 * name, slug and project membership stay untouched, the new content is
 * appended as a revision so the previous one stays undoable, and the write is
 * stamped by `updateEntry` — the LWW timestamp account sync compares.
 * Returns `null` when the id is unknown (the caller keeps the dialog open).
 */
export function replaceEntrySpec(
  id: string,
  spec: Spec,
  label: string,
): HistoryEntry | null {
  const entry = getHistory().find((candidate) => candidate.id === id);
  if (!entry) return null;
  const next = commitRevision(entry, spec, label);
  updateEntry(next);
  return next;
}

/***
 * Checks the head out one revision older, returning the entry with that
 * revision's spec. Returns the entry unchanged when there is nothing to undo.
 */
export function undoRevision(entry: HistoryEntry): HistoryEntry {
  if (!canUndo(entry)) return entry;
  const head = entry.head - 1;
  return withCoverageFlag({
    ...entry,
    head,
    spec: entry.revisions[head].spec,
  });
}

/**
 * Re-applies the revision after the head, returning the entry with that
 * revision's spec. Returns the entry unchanged when there is nothing to redo.
 */
export function redoRevision(entry: HistoryEntry): HistoryEntry {
  if (!canRedo(entry)) return entry;
  const head = entry.head + 1;
  return withCoverageFlag({
    ...entry,
    head,
    spec: entry.revisions[head].spec,
  });
}

/** Whether an older revision can be checked out. */
export function canUndo(entry: HistoryEntry): boolean {
  return entry.head > 0;
}

/** Whether a newer (undone) revision can be re-applied. */
export function canRedo(entry: HistoryEntry): boolean {
  return entry.head < entry.revisions.length - 1;
}

export function createEntry(
  prompt: string,
  spec: Spec,
  /** Project grouping (061 A1) — omitted when nothing is active (legacy bucket). */
  projectId?: string,
): HistoryEntry {
  const createdAt = Date.now();
  const snapshot = cloneSpec(spec);
  const id = crypto.randomUUID();
  return withCoverageFlag({
    id,
    name: prompt,
    slug: uniqueSlugFrom(prompt, id),
    prompt,
    spec: snapshot,
    revisions: [{ spec: snapshot, label: REVISION_LABELS.generate, createdAt }],
    head: 0,
    createdAt,
    updatedAt: createdAt,
    ...(projectId ? { projectId } : {}),
  });
}

/**
 * Copy an existing screen into a NEW one (plan 065 decision 3): same
 * prompt and spec snapshot, but a FRESH identity — new id, a slug that can
 * never collide (`uniqueSlugFrom` tails the id) and **revision 0** (a single
 * fresh revision; the copy never inherits the source's history). Stamped
 * with the destination project when given, otherwise the "no project"
 * bucket. Returns the added entry.
 */
export function copyEntry(
  source: HistoryEntry,
  projectId?: string,
): HistoryEntry {
  const createdAt = Date.now();
  const id = crypto.randomUUID();
  const snapshot = cloneSpec(source.spec);
  const entry = withCoverageFlag({
    id,
    name: source.name,
    slug: uniqueSlugFrom(source.name, id),
    prompt: source.prompt,
    spec: snapshot,
    revisions: [{ spec: snapshot, label: REVISION_LABELS.generate, createdAt }],
    head: 0,
    createdAt,
    updatedAt: createdAt,
    ...(projectId ? { projectId } : {}),
  });
  addEntry(entry);
  return entry;
}

/**
 * Re-stamp (or with undefined/empty, clear) an entry's device-local project
 * pointer (plan 065 decision 12): remove/move keep the pointer aligned with
 * the membership rows, so the idempotent membership backfill never
 * re-adds a membership the user removed. No `updatedAt` stamp — the pointer
 * is device-local (`uis` rows carry no project column), so there is nothing
 * to sync. Unknown ids and unchanged pointers are no-ops.
 */
export function setEntryProject(id: string, projectId?: string): void {
  const history = getHistory();
  const target = history.find((entry) => entry.id === id);
  if (!target) return;
  const next =
    projectId === undefined || projectId === "" ? undefined : projectId;
  if ((target.projectId ?? undefined) === next) return;
  commit(
    history.map((entry) => {
      if (entry.id !== id) return entry;
      const updated: HistoryEntry = { ...entry };
      if (next === undefined) delete updated.projectId;
      else updated.projectId = next;
      return updated;
    }),
  );
}

/**
 * Drops the grouping from every entry that references a deleted project —
 * the entries themselves are kept and fall back to the "no project" bucket
 * (061 A1; called by `removeProject`).
 */
export function clearProjectFromEntries(projectId: string): void {
  const history = getHistory();
  if (!history.some((entry) => entry.projectId === projectId)) return;
  commit(
    history.map((entry) => {
      if (entry.projectId !== projectId) return entry;
      const ungrouped: HistoryEntry = { ...entry };
      delete ungrouped.projectId;
      return ungrouped;
    }),
  );
}

export type TranslateFn = (
  key: string,
  values?: Record<string, string | number>,
) => string;

export function formatRelativeTime(
  timestamp: number,
  t: TranslateFn,
  locale: string,
): string {
  const elapsed = Date.now() - timestamp;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (elapsed < minute) return t("historyDrawer.relativeTime.now");
  if (elapsed < hour) {
    return t("historyDrawer.relativeTime.minutes", {
      n: Math.floor(elapsed / minute),
    });
  }
  if (elapsed < day) {
    return t("historyDrawer.relativeTime.hours", {
      n: Math.floor(elapsed / hour),
    });
  }
  if (elapsed < 7 * day) {
    return t("historyDrawer.relativeTime.days", {
      n: Math.floor(elapsed / day),
    });
  }
  return new Date(timestamp).toLocaleDateString(locale);
}
