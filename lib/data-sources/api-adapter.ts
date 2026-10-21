import type {
  AdapterCapabilities,
  AdapterContext,
  DataSourceAdapter,
} from "./adapter";
import { checkApiAuth } from "./api-auth";
import type { ApiKeyAuth } from "./api-auth";
import { checkApiBaseUrl, normalizeApiBaseUrl } from "./api-url";
import { validateRecord } from "./record-validate";
import { DATA_SOURCE_PROVIDERS, DATA_ERROR_CODES, DataError } from "./types";
import type { DataSourceDef, NamedResourceDef } from "./types";

/**
 * Milestone 3 adapter (docs/plan/048-api-data-source): a plain HTTPS JSON
 * API. Lane 1 fetches DIRECTLY from the visitor's browser (keyless public
 * endpoints, no server route, no egress worker); Lane 2
 * (docs/plan/050-keyed-api-lane) adds keyed sources: when the spec's
 * `config.auth` declares a ref, every request is rewritten to
 * `POST /api/data-proxy` with `{ ref, path, method, body }` and the
 * server injects the origin-bound key — the browser never holds one. Only
 * auth-declared sources take the proxy; keyless stays browser-direct
 * (decision 3). The spec declares the origin (`config.baseUrl`), the
 * resource's `collection` is the path segment, and the standard REST verbs
 * map onto the provider-independent CRUD contract — the query manager and
 * `data_mutate` stay blind to all of it. The fetch resolver is injectable
 * so unit tests run on a fake without a network (the supabase adapter's
 * surface-mock pattern).
 *
 * The URL is policed at the three validation seams AND here (defense in
 * depth, mirroring the supabase config check): https outside localhost, no
 * userinfo/query/fragment, no literal private/link-local addresses.
 */

/** Injectable fetch surface — same DI stance as `resolveStorage`. */
export type ApiFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Bounds every request so a hanging API cannot pin `pending` forever. */
const REQUEST_TIMEOUT_MS = 15_000;

/** The server route keyed sources route through (same-origin, relative). */
const DATA_PROXY_PATH = "/api/data-proxy";

/** The proxy's `unknown_ref` body marker (route + adapter agree on it). */
const UNKNOWN_REF_ERROR = "unknown_ref";

const CAPABILITIES: AdapterCapabilities = {
  list: true,
  get: true,
  create: true,
  update: true,
  delete: true,
};

interface ApiConfig {
  baseUrl?: unknown;
  itemsPath?: unknown;
  auth?: unknown;
  itemDetail?: unknown;
}

const resolveCollection = (resource: NamedResourceDef): string =>
  resource.collection ?? resource.name;

const resolvePrimaryKey = (resource: NamedResourceDef): string =>
  resource.primaryKey ?? "id";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const defaultResolveFetch = (): ApiFetch | null =>
  typeof globalThis.fetch === "function"
    ? (url: string, init?: RequestInit) => globalThis.fetch(url, init)
    : null;

/**
 * Lane 2 transport (050): rewrite every request to the server proxy as
 * `POST /api/data-proxy` with `{ ref, path, method, body }` — the client
 * sends a PATH only (the absolute URL was composed from the spec's
 * baseUrl, which the proxy neither needs nor trusts) and no credential of
 * any kind. The proxy's response is handed back untouched so the whole
 * error-normalization pipeline above keeps working verbatim; the one
 * exception is `unknown_ref`, which names the missing server config in a
 * developer-facing diagnostic instead of a generic 404.
 */
function proxyFetchFor(ref: string, underlying: ApiFetch): ApiFetch {
  return async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    const verb = (init.method ?? "GET").toUpperCase();
    const response = await underlying(DATA_PROXY_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ref,
        path,
        method: verb,
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      }),
      signal: init.signal,
    });
    if (response.status === 404) {
      const text = await response.text().catch(() => "");
      let unknownRef = false;
      try {
        unknownRef =
          (JSON.parse(text) as { error?: unknown }).error === UNKNOWN_REF_ERROR;
      } catch {
        // A genuine upstream 404 (missing record) — pass it through below.
      }
      if (unknownRef) {
        throw new DataError(
          DATA_ERROR_CODES.unavailable,
          `This deployment holds no API key for auth ref "${ref}" — configure DATA_PROXY_${ref.toUpperCase()}_ORIGIN and DATA_PROXY_${ref.toUpperCase()}_KEY on the server.`,
        );
      }
      return new Response(text === "" ? null : text, {
        status: 404,
        headers: {
          "Content-Type":
            response.headers.get("Content-Type") ?? "application/json",
        },
      });
    }
    return response;
  };
}

