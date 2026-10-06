import type { Spec } from "@json-render/core";

export const STORAGE_KEY = "genui-playground-history";
const MAX_ENTRIES = 50;
const MAX_REVISIONS = 10;
const EMPTY_HISTORY: HistoryEntry[] = [];

export const REVISION_LABELS = {
  generate: "generate",
  prompt: "prompt",
  property: "property",
  action: "action",
  freeform: "freeform",
  structure: "structure",
} as const;

export interface SpecRevision {
  spec: Spec;
  label: string;
  createdAt: number;
}

export interface HistoryEntry {
  id: string;
  prompt: string;
  spec: Spec;
  revisions: SpecRevision[];
  head: number;
  createdAt: number;
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
 * Entries written before the revisions model (or with corrupt revision data)
 * get a single revision from their stored spec — like git checking out a
 * branch with no history yet.
 */
function normalizeEntry(entry: HistoryEntry): HistoryEntry {
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
    return {
      ...entry,
      revisions: [
        {
          spec: entry.spec,
          label: REVISION_LABELS.generate,
          createdAt: entry.createdAt,
        },
      ],
      head: 0,
    };
  }

  const head = Math.min(
    Math.max(
      typeof entry.head === "number" ? entry.head : revisions.length - 1,
      0,
    ),
    revisions.length - 1,
  );
  return { ...entry, revisions, head, spec: revisions[head].spec };
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
  if (listeners.size === 1) {
    window.addEventListener("storage", handleStorageEvent);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
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
  commit([entry, ...getHistory()].slice(0, MAX_ENTRIES));
}

export function removeEntry(id: string): void {
  commit(getHistory().filter((entry) => entry.id !== id));
}

export function clearHistory(): void {
  commit(EMPTY_HISTORY);
}

export function updateEntry(updated: HistoryEntry): void {
  commit(
    getHistory().map((entry) => (entry.id === updated.id ? updated : entry)),
  );
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
  return { ...entry, revisions, head: revisions.length - 1, spec: snapshot };
}

/**
 * Checks the head out one revision older, returning the entry with that
 * revision's spec. Returns the entry unchanged when there is nothing to undo.
 */
export function undoRevision(entry: HistoryEntry): HistoryEntry {
  if (!canUndo(entry)) return entry;
  const head = entry.head - 1;
  return { ...entry, head, spec: entry.revisions[head].spec };
}

/**
 * Re-applies the revision after the head, returning the entry with that
 * revision's spec. Returns the entry unchanged when there is nothing to redo.
 */
export function redoRevision(entry: HistoryEntry): HistoryEntry {
  if (!canRedo(entry)) return entry;
  const head = entry.head + 1;
  return { ...entry, head, spec: entry.revisions[head].spec };
}

/** Whether an older revision can be checked out. */
export function canUndo(entry: HistoryEntry): boolean {
  return entry.head > 0;
}

/** Whether a newer (undone) revision can be re-applied. */
export function canRedo(entry: HistoryEntry): boolean {
  return entry.head < entry.revisions.length - 1;
}

export function createEntry(prompt: string, spec: Spec): HistoryEntry {
  const createdAt = Date.now();
  const snapshot = cloneSpec(spec);
  return {
    id: crypto.randomUUID(),
    prompt,
    spec: snapshot,
    revisions: [{ spec: snapshot, label: REVISION_LABELS.generate, createdAt }],
    head: 0,
    createdAt,
  };
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
