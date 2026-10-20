import { z } from "zod";
import type { Spec } from "@json-render/core";

/**
 * Data sources M0+M1 (docs/plan/043-data-sources): the provider-independent
 * contract a generated UI uses to read and write persistent data. A spec
 * declares three top-level blocks — `dataSources` (where), `resources`
 * (what) and `queries` (reads) — and the catalog action `data_mutate`
 * (writes). Nothing in these blocks names a storage provider beyond the
 * declared `provider` value, so M2 (database) and M3 (API) only add
 * providers here.
 */

/** The catalog action that creates/updates/deletes records (D2). */
export const DATA_MUTATE_ACTION = "data_mutate";

/** Storage providers the adapter registry knows (D3; M2 database, M3 API). */
export const DATA_SOURCE_PROVIDERS = {
  localStorage: "localStorage",
  supabase: "supabase",
  api: "api",
} as const;

export type DataSourceProvider =
  (typeof DATA_SOURCE_PROVIDERS)[keyof typeof DATA_SOURCE_PROVIDERS];

/** Query operations (D1). `list` returns every record, `get` one by id. */
export const QUERY_OPERATIONS = {
  list: "list",
  get: "get",
} as const;

export type QueryOperation =
  (typeof QUERY_OPERATIONS)[keyof typeof QUERY_OPERATIONS];

/** Mutation operations behind `data_mutate` (D2). */
export const MUTATION_OPS = {
  create: "create",
  update: "update",
  delete: "delete",
} as const;

export type MutationOp = (typeof MUTATION_OPS)[keyof typeof MUTATION_OPS];

/**
 * Config keys that look like credentials are REJECTED by validation (D3):
 * M1 storage is the visitor's own browser, and the program's rule is that
 * specs never carry secrets — a future M3 API provider must authenticate
 * through server-held configuration instead.
 */
export const CREDENTIAL_CONFIG_KEYS = [
  "password",
  "secret",
  "token",
  "apikey",
  "api_key",
  "credentials",
  "authorization",
  "privatekey",
  "accesstoken",
] as const;

/**
 * The only config keys the "api" provider accepts (api-data-source plan
 * D2, grown by keyed-api-lane plan 050): the endpoint a spec IS allowed
 * to declare, an optional JSON pointer that unwraps enveloped list
 * responses, and — Lane 2 — the shape-only `auth` ref that routes the
 * source through the key-injecting server proxy. Headers and query values
 * remain impossible; key VALUES live only in server env pairs
 * (`DATA_PROXY_<REF>_*`), never in a spec.
 */
export const API_CONFIG_KEYS = ["baseUrl", "itemsPath", "auth"] as const;

/**
 * Field types a resource `schema` may declare (validated before writes,
 * D3/T5). Kept to JSON primitives — every provider can store those.
 */
export const RECORD_FIELD_TYPES = {
  string: "string",
  number: "number",
  boolean: "boolean",
} as const;

const recordFieldSchema = z.enum([
  RECORD_FIELD_TYPES.string,
  RECORD_FIELD_TYPES.number,
  RECORD_FIELD_TYPES.boolean,
]);

/** `dataSources.<name>` — where a collection lives (D3). */
export const dataSourceDefSchema = z
  .object({
    provider: z
      .enum([
        DATA_SOURCE_PROVIDERS.localStorage,
        DATA_SOURCE_PROVIDERS.supabase,
        DATA_SOURCE_PROVIDERS.api,
      ])
      .describe(
        'Storage provider — "localStorage" for per-browser data, "supabase" for the project database (rows scoped to the signed-in visitor, authorization enforced by RLS), "api" for an HTTPS JSON API declared in the spec (config: {"baseUrl": "https://…"}; for keyed APIs add {"auth": {"type": "bearer", "ref": "name"}} and the deployment injects the key server-side)',
      ),
    config: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Provider options, e.g. {"storageKeyPrefix": "my-app"} for localStorage or {"baseUrl": "https://api.example.com", "itemsPath": "/data"} for api. Never put credentials here — credential-shaped keys are rejected; the supabase provider takes no config at all (project URL and keys come from the app environment). api endpoints are public, unauthenticated HTTPS unless config.auth declares a server-held key ref ({ "type": "bearer", "ref": "weather" } or {"type": "header", "header": "X-API-Key", "ref": "shop"}) — the VALUE lives only in server configuration, never in specs',
      ),
  })
  .strict();

export type DataSourceDef = z.infer<typeof dataSourceDefSchema>;

/** `resources.<name>` — a named collection of records (D3). */
export const resourceDefSchema = z
  .object({
    dataSource: z
      .string()
      .min(1)
      .describe(
        'Name of the dataSource that stores this collection, e.g. "localTodos"',
      ),
    collection: z
      .string()
      .min(1)
      .optional()
      .describe("Physical collection/key name — defaults to the resource name"),
    schema: z
      .record(z.string(), recordFieldSchema)
      .optional()
      .describe(
        'Field map used to validate records before writes, e.g. {"title": "string", "done": "boolean"}',
      ),
    primaryKey: z
      .string()
      .min(1)
      .optional()
      .describe('Record id field — defaults to "id"'),
  })
  .strict();

export type ResourceDef = z.infer<typeof resourceDefSchema>;

/**
 * A resource def plus its declared name (the `resources` map key) —
 * storage keys and diagnostics need both, so adapters receive this shape.
 */
