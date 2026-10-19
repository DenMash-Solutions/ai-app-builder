import { getByPath } from "@json-render/core";
import type { StateModel } from "@json-render/core";
import { AdapterRegistry, adapterRegistry } from "./adapter-registry";
import {
  DATA_ERROR_CODES,
  DATA_STORAGE_KEY_PREFIX,
  DataError,
  QUERY_OPERATIONS,
  QUERY_STATUSES,
  queryStatePath,
} from "./types";
import type {
  DataSourceDef,
  NamedResourceDef,
  QueryDef,
  QueryMirror,
  ResourceDef,
} from "./types";

/**
 * Query manager (plan T6): the per-document runtime that turns declared
 * queries into the `/queries/<name>` state mirror (D1) and keeps it
 * fresh — initial reads, cross-tab `storage` events, and post-mutation
 * refreshes. One instance per document (M1 limitation): every surface
 * renders one `<QueryLoader>`, which attaches the spec's blocks here and
 * hands over a `write` channel into the provider's state store. The spec
 * object itself is never written — the mirror is runtime state only
 * (state-ownership regression, T9).
 */

/** What a surface hands the manager: config + a state-write channel. */
export interface QueryManagerConfig {
  namespace: string;
  dataSources: Record<string, DataSourceDef>;
  resources: Record<string, ResourceDef>;
  queries: Record<string, QueryDef>;
  write: (path: string, value: unknown) => void;
}

/** Minimal `StorageEvent` surface so tests can feed plain objects. */
export interface StorageEventLike {
  key: string | null;
}

const mirror = (partial: Partial<QueryMirror>): QueryMirror => ({
  data: [],
  status: QUERY_STATUSES.idle,
  count: 0,
  error: null,
  pending: false,
  ...partial,
});

const isId = (value: unknown): value is string | number =>
  typeof value === "string" || typeof value === "number";

/**
 * Resolves a `data_mutate` id param (D2 rev 1.1): json-render resolves
 * `{ "$item": "id" }` params to the record's ABSOLUTE state path (e.g.
 * `/queries/todoList/data/2/id`) — a `/`-leading string is dereferenced
 * against the live state model; literal ids pass through.
 */
export function resolveRecordId(
  id: unknown,
  state: StateModel,
): string | undefined {
  if (typeof id === "string" && id.startsWith("/")) {
    const value = getByPath(state, id);
    return isId(value) ? String(value) : undefined;
  }
  return isId(id) ? String(id) : undefined;
}

type AttachedContext = QueryManagerConfig;

export class QueryManager {
  private readonly registry: AdapterRegistry;
  private readonly contexts = new Set<AttachedContext>();
  private readonly inflight = new Set<string>();
  // Monotonic supersession counter per (namespace, query): bumped on
  // detach so a read that was in flight for a previous attach (StrictMode
  // remount, entry switch) can never write its result over the fresh one.
  private readonly generations = new Map<string, number>();
  // Busy flags for in-flight mutations, keyed `${namespace}:${name}` — the
  // single source writeMirror stamps into every mirror it emits, so a
  // silent refresh during a write can't clobber the pending indicator.
  private readonly pendingQueries = new Set<string>();
  // Last value written per query (mirror shape) so setPending can rewrite
  // the current mirror with a fresh flag without a state-read channel.
  private readonly lastMirrors = new Map<string, QueryMirror>();
  private listener: ((event: StorageEvent) => void) | null = null;

  constructor(registry: AdapterRegistry = adapterRegistry) {
    this.registry = registry;
  }

  /** Attach a surface's data blocks; returns the detach callback. */
  attach(config: QueryManagerConfig): () => void {
    const ctx: AttachedContext = { ...config };
    this.contexts.add(ctx);
    this.ensureListener();
    for (const name of Object.keys(ctx.queries)) {
      this.writeMirror(ctx, name, mirror({}));
      void this.loadQuery(ctx, name);
    }
    return () => this.detach(ctx);
  }

  /**
   * Resource/dataSource config for one namespace — the `data_mutate`
   * handler resolves declared names through this (the action layer never
   * sees the spec, only the manager does).
   */
  configFor(namespace: string):
    | {
        dataSources: Record<string, DataSourceDef>;
        resources: Record<string, ResourceDef>;
      }
    | undefined {
    let found: AttachedContext | undefined;
    for (const ctx of this.contexts) {
      if (ctx.namespace === namespace) found = ctx;
    }
    return found
      ? { dataSources: found.dataSources, resources: found.resources }
      : undefined;
  }

