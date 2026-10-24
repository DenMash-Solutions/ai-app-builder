/**
 * Client-side cache invalidation hop (plan 055 C).
 *
 * The projection tables are share-cached server-side, but the mutations
 * that change them (publish / unpublish / feature) run in the browser
 * against the Supabase REST API — and `revalidateTag` is server-only. So
 * after a successful write the client pokes `POST /api/revalidate`, whose
 * route handler expires the tags immediately (next request = fresh data).
 *
 * Fire-and-forget: a failed poke self-heals via the fetch-level 60s TTL
 * fallback in `projectionRestFetch`, so publishing never blocks on it.
 */

import type { PROJECTION_TABLES } from "@/lib/supabase/projection-cache";

export type ProjectionTag = (typeof PROJECTION_TABLES)[number];

export function revalidateProjection(tags: readonly ProjectionTag[]): void {
  if (typeof window === "undefined") return;
  void fetch("/api/revalidate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tags }),
  }).catch(() => {
    // Best effort — the TTL fallback covers a missed invalidation.
  });
}