/**
 * HTTP status → the shared `DataError` codes the mirror already branches
 * on, so an API failure degrades to the same friendly error state as a
 * storage failure (plan decision 7). Bodies are never echoed — upstream
 * detail stays out of the UI.
 */
function responseError(response: Response): DataError {
  const status = response.status;
  if (status === 404) {
    return new DataError(
      DATA_ERROR_CODES.notFound,
      `The API has no such endpoint or record (HTTP 404).`,
    );
  }
  if (status === 401 || status === 403) {
    return new DataError(
      DATA_ERROR_CODES.unavailable,
      `The API refused the request (HTTP ${status}) — this provider supports public, unauthenticated endpoints only.`,
    );
  }
  if (status === 400 || status === 422) {
    return new DataError(
      DATA_ERROR_CODES.invalidRecord,
      `The API rejected the record (HTTP ${status}).`,
    );
  }
  if (status === 429) {
    return new DataError(
      DATA_ERROR_CODES.unavailable,
      `The API is rate-limiting requests (HTTP 429) — try again shortly.`,
    );
  }
  if (status >= 500) {
    return new DataError(
      DATA_ERROR_CODES.unavailable,
      `The API is failing right now (HTTP ${status}).`,
    );
  }
  return new DataError(
    DATA_ERROR_CODES.unknown,
    `The API returned HTTP ${status}.`,
  );
}

/**
 * One bounded request + JSON parse. Network/CORS failures, the timeout,
 * non-2xx statuses and non-JSON bodies all surface as `DataError`s with
 * stable codes — never as raw fetch exceptions.
 */
async function requestJson(
  fetchImpl: ApiFetch,
  url: string,
  init: RequestInit,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // Already-normalized failures (the Lane 2 proxy's unknown-ref
    // diagnostic, thrown inside the fetch layer) keep their message.
    if (error instanceof DataError) throw error;
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new DataError(
        DATA_ERROR_CODES.unavailable,
        `The API did not respond within ${REQUEST_TIMEOUT_MS / 1000} seconds.`,
      );
    }
    throw new DataError(
      DATA_ERROR_CODES.unavailable,
      "The API could not be reached (network or CORS).",
    );
  }
  if (!response.ok) throw responseError(response);
  if (response.status === 204) return null;
  const text = await response.text();
  if (text.trim() === "") return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new DataError(
      DATA_ERROR_CODES.malformed,
      "The API did not return JSON (parse failed).",
    );
  }
}

/** JSON-pointer unwrap ("/data" → value at `data`); RFC 6901 ~0/~1 escapes. */
function pickPointer(value: unknown, pointer: string): unknown {
  if (!pointer.startsWith("/")) return undefined;
  let current: unknown = value;
  for (const rawSegment of pointer.slice(1).split("/")) {
    const segment = rawSegment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
    } else if (isPlainObject(current)) {
      current = current[segment];
    } else {
      return undefined;
    }
    if (current === undefined) return undefined;
  }
  return current;
}

/** The per-row placeholder in an `itemDetail.path` template (plan 051). */
const ITEM_DETAIL_PLACEHOLDER = "{id}";

/**
 * The id an `itemDetail` read uses for one list row: the row's own `id`
 * (string or number) when present, else the last path segment of a string
 * `row.url` (paginated list conventions — `.../pokemon/25/` → `25`).
 * `null` when neither exists: the row then keeps its base data.
 */
function itemIdOf(row: unknown): string | null {
  if (!isPlainObject(row)) return null;
  const { id, url } = row;
  if (typeof id === "string" && id !== "") return id;
  if (typeof id === "number" && Number.isFinite(id)) return String(id);
  if (typeof url === "string") {
    const segments = url.split("/").filter(Boolean);
    const last = segments[segments.length - 1];
    if (last !== undefined && last !== "") return last;
  }
  return null;
}

/**
 * "List first, then each card fetches its own detail" (plan 051): after the
 * list resolves, read `itemDetail.path` once per row — through the SAME
 * transport the list used (the keyed proxy when `auth` is declared: the
 * fetch seam was already wrapped in `initialize`) — and merge
 * `{ ...row, ...detail }`, the detail winning on collisions. Every failure
 * degrades to the base row (a flaky detail must not blank a gallery that
 * already loaded): a missing id, a non-object detail body, or a thrown
 * read all keep the row and `console.warn`. Rows are schema-validated
 * AFTER the merge, so a resource schema must be satisfiable by the base
 * row alone — degradation-safe by construction.
 */
