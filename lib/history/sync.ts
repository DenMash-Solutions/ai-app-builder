import {
  applyRemoteEntry,
  getHistory,
  normalizeEntry,
  subscribeHistory,
} from "./history";
import type { HistoryEntry, SpecRevision } from "./history";

/**
 * Local-first account sync (plan Q7): localStorage stays the working copy;
 * when a session exists we debounce-and-push entry changes to `uis` and merge
 * on start with last-write-wins (`updatedAt` vs `updated_at`). Fire-and-
 * forget — the app never blocks on Supabase.
 */

export type SyncStatus = "idle" | "syncing" | "saved" | "offline";

interface QueryResult {
  error: { message: string } | null;
}
interface SelectResult extends QueryResult {
  data: unknown[] | null;
}

/** The slice of the Supabase client sync uses — mockable in tests. */
interface UisTable {
  select(columns?: string): PromiseLike<SelectResult>;
  upsert(rows: Record<string, unknown>[]): PromiseLike<QueryResult>;
  delete(): { in(column: string, ids: string[]): PromiseLike<QueryResult> };
}
export interface SyncClient {
  from(table: string): UisTable;
}

let status: SyncStatus = "idle";
const statusListeners = new Set<() => void>();
let activeFlush: (() => void) | null = null;

export function getSyncStatus(): SyncStatus {
  return status;
}

/** Forces an immediate push outside the debounce — the "Upload now" action. */
export function flushSync(): void {
  activeFlush?.();
}

export function subscribeSyncStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

function setStatus(next: SyncStatus): void {
  if (next === status) return;
  status = next;
  for (const listener of statusListeners) listener();
}

interface UisRow {
  id: string;
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
    typeof row.name === "string" &&
    typeof row.slug === "string" &&
    typeof row.created_at === "string" &&
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

/**
 * Starts syncing for a session: one full merge (download account copies that
 * are newer or unknown, upload local winners), then a debounced push on every
 * history change until the returned stop function is called.
 */
export function startSync(
  client: SyncClient,
  ownerId: string,
  options: { debounceMs?: number } = {},
): () => void {
  const debounceMs = options.debounceMs ?? 800;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let syncedIds = new Set<string>();
  let chain: Promise<void> = Promise.resolve();

  const isOnline = () =>
    typeof navigator === "undefined" || navigator.onLine !== false;

  /** Download remote-only / remote-newer entries (LWW). */
  async function pull(): Promise<void> {
    const { data, error } = await client.from("uis").select("*");
    if (stopped || error) return;
    for (const raw of data ?? []) {
      if (!isUisRow(raw)) continue;
      const remote = rowToEntry(raw);
      const local = getHistory().find((entry) => entry.id === remote.id);
      if (!local || remote.updatedAt > local.updatedAt) {
        applyRemoteEntry(remote);
      }
    }
  }

  /** Upload local winners, delete rows removed locally since the last sync. */
  async function push(): Promise<void> {
    if (!isOnline()) {
      setStatus("offline");
      return;
    }
    setStatus("syncing");
    const local = getHistory();
    const localIds = new Set(local.map((entry) => entry.id));

    // Only rows the remote copy is missing or older than — never clobber a
    // fresher write from another device.
    const { data, error } = await client.from("uis").select("*");
    if (stopped) return;
    if (error) {
      setStatus("offline");
      return;
    }
    const remoteById = new Map(
      (data ?? []).filter(isUisRow).map((row) => [row.id, row]),
    );
    const payload = local
      .filter((entry) => {
        const remote = remoteById.get(entry.id);
        // Missing remotely, or local write not older than the remote copy —
        // never clobber a fresher write from another device.
        return !remote || entry.updatedAt >= Date.parse(remote.updated_at);
      })
      .map((entry) => entryToRow(entry, ownerId));

    if (payload.length > 0) {
      const { error: upsertError } = await client.from("uis").upsert(payload);
      if (stopped) return;
      if (upsertError) {
        setStatus("offline");
        return;
      }
    }

    const removed = [...syncedIds].filter((id) => !localIds.has(id));
    if (removed.length > 0) {
      const { error: deleteError } = await client
        .from("uis")
        .delete()
        .in("id", removed);
      if (stopped) return;
      if (deleteError) {
        setStatus("offline");
        return;
      }
    }

    syncedIds = localIds;
    setStatus("saved");
  }

  async function run(): Promise<void> {
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
  activeFlush = flush;

  setStatus("syncing");
  chain = chain.then(() => run());

  const unsubscribeHistory = subscribeHistory(schedule);
  const handleOnline = () => schedule();
  const handleOffline = () => setStatus("offline");
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
    unsubscribeHistory();
    if (activeFlush === flush) activeFlush = null;
    if (canListen) {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    }
    setStatus("idle");
  };
}
