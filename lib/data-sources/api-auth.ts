/**
 * Auth policy for keyed api data sources (docs/plan/050-keyed-api-lane,
 * Lane 2). The spec declares the SHAPE — `{ type, header?, ref }` — and
 * the VALUE lives only in deployment env pairs (`lib/data-proxy/refs.ts`),
 * which the `/api/data-proxy` route injects server-side. `auth` is thus
 * credential-shaped but credential-FREE by construction: the ref name is
 * the only thing a spec can carry, the browser never holds a key, and the
 * existing `CREDENTIAL_CONFIG_KEYS` rejection keeps guarding every other
 * config key at the three write seams.
 *
 * The client-side `type`/`header` fields are declarative documentation
 * for humans reading the spec — the proxy trusts NOTHING from the client:
 * the injected header name and style come from the server's own env pair
 * (decision 2 + the "client never names a URL" rule in the plan).
 */

/** Auth styles a spec may declare (values are held server-side only). */
export const API_AUTH_TYPES = {
  bearer: "bearer",
  header: "header",
} as const;

export type ApiAuthType = (typeof API_AUTH_TYPES)[keyof typeof API_AUTH_TYPES];

/**
 * Ref names are lowercase, env-pair friendly: `weather_api` maps to
 * `DATA_PROXY_WEATHER_API_ORIGIN/KEY` and back without ambiguity.
 */
export const API_AUTH_REF_PATTERN = /^[a-z][a-z0-9_]*$/;

/** Header names accepted in env pairs and specs (RFC 9110 token-ish). */
export const AUTH_HEADER_NAME_PATTERN = /^[A-Za-z0-9-]+$/;

/** The validated shape a spec's `config.auth` must have. */
export interface ApiKeyAuth {
  type: ApiAuthType;
  /** Named header when `type` is "header" (bearer implies Authorization). */
  header?: string;
  /** Server-side lookup key: DATA_PROXY_<REF>_ORIGIN/KEY. */
  ref: string;
}

const AUTH_FIELDS = ["type", "ref", "header"] as const;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Returns an error message when `raw` is not an acceptable `config.auth`
 * declaration, or `null` when it is. Used at the validation seams AND in
 * the adapter's initialize (defense in depth) so both surfaces report the
 * identical wording. Deliberately strict: unknown fields are rejected so
 * a key value cannot hide inside the object (`{"auth": {"key": "sk-…"}}`
 * fails here even before the credential-key check would catch it).
 */
export function checkApiAuth(raw: unknown): string | null {
  if (!isPlainObject(raw)) {
    return 'config.auth must be an object like {"type": "bearer", "ref": "weather"}.';
  }
  for (const key of Object.keys(raw)) {
    if (!(AUTH_FIELDS as readonly string[]).includes(key)) {
      return `config.auth takes only "type", "ref" and "header" — remove "${key}" (keys are values and never live in specs).`;
    }
  }
  if (
    raw.type !== API_AUTH_TYPES.bearer &&
    raw.type !== API_AUTH_TYPES.header
  ) {
    return 'config.auth.type must be "bearer" (Authorization: Bearer <key>) or "header" (a named custom header).';
  }
  if (typeof raw.ref !== "string" || !API_AUTH_REF_PATTERN.test(raw.ref)) {
    return 'config.auth.ref must be a lowercase name like "weather" — it looks up the server-held key (DATA_PROXY_<REF>_ORIGIN and _KEY).';
  }
  if (raw.type === API_AUTH_TYPES.header) {
    if (
      typeof raw.header !== "string" ||
      !AUTH_HEADER_NAME_PATTERN.test(raw.header)
    ) {
      return 'config.auth.header must be a header name like "X-API-Key" when type is "header".';
    }
  } else if (raw.header !== undefined) {
    return 'config.auth.header only applies when type is "header" — omit it for "bearer".';
  }
  return null;
}
