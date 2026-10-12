import type { HistoryEntry } from "@/lib/history";

/**
 * Publish flow (plan Q5): publishing snapshots the currently selected
 * revision into `page_versions` (immutable, private) and upserts the public
 * projection in `published_pages` (world-readable, globally-unique slug —
 * first to publish wins; the DB constraint is the backstop behind the
 * debounced availability check). Unpublishing deletes only the public row —
 * versions stay for history.
 */

interface QueryError {
  message: string;
}
// The Supabase client's response generics are invariant through its thenable
// builders, and different call shapes resolve to different data types (single
// row vs array). `any` is the bridge at this thin adapter boundary — every
// call site narrows the data it reads at runtime.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

interface QueryResult<T = Row> {
  data: T | null;
  error: QueryError | null;
}

interface SelectBuilder<T = Row> extends PromiseLike<QueryResult<T>> {
  eq(column: string, value: string | number | boolean): SelectBuilder<T>;
  // `in` resolves the same loose row shape — no nested generic instantiation.
  in(column: string, values: string[]): SelectBuilder;
  order(column: string, options?: { ascending?: boolean }): SelectBuilder<T>;
  limit(count: number): SelectBuilder<T>;
  maybeSingle(): PromiseLike<QueryResult<T>>;
}

/** The slice of the Supabase client the publish flow uses (mockable in tests). */
export interface PublishClient {
  from(table: string): {
    select(columns: string): SelectBuilder;
    insert(values: Record<string, unknown>): SelectBuilder;
    upsert(
      values: Record<string, unknown>,
      options?: { onConflict?: string },
    ): SelectBuilder;
    delete(): {
      eq(
        column: string,
        value: string,
      ): PromiseLike<{ error: QueryError | null }>;
    };
  };
}

export interface PublishedPage {
  uiId: string;
  slug: string;
  version: number;
}

/**
 * Adapter for the full Supabase client. The structural check of the whole
 * client against the recursive builder interface blows past TypeScript's
 * instantiation limits, so the (harmless) assertion lives here, once, with a
 * runtime-shaped interface that unit tests mock directly.
 */
export function asPublishClient<T>(client: T): PublishClient {
  return client as unknown as PublishClient;
}

export interface PublishResult {
  ok: boolean;
  /** True when the slug is taken by someone else's page. */
  slugTaken?: boolean;
  error?: string;
}

function isSlugTakenError(message: string): boolean {
  return (
    message.includes("duplicate key") && message.includes("published_pages")
  );
}

/** Debounced-dialog availability probe: free, or ours (keeping our slug). */
export async function isSlugAvailable(
  client: PublishClient,
  slug: string,
  currentUiId?: string,
): Promise<boolean> {
  const { data, error } = await client
    .from("published_pages")
    .select("ui_id")
    .eq("slug", slug)
    .maybeSingle();
  if (error) return false;
  if (!data) return true;
  return data.ui_id === currentUiId;
}

/** Published state for the drawer rows — one query for all visible entries. */
export async function getPublishedState(
  client: PublishClient,
  uiIds: string[],
): Promise<PublishedPage[]> {
  if (uiIds.length === 0) return [];
  const { data, error } = await client
    .from("published_pages")
    .select("ui_id, slug, version")
    .in("ui_id", uiIds);
  if (error || !Array.isArray(data)) return [];
  return data.map((row) => ({
    uiId: String(row.ui_id),
    slug: String(row.slug),
    version: Number(row.version),
  }));
}

/** Publishes the entry's currently selected revision as the next version. */
export async function publishEntry(
  client: PublishClient,
  ownerId: string,
  entry: HistoryEntry,
  slug: string,
): Promise<PublishResult & { slug?: string; version?: number }> {
  const revision = entry.revisions[entry.head];
  const spec = revision?.spec ?? entry.spec;
  const label = revision?.label ?? null;

  const { data: last, error: versionError } = await client
    .from("page_versions")
    .select("version")
    .eq("ui_id", entry.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (versionError) {
    return { ok: false, error: versionError.message };
  }
  const version = (last?.version ? Number(last.version) : 0) + 1;

  const { error: snapshotError } = await client
    .from("page_versions")
    .insert({
      ui_id: entry.id,
      owner_id: ownerId,
      version,
      spec,
      label,
    })
    .maybeSingle();
  if (snapshotError) {
    return { ok: false, error: snapshotError.message };
  }

  const { error: publicError } = await client
    .from("published_pages")
    .upsert(
      {
        ui_id: entry.id,
        owner_id: ownerId,
        slug,
        name: entry.name,
        version,
        spec,
      },
      { onConflict: "ui_id" },
    )
    .maybeSingle();
  if (publicError) {
    if (isSlugTakenError(publicError.message)) {
      return { ok: false, slugTaken: true, error: publicError.message };
    }
    return { ok: false, error: publicError.message };
  }

  return { ok: true, slug, version };
}

/** Removes the public row; versions are retained (plan: history stays). */
export async function unpublishEntry(
  client: PublishClient,
  uiId: string,
): Promise<PublishResult> {
  const { error } = await client
    .from("published_pages")
    .delete()
    .eq("ui_id", uiId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
