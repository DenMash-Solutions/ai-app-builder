import { revalidateTag } from "next/cache";
import { sanitizeTags } from "@/lib/supabase/projection-cache";

/**
 * Expires projection cache tags (plan 055 C) after client-side mutations —
 * the browser writes straight to Supabase REST, so this route is the
 * server-side hop where `revalidateTag` can run. `{ expire: 0 }`: the next
 * request blocks for fresh data (read-your-own-writes — publishing then
 * reloading must show the new version).
 *
 * Open by design: purging only forces fresh reads of world-readable
 * tables (no data exposure, no state beyond "refetch"); `sanitizeTags`
 * rejects anything that is not a published projection tag.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const tags = sanitizeTags((body as { tags?: unknown } | null)?.tags);
  if (tags.length === 0) {
    return Response.json({ error: "No known tags" }, { status: 400 });
  }

  for (const tag of tags) {
    revalidateTag(tag, { expire: 0 });
  }
  return Response.json({ revalidated: tags });
}
