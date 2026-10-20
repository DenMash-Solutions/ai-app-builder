/**
 * URL policy for the "api" provider (docs/plan/api-data-source, decisions
 * 2 & 5): the spec declares the base URL, so both the three validation
 * seams and the adapter runtime enforce the same shape rules — https
 * everywhere except local development, no userinfo, query string or
 * fragment (a query string would smuggle credential-shaped values past the
 * config-key check), and no literal private/link-local/metadata addresses.
 * Hostnames are resolved and bounded by the browser (CORS, Lane 1 —
 * browser-direct), so only literal IP forms are checkable here.
 */

/** Hostnames allowed for plain http (dev/e2e only). */
const LOCAL_HOSTNAMES = new Set(["localhost", "::1", "[::1]"]);

const isLocalHostname = (hostname: string): boolean =>
  LOCAL_HOSTNAMES.has(hostname) || /^127(\.\d{1,3}){3}$/.test(hostname);

/** Literal IPv4 forms a spec must never target (private/reserved ranges). */
const BLOCKED_IPV4_PATTERNS: RegExp[] = [
  /^0(\.\d{1,3}){3}$/, // unspecified (0.0.0.0/8)
  /^10(\.\d{1,3}){3}$/, // private 10/8
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])(\.\d{1,3}){2}$/, // CGNAT 100.64/10
  /^172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}$/, // private 172.16/12
  /^192\.168(\.\d{1,3}){2}$/, // private 192.168/16
  /^169\.254(\.\d{1,3}){2}$/, // link-local, incl. cloud metadata
  /^255\.255\.255\.255$/, // broadcast
];

const isBlockedIpv4 = (hostname: string): boolean =>
  BLOCKED_IPV4_PATTERNS.some((pattern) => pattern.test(hostname));

const isBlockedIpv6 = (hostname: string): boolean => {
  const bare = hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  return (
    bare.startsWith("fc") || // unique local fc00::/7
    bare.startsWith("fd") ||
    bare.startsWith("fe80") || // link-local
    bare === "::" // unspecified
  );
};

/**
 * Returns an error message when `raw` is not an acceptable spec-declared
 * API baseUrl, or `null` when it is. Used at the validation seams AND in
 * the adapter's initialize (defense in depth, the supabase config check's
 * pattern) so both surfaces report the identical wording.
 */
export function checkApiBaseUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim() === "") {
    return 'The "api" provider needs a "baseUrl" string, e.g. {"baseUrl": "https://api.example.com"}.';
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return `"baseUrl" must be an absolute URL like "https://api.example.com" (got "${raw}").`;
  }
  const local = isLocalHostname(url.hostname);
  if (url.protocol === "http:") {
    if (!local) {
      return "Use https for API baseUrls — plain http is only allowed for localhost (development/e2e).";
    }
  } else if (url.protocol !== "https:") {
    return `"baseUrl" must be https (got protocol "${url.protocol}").`;
  }
  if (url.username !== "" || url.password !== "") {
    return '"baseUrl" must not embed credentials (user:pass@…) — specs never carry secrets.';
  }
  if (url.search !== "") {
    return '"baseUrl" must not include a query string — declare a plain base URL (query values would bypass the credential check).';
  }
  if (url.hash !== "") {
    return '"baseUrl" must not include a fragment (#…).';
  }
  if (!local) {
    if (isBlockedIpv4(url.hostname)) {
      return `"baseUrl" targets a private/link-local address (${url.hostname}) — public endpoints only.`;
    }
    if (url.hostname.includes(":") && isBlockedIpv6(url.hostname)) {
      return `"baseUrl" targets a private/link-local IPv6 address (${url.hostname}) — public endpoints only.`;
    }
  }
  return null;
}

/** Canonical form the adapter builds paths from (no trailing slashes). */
export function normalizeApiBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}
