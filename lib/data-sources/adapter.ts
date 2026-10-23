import type {
  DataSourceProvider,
  DataSourceDef,
  ListReadOptions,
  NamedResourceDef,
  PagedRows,
} from "./types";

/**
 * Adapter contract (plan T3, D3): the seam between declared resources and
 * a storage provider. Every method is id-based and provider-generic on
 * purpose — M2 (database) and M3 (API) adapters implement exactly this
 * interface, and neither the query manager nor `data_mutate` learn
 * anything provider-specific. One adapter instance serves one
 * `(dataSource, namespace)` pair (D6): the namespace scopes storage to a
 * design, so instances are cheap and disposable per document.
 */

/** What a provider can do — the model may only use declared strengths. */
export interface AdapterCapabilities {
  list: boolean;
  get: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
}

/** Wiring the registry passes to an adapter factory (DI — testable). */
export interface AdapterContext {
  /** Design scope (entry id / slug) — part of every storage key (D6). */
  namespace: string;
}

export interface DataSourceAdapter {
  readonly provider: DataSourceProvider;
  readonly capabilities: AdapterCapabilities;

  /** Acquire the underlying store; throws `DataError(unavailable)`. */
  initialize(): Promise<void>;

  /**
   * Read a collection. `options` carries run-resolved query params; the
   * api provider also honors `options.pagination` and then resolves to
   * `{ rows, page }` (052) instead of a bare array — storage providers
   * ignore both and always resolve to the array.
   */
  list(
    resource: NamedResourceDef,
    options?: ListReadOptions,
  ): Promise<Record<string, unknown>[] | PagedRows>;
  get(
    resource: NamedResourceDef,
    id: string,
  ): Promise<Record<string, unknown> | null>;
  create(
    resource: NamedResourceDef,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  update(
    resource: NamedResourceDef,
    id: string,
    patch: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  delete(resource: NamedResourceDef, id: string): Promise<void>;

  /** Release whatever was acquired (adapter instances are per-namespace). */
  dispose(): Promise<void>;
}

/** Factory signature the adapter registry maps providers to (T4). */
export type AdapterFactory = (
  def: DataSourceDef,
  context: AdapterContext,
) => DataSourceAdapter;
