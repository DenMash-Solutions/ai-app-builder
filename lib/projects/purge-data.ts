/**
 * Project data purge (plan 067, decisions 2-4).
 *
 * A project owns the data its screens write, and deletion owns the cleanup
 * (decision 4: never screen deletion — a screen shared by two projects would
 * take the other project's data with it). Two stores hold that data, both
 * scoped by the same namespace the screens derive (`dataNamespaceFor`):
 *
 * - local resource rows: `genui-data:{projectId}:{collection}`
 *   (`DATA_STORAGE_KEY_PREFIX` + the local-storage adapter's key shape)
 * - durable rows: `genui_records` with `app_id = projectId` (the adapter's
 *   `app_id` IS the namespace), each row further restricted to its writer by
 *   RLS (`user_id = auth.uid()`), so one delete scoped by `app_id` removes
 *   exactly the deleting user's project records.
 *
 * Local rows go synchronously; the remote purge is best-effort (decision 2's
 * split: `/session` stays small and ephemeral, durable records live here).
 * `purgeProjectData` never rejects — a network failure must not leave a
 * half-deleted project behind, and the rows are unreachable once the project
 * row is gone.
 */
import { DATA_STORAGE_KEY_PREFIX } from "@/lib/data-sources/types";

/** The minimal delete surface used here (DI — tests pass a fake). */
export interface ProjectDataPurgeClient {
  from(table: string): {
    delete(): {
      eq(
        column: string,
        value: string,
      ): PromiseLike<{ error: { message: string } | null }>;
    };
  };
}

/** The slice of Web Storage the purge touches. */
export interface PurgeStorage {
  readonly length: number;
  key(index: number): string | null;
  removeItem(key: string): void;
}

export interface ProjectPurgeResult {
  /** Local resource keys removed. */
  local: number;
  /** True when the remote delete ran and was accepted. */
  remote: boolean;
}

/** The key prefix every local resource row of one project lives under. */
export function localDataKeyPrefix(projectId: string): string {
  return `${DATA_STORAGE_KEY_PREFIX}:${projectId}:`;
}

/** Removes this project's local resource rows; other projects' keys are
 *  untouched. Returns how many keys were removed. */
export function purgeLocalProjectData(
  projectId: string,
  storage: PurgeStorage | null = browserStorage(),
): number {
  if (storage === null) return 0;
  const prefix = localDataKeyPrefix(projectId);
  const doomed: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key !== null && key.startsWith(prefix)) doomed.push(key);
    }
    for (const key of doomed) storage.removeItem(key);
  } catch {
    // Blocked/partitioned storage: nothing this device can purge.
    return 0;
  }
  return doomed.length;
}

/** Deletes the project's `genui_records` rows. Best-effort by design: any
 *  failure (no session, offline, blocked storage) resolves false. */
export async function purgeRemoteProjectData(
  projectId: string,
  client?: ProjectDataPurgeClient,
): Promise<boolean> {
  try {
    const surface = client
      ? { client, table: await remoteTableName() }
      : await remoteSurface();
    if (surface === null) return false;
    const { error } = await surface.client
      .from(surface.table)
      .delete()
      .eq("app_id", projectId);
    return error === null;
  } catch {
    return false;
  }
}

/** Purges both stores for one project. Never rejects. */
export async function purgeProjectData(
  projectId: string,
): Promise<ProjectPurgeResult> {
  const local = purgeLocalProjectData(projectId);
  const remote = await purgeRemoteProjectData(projectId);
  return { local, remote };
}

function browserStorage(): PurgeStorage | null {
  try {
    const scope = globalThis as {
      localStorage?: PurgeStorage;
      window?: { localStorage?: PurgeStorage };
    };
    // A real browser serves the same object either way; preferring `window`
    // keeps SSR/test harnesses (which may stub `globalThis.localStorage`
    // alone) from shadowing the page's storage.
    return scope.window?.localStorage ?? scope.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The table name lives with the adapter; both modules are imported lazily so
 *  the projects store does not pull the data-source graph into every chunk
 *  (same shape as the adapter's own `resolveClient`). */
async function remoteSurface(): Promise<{
  client: ProjectDataPurgeClient;
  table: string;
} | null> {
  if (typeof window === "undefined") return null;
  // No project URL/key → there is no remote store to purge (and building a
  // client without them throws); mirrors the adapter's resolveClient.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  const [{ GENUI_RECORDS_TABLE }, { createClient }] = await Promise.all([
    import("@/lib/data-sources/supabase-adapter"),
    import("@/lib/supabase/client"),
  ]);
  return {
    client: createClient() as unknown as ProjectDataPurgeClient,
    table: GENUI_RECORDS_TABLE,
  };
}

async function remoteTableName(): Promise<string> {
  const { GENUI_RECORDS_TABLE } = await import(
    "@/lib/data-sources/supabase-adapter"
  );
  return GENUI_RECORDS_TABLE;
}
