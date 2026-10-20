import {
  API_AUTH_REF_PATTERN,
  AUTH_HEADER_NAME_PATTERN,
} from "../data-sources/api-auth";
import { checkApiBaseUrl, normalizeApiBaseUrl } from "../data-sources/api-url";

/**
 * Server-held key pairs for the keyed API lane (docs/plan/050-keyed-api-lane).
 * Each keyed api data source declares `config.auth.ref` in its spec; the
 * deployment maps that ref to an origin + key through env vars:
 *
 *   DATA_PROXY_<REF>_ORIGIN   bare https origin the key may reach (required)
 *   DATA_PROXY_<REF>_KEY      the secret value, server-only (required)
 *   DATA_PROXY_<REF>_HEADER   custom header name (optional; default
 *                             "Authorization: Bearer <key>")
 *
 * The pairing is the whole security model: a key is ONLY ever sent to its
 * configured origin, the client names a path (never a URL), and redirects
 * are refused — so the proxy cannot be steered into an SSRF/key-harvest
 * primitive without a hardened egress worker (the surface plan 048
 * declined to import). Incomplete or invalid pairs are skipped — the ref
 * then reads as unconfigured and the proxy answers `unknown_ref`.
 */

/** One deployment-held, origin-bound key. */
export interface DataProxyRef {
  /** Bare https origin (no path/query/fragment) the key may be sent to. */
  origin: string;
  /** Secret value — never logged, never echoed, never sent to a browser. */
  key: string;
  /** Custom header name from the env pair; null → Authorization: Bearer. */
  headerName: string | null;
}

/** The auth header the proxy injects for this ref (server-side only). */
export const dataProxyAuthHeaders = (
  ref: DataProxyRef,
): Record<string, string> =>
  ref.headerName === null
    ? { Authorization: `Bearer ${ref.key}` }
    : { [ref.headerName]: ref.key };

/** Env vars that participate in a ref's triple. */
const REF_ENV_PATTERN = /^DATA_PROXY_([A-Z][A-Z0-9_]*)_(ORIGIN|KEY|HEADER)$/;

const REF_PARTS = {
  origin: "ORIGIN",
  key: "KEY",
  header: "HEADER",
} as const;

type EnvLike = Record<string, string | undefined>;

/**
 * A configured origin must pass the SAME URL policy a spec-declared
 * baseUrl passes (https outside localhost, no userinfo/query/fragment, no
 * private/link-local addresses) AND be a bare origin — the proxy appends
 * the client's path to it, so a path component here would smuggle a
 * prefix into every request.
 */
function checkRefOrigin(raw: string): string | null {
  const problem = checkApiBaseUrl(raw);
  if (problem) return problem;
  if (new URL(raw).pathname !== "/") {
    return "A ref origin must be bare (https://api.example.com) — no path component.";
  }
  return null;
}

/**
 * Scans an env surface for `DATA_PROXY_*` pairs and returns the refs that
 * are complete and valid. Invalid or incomplete triples are skipped, not
 * fatal: a typo degrades that one ref to "unconfigured" (the proxy's
 * `unknown_ref` diagnostic names it) instead of breaking every other key.
 */
export function parseDataProxyRefs(env: EnvLike): Map<string, DataProxyRef> {
  const collected = new Map<
    string,
    { origin?: string; key?: string; header?: string }
  >();
  for (const [name, value] of Object.entries(env)) {
    if (typeof value !== "string" || value.trim() === "") continue;
    const match = REF_ENV_PATTERN.exec(name);
    if (!match) continue;
    const ref = match[1].toLowerCase();
    if (!API_AUTH_REF_PATTERN.test(ref)) continue;
    const entry = collected.get(ref) ?? {};
    if (match[2] === REF_PARTS.origin) entry.origin = value.trim();
    else if (match[2] === REF_PARTS.key) entry.key = value;
    else entry.header = value.trim();
    collected.set(ref, entry);
  }

  const refs = new Map<string, DataProxyRef>();
  for (const [ref, entry] of collected) {
    if (entry.origin === undefined || entry.key === undefined) continue;
    if (checkRefOrigin(entry.origin) !== null) continue;
    if (
      entry.header !== undefined &&
      !AUTH_HEADER_NAME_PATTERN.test(entry.header)
    ) {
      continue;
    }
    refs.set(ref, {
      origin: normalizeApiBaseUrl(entry.origin),
      key: entry.key,
      headerName: entry.header ?? null,
    });
  }
  return refs;
}