export interface NamedResourceDef extends ResourceDef {
  name: string;
}

/** `queries.<name>` — a read the UI binds to (D1). */
export const queryDefSchema = z
  .object({
    resource: z
      .string()
      .min(1)
      .describe('Name of the resource to read, e.g. "todos"'),
    operation: z
      .enum([QUERY_OPERATIONS.list, QUERY_OPERATIONS.get])
      .default(QUERY_OPERATIONS.list)
      .describe('"list" returns every record; "get" needs an "id" param'),
    params: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Operation params, e.g. {"id": "…"} for "get"'),
  })
  .strict();

export type QueryDef = z.infer<typeof queryDefSchema>;

/** Params of the `data_mutate` action (D2). */
export const dataMutateParamsSchema = z
  .object({
    op: z
      .enum([MUTATION_OPS.create, MUTATION_OPS.update, MUTATION_OPS.delete])
      .describe("Which mutation to run"),
    resource: z.string().min(1).describe("Declared resource to mutate"),
    input: z
      .unknown()
      .optional()
      .describe(
        'Record to create or patch, e.g. {"title": "Buy milk", "done": false} — {"$state": "/path"} reads it from state',
      ),
    id: z
      .unknown()
      .optional()
      .describe(
        'Record id for update/delete — {"$item": "id"} inside a repeat resolves to the record\'s state path and the action reads the id from it',
      ),
  })
  .strict();

export type DataMutateParams = z.infer<typeof dataMutateParamsSchema>;

/**
 * The spec's data blocks as they ride along the Spec type. `Spec` has no
 * index signature, so every read of `spec.dataSources` etc. goes through
 * this extension. The blocks survive the core SpecStream compiler,
 * validation, and import/export (plan LS-01 audit) — but NOT
 * `useUIStream`'s internal patch applier, which only understands
 * `/root`, `/state` and `/elements/*` and silently drops other root
 * members (found empirically, rev 1.3 — see `stream-blocks.ts`).
 */
export interface DataSourcesSpec extends Spec {
  dataSources?: Record<string, DataSourceDef>;
  resources?: Record<string, ResourceDef>;
  queries?: Record<string, QueryDef>;
}

/** Top-level root members a design's data declarations live in. */
export const DATA_BLOCK_KEYS = ["dataSources", "resources", "queries"] as const;

/** Narrow a plain `Spec` to the data-blocks view (cast, never a copy). */
export function withDataBlocks(spec: Spec): DataSourcesSpec {
  return spec as DataSourcesSpec;
}

/** True when the spec declares at least one data block (D4/D8). */
export function hasDataBlocks(spec: Spec): boolean {
  const { dataSources, resources, queries } = withDataBlocks(spec);
  return (
    (dataSources !== undefined && Object.keys(dataSources).length > 0) ||
    (resources !== undefined && Object.keys(resources).length > 0) ||
    (queries !== undefined && Object.keys(queries).length > 0)
  );
}

/** Runtime mirror statuses (D1). */
export const QUERY_STATUSES = {
  idle: "idle",
  loading: "loading",
  success: "success",
  error: "error",
} as const;

export type QueryStatus = (typeof QUERY_STATUSES)[keyof typeof QUERY_STATUSES];

/** The `{code, message}` payload a mirror carries on failure (D1). */
export interface QueryMirrorError {
  code: string;
  message: string;
}

/** One query's runtime mirror under `/queries/<name>` (D1). */
export interface QueryMirror {
  data: Record<string, unknown>[];
  status: QueryStatus;
  count: number;
  error: QueryMirrorError | null;
  /** True while a `data_mutate` write for this query's resource (and its
   *  post-write refresh) is running — specs branch busy UI on it. */
  pending: boolean;
}

/** Reserved state namespace the query manager owns (D1). */
export const QUERIES_STATE_KEY = "queries";

export const queryStatePath = (name: string): string =>
  `/${QUERIES_STATE_KEY}/${name}`;
export const queryDataPath = (name: string): string =>
  `${queryStatePath(name)}/data`;
export const queryStatusPath = (name: string): string =>
  `${queryStatePath(name)}/status`;
export const queryCountPath = (name: string): string =>
  `${queryStatePath(name)}/count`;

/**
 * localStorage key layout (D6): `{prefix}:{namespace}:{collection}` where
 * the namespace scopes a design (entry id in the playground, slug on
 * published/preview routes) so two designs never share a store, and the
 * collection is the resource's physical name.
 */
export const DATA_STORAGE_KEY_PREFIX = "genui-data";

export function dataStorageKey(namespace: string, collection: string): string {
  return `${DATA_STORAGE_KEY_PREFIX}:${namespace}:${collection}`;
}

/** Machine-readable reasons a data operation can fail (T5/T6). */
export const DATA_ERROR_CODES = {
  malformed: "malformed",
  unavailable: "unavailable",
  invalidRecord: "invalid_record",
  notFound: "not_found",
  unknownProvider: "unknown_provider",
  unsupported: "unsupported",
  resourceNotFound: "resource_not_found",
  unknown: "unknown",
} as const;

export type DataErrorCode =
  (typeof DATA_ERROR_CODES)[keyof typeof DATA_ERROR_CODES];

/** Error thrown by adapters and the manager — carries a stable code. */
export class DataError extends Error {
  readonly code: DataErrorCode;

  constructor(code: DataErrorCode, message: string) {
    super(message);
    this.name = "DataError";
    this.code = code;
  }
}
