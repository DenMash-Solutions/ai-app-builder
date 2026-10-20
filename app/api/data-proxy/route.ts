import { API_AUTH_REF_PATTERN } from "@/lib/data-sources/api-auth";
import {
  dataProxyAuthHeaders,
  parseDataProxyRefs,
} from "@/lib/data-proxy/refs";

/**
 * The keyed-API lane's server route (docs/plan/050-keyed-api-lane). The
 * browser POSTs `{ ref, path, method?, body? }` and NOTHING else — the
 * origin, the header name and the key value all come from the
 * deployment's `DATA_PROXY_<REF>_*` env pairs, so a client can never
 * steer where a key goes (decision 1: the client never names a URL).
 *
 * Posture, since this is the one route that holds secrets:
 * - the ref must resolve to a configured pair (else 404 `unknown_ref`);
 * - the path must stay on that pair's origin (`//host`, absolute URLs
 *   and scheme tricks are rejected before any fetch);
 * - redirects are refused (`redirect: "error"`) so a keyed API cannot
 *   bounce the key to another host;
 * - responses are size-capped and time-bounded;
 * - the key appears in no log line, no error body and no response.
 *
 * Upstream statuses pass through untouched — the api adapter's existing
 * error normalization maps them exactly as it maps Lane 1 responses, so
 * the proxy is a transparent transport from the client's perspective.
 */

/** Verbs the CRUD mapping produces — the proxy forwards exactly those. */
const PROXY_METHODS = {
  get: "GET",
  post: "POST",
  patch: "PATCH",
  delete: "DELETE",
} as const;

/** Upstream bounds so a keyed API cannot pin the route forever. */
const UPSTREAM_TIMEOUT_MS = 10_000;
export const DATA_PROXY_MAX_RESPONSE_BYTES = 2_000_000;

const badRequest = (message: string): Response =>
  Response.json({ error: message }, { status: 400 });

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export async function POST(request: Request): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return badRequest(
      "The proxy body must be JSON: { ref, path, method?, body? }.",
    );
  }
  if (!isPlainObject(raw)) {
    return badRequest(
      "The proxy body must be an object: { ref, path, method?, body? }.",
    );
  }

  const { ref, path, method, body: payload } = raw;
  if (typeof ref !== "string" || !API_AUTH_REF_PATTERN.test(ref)) {
    return badRequest(
      'A lowercase "ref" names the server-held key, e.g. {"ref": "weather"}.',
    );
  }
  if (
    typeof path !== "string" ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.startsWith("/\\")
  ) {
    return badRequest(
      'The proxy "path" must be a same-origin relative path like "/v1/forecast".',
    );
  }
  const verb =
    method === undefined
      ? PROXY_METHODS.get
      : typeof method === "string"
        ? method
        : null;
  if (
    verb === null ||
    !(Object.values(PROXY_METHODS) as string[]).includes(verb)
  ) {
    return badRequest(
      `The proxy forwards only ${Object.values(PROXY_METHODS).join(", ")} requests.`,
    );
  }

  const configured = parseDataProxyRefs(process.env).get(ref);
  if (!configured) {
    return Response.json({ error: "unknown_ref", ref }, { status: 404 });
  }

  // Same-origin enforcement: the URL resolves against the CONFIGURED
  // origin, and any origin drift (a tricked parse, a different host)
  // aborts before a single byte leaves.
  let target: URL;
  try {
    target = new URL(path, configured.origin);
  } catch {
    return badRequest(
      'The proxy "path" must be a same-origin relative path like "/v1/forecast".',
    );
  }
  if (target.origin !== new URL(configured.origin).origin) {
    return badRequest("The proxy only calls the ref's configured origin.");
  }

  let response: Response;
  try {
    response = await fetch(target, {
      method: verb,
      headers: {
        Accept: "application/json",
        ...dataProxyAuthHeaders(configured),
        ...(payload !== undefined && verb !== PROXY_METHODS.get
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body:
        payload !== undefined && verb !== PROXY_METHODS.get
          ? JSON.stringify(payload)
          : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return Response.json({ error: "upstream_timeout" }, { status: 504 });
    }
    return Response.json({ error: "upstream_unreachable" }, { status: 502 });
  }

  const text = await response.text();
  if (text.length > DATA_PROXY_MAX_RESPONSE_BYTES) {
    return Response.json({ error: "upstream_too_large" }, { status: 502 });
  }
  return new Response(text === "" ? null : text, {
    status: response.status,
    headers: {
      "Content-Type":
        response.headers.get("Content-Type") ?? "application/json",
    },
  });
}