async function readItemDetails(
  rows: unknown[],
  template: string,
  getDetail: (path: string) => Promise<unknown>,
): Promise<unknown[]> {
  return Promise.all(
    rows.map(async (row, index) => {
      const id = itemIdOf(row);
      if (id === null) {
        console.warn(
          `[api-adapter] itemDetail: row ${index} has no id or url — keeping the base row.`,
        );
        return row;
      }
      const path = template
        .split(ITEM_DETAIL_PLACEHOLDER)
        .join(encodeURIComponent(id));
      try {
        const detail = await getDetail(path);
        if (!isPlainObject(detail)) {
          console.warn(
            `[api-adapter] itemDetail: the detail for "${id}" is not a JSON object — keeping the base row.`,
          );
          return row;
        }
        return isPlainObject(row) ? { ...row, ...detail } : row;
      } catch (error) {
        console.warn(
          `[api-adapter] itemDetail: the detail read for "${id}" failed — keeping the base row.`,
          error,
        );
        return row;
      }
    }),
  );
}

/**
 * Prefer the API's echoed record when it validates against the resource
 * schema (with the primary key guaranteed); otherwise `null` and the
 * caller keeps what it sent — 204s and non-record envelopes are common on
 * otherwise-successful writes.
 */
function echoedRecord(
  resource: NamedResourceDef,
  payload: unknown,
  fallbackId: unknown,
): Record<string, unknown> | null {
  if (!isPlainObject(payload)) return null;
  const pk = resolvePrimaryKey(resource);
  const candidate = { ...payload, [pk]: payload[pk] ?? fallbackId };
  try {
    validateRecord(resource, candidate);
    return candidate;
  } catch {
    return null;
  }
}

