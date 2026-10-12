import type { Spec } from "@json-render/core";
import { createClient } from "@/lib/supabase/server";

/**
 * Server-side reads of the public projection: the featured root page
 * (`site_settings` singleton) and published pages by slug. Both are
 * world-readable via RLS, so the anon-key server client suffices — logged-in
 * cookies only widen writes.
 */

export interface LivePageData {
  slug: string;
  name: string;
  version: number;
  spec: Spec;
}

function toLivePage(row: Record<string, unknown> | null): LivePageData | null {
  if (!row || typeof row.slug !== "string" || typeof row.spec !== "object") {
    return null;
  }
  return {
    slug: row.slug,
    name: typeof row.name === "string" ? row.name : row.slug,
    version: typeof row.version === "number" ? row.version : 1,
    spec: row.spec as Spec,
  };
}

/** Featured root page — null when nothing is featured (root falls back). */
export async function getFeaturedPage(): Promise<LivePageData | null> {
  const supabase = await createClient();
  const { data: settings } = await supabase
    .from("site_settings")
    .select("featured_ui_id")
    .eq("id", true)
    .maybeSingle();
  if (!settings?.featured_ui_id) return null;

  const { data: page } = await supabase
    .from("published_pages")
    .select("slug, name, version, spec")
    .eq("ui_id", settings.featured_ui_id)
    .maybeSingle();
  return toLivePage(page);
}

/** Published page at /{locale}/{slug} — the world-visible live URL. */
export async function getPublishedPageBySlug(
  slug: string,
): Promise<LivePageData | null> {
  const supabase = await createClient();
  const { data: page } = await supabase
    .from("published_pages")
    .select("slug, name, version, spec")
    .eq("slug", slug)
    .maybeSingle();
  return toLivePage(page);
}
