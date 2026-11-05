import { revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Persist publish-baked artifacts (plan §5 + 069 task 5): the calling dialog
 * renders static HTML per language (client React) and compiles CSS via
 * `/api/tailwind`, then posts the assembled per-tag map here. No React in
 * this route — it only writes what the client baked. Two payloads:
 *
 *   `{ uiId, version, artifacts }`        → `published_pages` (screen bake)
 *   `{ projectId, route, version,
 *      artifacts }`                       → `published_entry_points`
 *                                            (per-route project bake, keyed
 *                                            project + route, home = `''`)
 *
 * Version-guarded: the write only lands on the exact version that was baked,
 * so a re-published (newer) entry is never overwritten with stale markup
 * from a slower in-flight bake. RLS gates the write — the cookie-
 * authenticated server client is the owner.
 *
 * Each branch invalidates ITS OWN projection tag beside the write (the
 * cache-invalidation-writers lesson): the screen branch revalidates
 * `published_pages`; the project branch revalidates `published_entry_points`
 * (`PROJECTION_TABLES` already allowlists it).
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const payload = (body ?? {}) as {
    uiId?: unknown;
    projectId?: unknown;
    route?: unknown;
    version?: unknown;
    artifacts?: unknown;
  };
  if (
    typeof payload.version !== "number" ||
    typeof payload.artifacts !== "object" ||
    payload.artifacts === null ||
    Array.isArray(payload.artifacts)
  ) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const supabase = await createClient();
  if (typeof payload.uiId === "string" && payload.uiId.length > 0) {
    const { error } = await supabase
      .from("published_pages")
      .update({ artifacts: payload.artifacts })
      .eq("ui_id", payload.uiId)
      .eq("version", payload.version);
    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    // Server-side hop — expire the share-cached projection immediately so
    // the baked markup lands on the next page load (055 C).
    revalidateTag("published_pages", { expire: 0 });
    return Response.json({ ok: true });
  }

  if (
    typeof payload.projectId === "string" &&
    payload.projectId.length > 0 &&
    typeof payload.route === "string"
  ) {
    const { error } = await supabase
      .from("published_entry_points")
      .update({ artifacts: payload.artifacts })
      .eq("project_id", payload.projectId)
      .eq("route", payload.route)
      .eq("version", payload.version);
    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    revalidateTag("published_entry_points", { expire: 0 });
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Invalid payload" }, { status: 400 });
}