export function createApiAdapter(
  def: DataSourceDef,
  _context: AdapterContext,
  resolveFetch: () => ApiFetch | null = defaultResolveFetch,
): DataSourceAdapter {
  /** Canonical base (no trailing slash) — undefined until initialized. */
  let baseUrl: string | undefined;
  let itemsPath: string | undefined;
  let authRef: string | undefined;
  let itemDetailPath: string | undefined;
  let fetchImpl: ApiFetch | null | undefined;

  const requireReady = (): { base: string; fetch: ApiFetch } => {
    if (
      baseUrl === undefined ||
      fetchImpl === undefined ||
      fetchImpl === null
    ) {
      throw new DataError(
        DATA_ERROR_CODES.unavailable,
        'The "api" data source is not initialized (missing or invalid "baseUrl").',
      );
    }
    return { base: baseUrl, fetch: fetchImpl };
  };

  const collectionUrl = (resource: NamedResourceDef): string =>
    `${requireReady().base}/${encodeURIComponent(resolveCollection(resource))}`;

  const recordUrl = (resource: NamedResourceDef, id: string): string =>
    `${collectionUrl(resource)}/${encodeURIComponent(id)}`;

  const getJson = (url: string): Promise<unknown> => {
    const { fetch } = requireReady();
    return requestJson(fetch, url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  };

  const writeJson = (
    url: string,
    method: "POST" | "PATCH" | "DELETE",
    body?: unknown,
  ): Promise<unknown> => {
    const { fetch } = requireReady();
    return requestJson(fetch, url, {
      method,
      headers: { Accept: "application/json" },
      ...(body !== undefined
        ? {
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify(body),
          }
        : {}),
    });
  };

  return {
    provider: DATA_SOURCE_PROVIDERS.api,
    capabilities: CAPABILITIES,

    async initialize(): Promise<void> {
      if (baseUrl !== undefined && fetchImpl != null) return;
      // Defense in depth: the seams validate the spec's baseUrl already —
      // repeat it here in case a spec slipped past them (supabase pattern).
      const config = (def.config ?? {}) as ApiConfig;
      const problem = checkApiBaseUrl(config.baseUrl);
      if (problem) {
        throw new DataError(DATA_ERROR_CODES.malformed, problem);
      }
      if (
        config.itemsPath !== undefined &&
        (typeof config.itemsPath !== "string" ||
          !config.itemsPath.startsWith("/"))
      ) {
        throw new DataError(
          DATA_ERROR_CODES.malformed,
          '"itemsPath" must be a JSON pointer into the response, e.g. "/data".',
        );
      }
      // Per-row detail fan-out (051): { "path": "/pokemon/{id}" } — a
      // request path that must carry the literal placeholder, or every row
      // would fetch the same detail.
      if (config.itemDetail !== undefined) {
        const detail = config.itemDetail;
        const valid =
          typeof detail === "object" &&
          detail !== null &&
          !Array.isArray(detail) &&
          typeof (detail as { path?: unknown }).path === "string" &&
          (detail as { path: string }).path.startsWith("/") &&
          (detail as { path: string }).path.includes(ITEM_DETAIL_PLACEHOLDER);
        if (!valid) {
          throw new DataError(
            DATA_ERROR_CODES.malformed,
            '"itemDetail" must be an object like {"path": "/pokemon/{id}"} — a "/"-prefixed request path containing the literal "{id}" placeholder, which is filled per row.',
          );
        }
        itemDetailPath = (detail as { path: string }).path;
      }
      // Lane 2 (050): an auth declaration is shape-only (checkApiAuth
      // rejects unknown fields, so no key value can hide in it) and routes
      // every request through the server proxy, which holds the key.
      let auth: ApiKeyAuth | undefined;
      if (config.auth !== undefined) {
        const authProblem = checkApiAuth(config.auth);
        if (authProblem) {
          throw new DataError(DATA_ERROR_CODES.malformed, authProblem);
        }
        auth = config.auth as ApiKeyAuth;
      }
      const resolved = resolveFetch();
      if (!resolved) {
        throw new DataError(
          DATA_ERROR_CODES.unavailable,
          "fetch is not available in this environment.",
        );
      }
      baseUrl = normalizeApiBaseUrl(config.baseUrl as string);
      itemsPath =
        typeof config.itemsPath === "string" ? config.itemsPath : undefined;
      authRef = auth?.ref;
      fetchImpl =
        authRef !== undefined ? proxyFetchFor(authRef, resolved) : resolved;
    },

    async list(resource: NamedResourceDef): Promise<Record<string, unknown>[]> {
      const payload = await getJson(collectionUrl(resource));
      const rows =
        itemsPath !== undefined ? pickPointer(payload, itemsPath) : payload;
      if (!Array.isArray(rows)) {
        throw new DataError(
          DATA_ERROR_CODES.malformed,
          itemsPath !== undefined
            ? `The API response has no array at "${itemsPath}" (itemsPath).`
            : 'The API list response is not a JSON array — declare "itemsPath" to unwrap an envelope.',
        );
      }
      // Per-row detail reads (051): "list first, then each card fetches its
      // own detail" — the fan-out runs here so specs stay plain bindings.
      // It rides `getJson`, i.e. the SAME transport as the list (the keyed
      // proxy when `auth` is declared); each failure keeps its base row.
      let detailed: unknown[] = rows;
      if (itemDetailPath !== undefined) {
        const { base } = requireReady();
        detailed = await readItemDetails(rows, itemDetailPath, (path) =>
          getJson(`${base}${path}`),
        );
      }
      return detailed.map((row, index) => {
        if (!isPlainObject(row)) {
          throw new DataError(
            DATA_ERROR_CODES.malformed,
            `Item ${index} of the API list response is not a JSON object.`,
          );
        }
        validateRecord(resource, row);
        return row;
      });
    },

    async get(
      resource: NamedResourceDef,
      id: string,
    ): Promise<Record<string, unknown> | null> {
      let payload: unknown;
      try {
        payload = await getJson(recordUrl(resource, id));
      } catch (error) {
        // A missing record reads as null (contract), not a thrown 404.
        if (
          error instanceof DataError &&
          error.code === DATA_ERROR_CODES.notFound
        ) {
          return null;
        }
        throw error;
      }
      if (!isPlainObject(payload)) {
        throw new DataError(
          DATA_ERROR_CODES.malformed,
          "The API record response is not a JSON object.",
        );
      }
      validateRecord(resource, payload);
      return payload;
    },

    async create(
      resource: NamedResourceDef,
      input: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
      const record = {
        ...input,
        [resolvePrimaryKey(resource)]: crypto.randomUUID(),
      };
      validateRecord(resource, record);
      const payload = await writeJson(collectionUrl(resource), "POST", record);
      return (
        echoedRecord(resource, payload, record[resolvePrimaryKey(resource)]) ??
        record
      );
    },

    async update(
      resource: NamedResourceDef,
      id: string,
      patch: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
      // Read-modify-write like the supabase adapter: the merged record is
      // validated BEFORE it is sent, so partial patches obey the schema and
      // the returned record is complete even when the API echoes a stub.
      const current = await this.get(resource, id);
      if (current === null) {
        throw new DataError(
          DATA_ERROR_CODES.notFound,
          `No record with id "${id}" in resource "${resource.name}".`,
        );
      }
      const merged = { ...current, ...patch };
      validateRecord(resource, merged);
      const payload = await writeJson(recordUrl(resource, id), "PATCH", merged);
      return echoedRecord(resource, payload, id) ?? merged;
    },

    async delete(resource: NamedResourceDef, id: string): Promise<void> {
      await writeJson(recordUrl(resource, id), "DELETE");
    },

    async dispose(): Promise<void> {
      baseUrl = undefined;
      itemsPath = undefined;
      authRef = undefined;
      itemDetailPath = undefined;
      fetchImpl = null;
    },
  };
}
