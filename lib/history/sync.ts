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

/** The slice of the Supabase client sync uses — mockable in tests.
 *  `select` returns a thenable builder: sync adds `.eq`/`.in` filters
 *  before awaiting (plan 055 A: column-slimmed, owner-filtered pulls). */
export interface SelectBuilder extends PromiseLike<SelectResult> {
  eq(column: string, value: unknown): SelectBuilder;
  in(column: string, values: unknown[]): SelectBuilder;
}
interface UisTable {
  select(columns?: string): SelectBuilder;
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

/** The slim compare-row pull's phase 1 returns (plan 055 A). */
interface SlimRow {
  id: string;
  owner_id: string;
  updated_at: string;
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

  /** Download remote-only / remote-newer entries (LWW).
   *
   *  Two-phase (plan 055 A): phase 1 fetches only `id, owner_id,
   *  updated_at` with a server-side owner filter — the LWW decision needs
   *  nothing else; phase 2 pulls full rows (`revisions` included) solely
   *  for ids that actually win the compare. Same merge semantics as the
   *  old single full-table `select("*")`. */
  async function pull(): Promise<void> {
    const slim = await client
      .from("uis")
      .select("id, owner_id, updated_at")
      .eq("owner_id", ownerId);
    if (stopped || slim.error) return;

    const localById = new Map(
      getHistory().map((entry) => [entry.id, entry] as const),
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

    const full = await client.from("uis").select("*").in("id", needIds);
    if (stopped || full.error) return;
    for (const raw of full.data ?? []) {
      if (!isUisRow(raw)) continue;
      // Never adopt rows owned by another account (RLS audit F7): an admin
      // sees every `uis` row under the SELECT policy, so without this guard
      // an admin's pull would copy other users' drafts into local history
      // and the next push would re-upsert them with `owner_id = admin` — a
      // silent ownership transfer (RLS can't block it: writing owner_id =
      // self passes WITH CHECK for an admin). Phase 1's server-side filter
      // already excluded foreign rows; this re-check is defense in depth.
      if (raw.owner_id !== ownerId) continue;
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
    // fresher write from another device. Column-slimmed (plan 055 A): the
    // compare reads `updated_at`, the guards read `owner_id`, the delete
    // pass reads `id` — no `revisions` payloads. Deliberately UNfiltered by
    // owner (decision 5): the F7 guard below must SEE foreign rows to
    // refuse upserting them.
    const { data, error } = await client
      .from("uis")
      .select("id, owner_id, updated_at");
    if (stopped) return;
    if (error) {
      setStatus("offline");
      return;
    }
    const remoteById = new Map(
      (data ?? []).filter(isSlimRow).map((row) => [row.id, row]),
    );
    const payload = local
      .filter((entry) => {
        const remote = remoteById.get(entry.id);
        // Belt to pull's braces: never overwrite a row another account
        // owns — the upsert stamps owner_id = us and would steal it (F7).
        if (remote && remote.owner_id !== ownerId) return false;
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

    const removed = [...syncedIds].filter((id) => {
      if (localIds.has(id)) return false;
      // A stale local copy of another account's row must not delete it.
      const remote = remoteById.get(id);
      return !remote || remote.owner_id === ownerId;
    });
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