  /** Re-read every query of one resource in one namespace (post-mutation). */
  async refreshResource(
    namespace: string,
    resourceName: string,
  ): Promise<void> {
    const loads: Promise<void>[] = [];
    for (const ctx of this.contexts) {
      if (ctx.namespace !== namespace) continue;
      for (const [name, def] of Object.entries(ctx.queries)) {
        if (def.resource === resourceName) {
          loads.push(this.loadQuery(ctx, name, { silent: true }));
        }
      }
    }
    await Promise.all(loads);
  }

  /**
   * Cross-tab freshness (D6): another tab wrote a key in this design's
   * namespace → silently re-read the queries over that collection.
   */
  handleStorageEvent(event: StorageEventLike): void {
    for (const ctx of this.contexts) {
      if (event.key === null) {
        // storage.clear() — everything this design reads may be gone.
        for (const name of Object.keys(ctx.queries)) {
          void this.loadQuery(ctx, name, { silent: true });
        }
        continue;
      }
      const collection = this.collectionForKey(ctx, event.key);
      if (collection === undefined) continue;
      for (const [name, def] of Object.entries(ctx.queries)) {
        const resource = ctx.resources[def.resource];
        if (!resource) continue;
        if ((resource.collection ?? def.resource) === collection) {
          void this.loadQuery(ctx, name, { silent: true });
        }
      }
    }
  }

  private detach(ctx: AttachedContext): void {
    this.contexts.delete(ctx);
    for (const name of Object.keys(ctx.queries)) {
      const key = `${ctx.namespace}:${name}`;
      // Supersede in-flight reads of this attach: their mirrors must never
      // overwrite the replacement's (StrictMode remount, entry switch), and
      // their dedupe slot must not block the replacement load — the
      // disposed adapter would otherwise poison the stale read and its
      // error would win by timing.
      this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
      this.inflight.delete(key);
    }
    const namespaceStillUsed = [...this.contexts].some(
      (candidate) => candidate.namespace === ctx.namespace,
    );
    if (!namespaceStillUsed) {
      this.registry.disposeNamespace(ctx.namespace);
      // Release the namespace's busy flags + cached mirrors — a flag stuck
      // true (surface unmounted mid-write) would otherwise stamp stale
      // pending:true onto the next attach's mirrors.
      const prefix = `${ctx.namespace}:`;
      for (const key of [...this.pendingQueries]) {
        if (key.startsWith(prefix)) this.pendingQueries.delete(key);
      }
      for (const key of [...this.lastMirrors.keys()]) {
        if (key.startsWith(prefix)) this.lastMirrors.delete(key);
      }
    }
    if (this.contexts.size === 0) this.teardownListener();
  }

  /** True while any surface of that namespace is mounted (stale-write guard). */
  private isLive(namespace: string): boolean {
    for (const ctx of this.contexts) {
      if (ctx.namespace === namespace) return true;
    }
    return false;
  }

  private writeMirror(
    ctx: AttachedContext,
    name: string,
    value: QueryMirror,
  ): void {
    // An entry switch detaches the old namespace; a read that was already
    // in flight must not clobber the new design's mirror.
    if (!this.isLive(ctx.namespace)) return;
    const key = `${ctx.namespace}:${name}`;
    // Stamp the authoritative busy flag on EVERY write (loading, success,
    // error, silent refresh) so a refresh triggered mid-write keeps the
    // pending indicator instead of resetting it.
    const stamped: QueryMirror = {
      ...value,
      pending: this.pendingQueries.has(key),
    };
    this.lastMirrors.set(key, stamped);
    ctx.write(queryStatePath(name), stamped);
  }

