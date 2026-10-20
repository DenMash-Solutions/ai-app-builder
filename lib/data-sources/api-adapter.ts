import type {
  AdapterCapabilities,
  AdapterContext,
  DataSourceAdapter,
} from "./adapter";
import { checkApiBaseUrl, normalizeApiBaseUrl } from "./api-url";
import { validateRecord } from "./record-validate";
import { DATA_SOURCE_PROVIDERS, DATA_ERROR_CODES, DataError } from "./types";
import type { DataSourceDef, NamedResourceDef } from "./types";

/**
 * Milestone 3 adapter (docs/plan/api-data-source): a plain HTTPS JSON API,
 * fetched DIRECTLY by the visitor's browser (Lane 1 — keyless public
 * endpoints, no server route, no egress worker). The spec declares the
 * origin (`config.baseUrl`), the resource's `collection` is the path
 * segment, and the standard REST verbs map onto the provider-independent
 * CRUD contract — the query manager and `data_mutate` stay blind to all of
 * it. The fetch resolver is injectable so unit tests run on a fake without
 * a network (the supabase adapter's surface-mock pattern).
 *
 * The URL is policed at the three validation seams AND here (defense in
 * depth, mirroring the supabase config check): https outside localhost, no
 * userinfo/query/fragment, no literal private/link-local addresses.
 */

/** Injectable fetch surface — same DI stance as `resolveStorage`. */
export type ApiFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Bounds every request so a hanging API cannot pin `pending` forever. */
const REQUEST_TIMEOUT_MS = 15_000;

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
      fetchImpl = resolved;
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
      return rows.map((row, index) => {
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
      fetchImpl = null;
    },
  };
}
