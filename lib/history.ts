import type { Spec } from "@json-render/core";

export const STORAGE_KEY = "genui-playground-history";
const MAX_ENTRIES = 50;
const EMPTY_HISTORY: HistoryEntry[] = [];

export interface HistoryEntry {
  id: string;
  prompt: string;
  spec: Spec;
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

function readFromStorage(): HistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_HISTORY;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY_HISTORY;
    const entries = parsed.filter(isValidEntry).slice(0, MAX_ENTRIES);
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

export function createEntry(prompt: string, spec: Spec): HistoryEntry {
  return {
    id: crypto.randomUUID(),
    prompt,
    spec,
    createdAt: Date.now(),
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