  /**
   * Mark/clear every query of one resource as writing (pending mirror
   * flag): set true right before a `data_mutate` adapter op, false after
   * the post-write refresh — the flag therefore covers the write AND the
   * refresh that updates every bound list (action-loading-states plan).
   */
  setPending(namespace: string, resourceName: string, pending: boolean): void {
    for (const ctx of this.contexts) {
      if (ctx.namespace !== namespace) continue;
      for (const [name, def] of Object.entries(ctx.queries)) {
        if (def.resource !== resourceName) continue;
        const key = `${namespace}:${name}`;
        if (pending) this.pendingQueries.add(key);
        else this.pendingQueries.delete(key);
        const current = this.lastMirrors.get(key);
        // Rewrite the current mirror with the new flag; if no mirror has
        // been written yet, the next writeMirror stamps it anyway.
        if (current) this.writeMirror(ctx, name, current);
      }
    }
  }

  private async loadQuery(
    ctx: AttachedContext,
    name: string,
    options: { silent?: boolean } = {},
  ): Promise<void> {
    const def: QueryDef | undefined = ctx.queries[name];
    if (!def) return;
    const resource = ctx.resources[def.resource];
    const dataSource = resource
      ? ctx.dataSources[resource.dataSource]
      : undefined;
    if (!resource || !dataSource) {
      this.writeMirror(
        ctx,
        name,
        mirror({
          status: QUERY_STATUSES.error,
          error: {
            code: DATA_ERROR_CODES.resourceNotFound,
            message: `Query "${name}" references ${
              resource
                ? `unknown dataSource "${resource.dataSource}"`
                : `unknown resource "${def.resource}"`
            }.`,
          },
        }),
      );
      return;
    }
    const dedupeKey = `${ctx.namespace}:${name}`;
    if (this.inflight.has(dedupeKey)) return;
    this.inflight.add(dedupeKey);
    // Loads started after a detach supersede everything still in flight
    // for this key — the stale ones become silent (see detach).
    const generation = this.generations.get(dedupeKey) ?? 0;
    const emit = (value: QueryMirror): void => {
      if ((this.generations.get(dedupeKey) ?? 0) !== generation) return;
      this.writeMirror(ctx, name, value);
    };
    try {
      const adapter = this.registry.get(resource.dataSource, dataSource, {
        namespace: ctx.namespace,
      });
      await adapter.initialize();
      if (!options.silent) {
        emit(mirror({ status: QUERY_STATUSES.loading }));
      }
      const namedResource: NamedResourceDef = {
        ...resource,
        name: def.resource,
      };
      let data: Record<string, unknown>[];
      if (def.operation === QUERY_OPERATIONS.get) {
        const id =
          typeof def.params?.id === "string" ? def.params.id : undefined;
        if (id === undefined) {
          throw new DataError(
            DATA_ERROR_CODES.unsupported,
            `Query "${name}" uses "get" but has no string params.id.`,
          );
        }
        const record = await adapter.get(namedResource, id);
        data = record ? [record] : [];
      } else {
        data = await adapter.list(namedResource);
      }
      emit(
        mirror({ data, status: QUERY_STATUSES.success, count: data.length }),
      );
    } catch (error) {
      const dataError =
        error instanceof DataError
          ? error
          : new DataError(
              DATA_ERROR_CODES.unknown,
              error instanceof Error ? error.message : String(error),
            );
      emit(
        mirror({
          status: QUERY_STATUSES.error,
          error: { code: dataError.code, message: dataError.message },
        }),
      );
    } finally {
      this.inflight.delete(dedupeKey);
    }
  }

  /** The `storage` key prefix a context's data sources write under. */
  private collectionForKey(
    ctx: AttachedContext,
    key: string,
  ): string | undefined {
    for (const def of Object.values(ctx.dataSources)) {
      const configured = (def.config?.storageKeyPrefix ?? undefined) as
        string | undefined;
      const head = `${configured ?? DATA_STORAGE_KEY_PREFIX}:${ctx.namespace}:`;
      if (key.startsWith(head)) return key.slice(head.length);
    }
    return undefined;
  }

  private ensureListener(): void {
    if (
      this.listener !== null ||
      typeof window === "undefined" ||
      typeof window.addEventListener !== "function"
    ) {
      return;
    }
    this.listener = (event: StorageEvent) => this.handleStorageEvent(event);
    window.addEventListener("storage", this.listener);
  }

  private teardownListener(): void {
    if (
      this.listener === null ||
      typeof window === "undefined" ||
      typeof window.removeEventListener !== "function"
    ) {
      return;
    }
    window.removeEventListener("storage", this.listener);
    this.listener = null;
  }
}

/** The app's per-document singleton manager. */
export const queryManager = new QueryManager();
