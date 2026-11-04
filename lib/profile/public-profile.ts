import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Public profile reads (plan 068), kept out of the route so the "who is this
 * handle and what did they publish" logic is unit-testable.
 *
 * Both reads run on the anon key: `public_profile` is a SECURITY DEFINER RPC
 * that returns only `(id, username)` — opening `profiles` to the world at
 * table level would also expose `email`, because the grants are table-level.
 */

export const PROFILE_RPC = "public_profile";

/** Explicit columns: the published spec body must never reach this page. */
export const PROFILE_PAGE_COLUMNS = "ui_id, slug, name, version, published_at";

export interface ProfilePageSummary {
  ui_id: string;
  slug: string;
  name: string;
  version: number;
  published_at: string;
}

export interface PublicProfile {
  id: string;
  username: string;
  pages: ProfilePageSummary[];
}

/** Resolves a handle to its owner and that owner's published pages. `null`
 *  means "no such profile" (or a failed read) — the route answers 404. */
export async function readPublicProfile(
  supabase: SupabaseClient,
  rawUsername: string,
): Promise<PublicProfile | null> {
  const { data: profiles, error } = await supabase.rpc(PROFILE_RPC, {
    p_username: rawUsername,
  });
  if (error) {
    console.error(`[profile] public_profile failed: ${error.message}`);
    return null;
  }
  const profile = Array.isArray(profiles) ? profiles[0] : undefined;
  if (!profile || typeof profile.id !== "string") return null;

  const { data: pages, error: pagesError } = await supabase
    .from("published_pages")
    .select(PROFILE_PAGE_COLUMNS)
    .eq("owner_id", profile.id)
    .order("published_at", { ascending: false });
  if (pagesError) {
    console.error(
      `[profile] published_pages read failed: ${pagesError.message}`,
    );
    return null;
  }

  return {
    id: profile.id,
    username:
      typeof profile.username === "string" ? profile.username : rawUsername,
    pages: (pages ?? []) as ProfilePageSummary[],
  };
}
