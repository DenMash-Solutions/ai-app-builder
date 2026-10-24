/**
 * Share-cached reads of the world-readable projection (plan 055 C).
 *
 * The published-UI reads (`getPublishedPageBySlug`, `getFeaturedPage`,
 * the admin overview) used to hit Supabase REST on EVERY request. The two
 * projection tables are world-readable and identical for every viewer, so
 * their GETs are safe to share-cache: the server client passes
 * `projectionRestFetch`, which tags whitelisted table reads with
 * `cache: "force-cache"` (+ a 60s time-based revalidation as the
 * failure-path self-heal) — invalidation happens per tag through
 * `POST /api/revalidate` (client-side mutations) or `revalidateTag`
 * directly (route handlers), expiring immediately so the NEXT request
 * already sees the new version (read-your-own-writes).
 *
 * Everything else — auth, profiles, page_versions (private!), writes —
 * passes through untouched with the default no-store behavior.
 */

/** GETs of these tables are share-cached; nothing else ever is. */
export const PROJECTION_TABLES = ["published_pages", "site_settings"] as const;

const REST_TABLE_PATTERN = /\/rest\/v1\/([a-z_]+)(?:\?|$)/;

function isProjectionTable(value: string): boolean {
  return (PROJECTION_TABLES as readonly string[]).includes(value);
}

/** Keeps only tags this app actually publishes — rejects anything else
 *  (unknown tags could never be invalidated and would just accumulate). */
export function sanitizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.filter(
    (tag): tag is string => typeof tag === "string" && isProjectionTable(tag),
  );
}

type FetchImpl = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Wraps the global fetch: whitelisted `GET /rest/v1/<table>` requests get
 * Next's data-cache options; every other request is passed through with
 * its init untouched. `fetchImpl` is injectable for tests.
 *
 * Exported via `Object.assign` with `preconnect`: supabase's `global.fetch`
 * wants the exact `typeof fetch` shape, which bun-types declares with that
 * static (a Bun extension the app never calls — forwarded for type parity;
 * undefined at runtime in Node and harmless).
 */
function projectionFetchImpl(
  input: RequestInfo | URL,
  init?: RequestInit,
  fetchImpl: FetchImpl = fetch,
): Promise<Response> {
  const method = init?.method?.toUpperCase() ?? "GET";
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  const table = method === "GET" ? REST_TABLE_PATTERN.exec(url)?.[1] : null;
  if (!table || !isProjectionTable(table)) return fetchImpl(input, init);
  return fetchImpl(input, {
    ...init,
    next: {
      cache: "force-cache",
      // Failure-path self-heal only: a missed invalidation (tab closed
      // between the write and /api/revalidate) refreshes within a minute.
      // Correct invalidations never wait on this — tags expire at once.
      revalidate: 60,
      tags: [table],
    },
  } as RequestInit);
}

export const projectionRestFetch = Object.assign(projectionFetchImpl, {
  preconnect: fetch.preconnect,
});
