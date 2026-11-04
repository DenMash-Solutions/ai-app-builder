import type { HistoryEntry } from "@/lib/history";
import { revalidateProjection } from "@/lib/publish/revalidate";
import { ROUTE_CLAIM_KINDS } from "@/lib/routes/registry";
import type { RouteClaimKind } from "@/lib/routes/registry";

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

/**
 * A filtered write (`update`/`delete`): PostgREST builders chain further
 * equality filters before resolving, so both are chainable and thenable.
 * The project-publish sequences need `.delete().eq(...).in(...)` to remove
 * exactly the stale routes of one project, never a route another project
 * happens to share.
 */
interface WriteBuilder extends PromiseLike<{ error: QueryError | null }> {
  eq(column: string, value: string | number | boolean): WriteBuilder;
  in(column: string, values: string[]): WriteBuilder;
}

/** The slice of the Supabase client the publish flow uses (mockable in tests). */
export interface PublishClient {
  from(table: string): {
    select(columns: string): SelectBuilder;
    insert(values: Record<string, unknown>): SelectBuilder;
    upsert(
      values: Record<string, unknown> | Record<string, unknown>[],
      options?: { onConflict?: string },
    ): SelectBuilder;
    update(values: Record<string, unknown>): WriteBuilder;
    delete(): { eq(column: string, value: string): WriteBuilder };
  };
  /**
   * RPC seam — the namespace arbiter (`route_available`) and the live
   * handle lookup (`live_project`, 069 task 4) are functions. The result
   * row shape differs per function, so it resolves to the loose `Row`
   * default; every call site narrows it at runtime (`=== true`, the
   * `project_id`/`handle` string check).
   */
  rpc(fn: string, params: Record<string, unknown>): PromiseLike<QueryResult>;
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

/**
 * Every way the namespace arbiter (or the backstop unique indexes behind it)
 * refuses a claim: the definer trigger raises before the row constraint ever
 * fires (decision 10 — the value is held by someone's claim: a foreign one,
 * or this owner's project handle / published screen of the other kind).
 * Shared by the screen publish and the project handle publish so both map
 * the same failure to the same "taken" verdict.
 */
export function isClaimConflictError(message: string): boolean {
  return (
    (message.includes("duplicate key") &&
      (message.includes("published_pages") ||
        message.includes("projects_handle_key"))) ||
    message.includes("is already claimed") ||
    message.includes("is held by a project handle") ||
    message.includes("is held by a published screen")
  );
}

/**
 * Debounced-dialog availability probe: asks the namespace ARBITER
 * (`route_available`, decision 11) rather than reading `published_pages` —
 * a value held by a project handle is exactly as taken for a screen slug,
 * and two sources of takenness would disagree. The definer RPC counts the
 * caller's own claim of the SAME kind as available, so republishing one's
 * own slug (or handle) is never a false "taken"; a foreign claim or one's
 * other kind reads taken, which is what the trigger then enforces.
 *
 * `kind` is the claim the caller is about to make — screens pass
 * `ROUTE_CLAIM_KINDS.screen`, the project-publish dialog passes
 * `ROUTE_CLAIM_KINDS.handle`; one probe, two callers (decision 11).
 *
 * Fail-closed on error (same contract as before): an unreachable arbiter
 * shows "taken" instead of letting a doomed publish through.
 */
export async function isSlugAvailable(
  client: PublishClient,
  slug: string,
  kind: RouteClaimKind = ROUTE_CLAIM_KINDS.screen,
): Promise<boolean> {
  const { data, error } = await client.rpc("route_available", {
    p_value: slug,
    p_kind: kind,
  });
  if (error) return false;
  return data === true;
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
    if (isClaimConflictError(publicError.message)) {
      return { ok: false, slugTaken: true, error: publicError.message };
    }
    return { ok: false, error: publicError.message };
  }

  // The server projection is share-cached (055 C) — expire it now so the
  // next /<slug> request already serves this version.
  revalidateProjection(["published_pages"]);
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
  revalidateProjection(["published_pages"]);
  return { ok: true };
}
