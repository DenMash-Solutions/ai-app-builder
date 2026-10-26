import type { Spec } from "@json-render/core";
import { createClient } from "@/lib/supabase/server";
import { availableLanguagesOfState } from "@/lib/i18n/spec-languages";
import { parseArtifacts } from "@/lib/publish/artifacts";
import type { BakedArtifact } from "@/lib/publish/artifacts";

/** Any anon-key server client (RSC `createClient` or the proxy's). */
export type ProjectionClient = Awaited<ReturnType<typeof createClient>>;

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
  /** Baked per-language artifacts (null on pre-bake pages — serve client). */
  artifacts: Record<string, BakedArtifact> | null;
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
    artifacts: parseArtifacts(row.artifacts),
  };
}

/**
 * Slim proxy reads (plan 056): the proxy's decision-12 check must stay fast
 * and avoid fetching full content (`loading.md` Status Codes) — its fetch
 * runs outside the RSC data cache, so every call is a live roundtrip.
 */
export async function getFeaturedLanguagesFrom(
  supabase: ProjectionClient,
): Promise<string[]> {
  const { data: settings } = await supabase
    .from("site_settings")
    .select("featured_ui_id")
    .eq("id", true)
    .maybeSingle();
  if (!settings?.featured_ui_id) return [];
  const { data: page } = await supabase
    .from("published_pages")
    .select("spec->state")
    .eq("ui_id", settings.featured_ui_id)
    .maybeSingle();
  // PostgREST arrow-projection result: Json by contract, the state object
  // by schema (same trust as `row.spec as Spec` above).
  return page
    ? availableLanguagesOfState(page.state as unknown as Spec["state"])
    : [];
}

export async function publishedSlugExistsFrom(
  supabase: ProjectionClient,
  slug: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("published_pages")
    .select("slug")
    .eq("slug", slug)
    .maybeSingle();
  return data !== null;
}

/**
 * Client-injected variants so the proxy can run the same decision-12 reads
 * without `next/headers` (plan 056: bare-segment status decisions moved to
 * the proxy — under Cache Components the streamed shell fixes the status at
 * 200 before the page's `notFound()`/`redirect()` can fire).
 */
export async function getFeaturedPageFrom(
  supabase: ProjectionClient,
): Promise<LivePageData | null> {
  const { data: settings } = await supabase
    .from("site_settings")
    .select("featured_ui_id")
    .eq("id", true)
    .maybeSingle();
  if (!settings?.featured_ui_id) return null;

  const { data: page } = await supabase
    .from("published_pages")
    .select("slug, name, version, spec, artifacts")
    .eq("ui_id", settings.featured_ui_id)
    .maybeSingle();
  return toLivePage(page);
}

export async function getPublishedPageBySlugFrom(
  supabase: ProjectionClient,
  slug: string,
): Promise<LivePageData | null> {
  const { data: page } = await supabase
    .from("published_pages")
    .select("slug, name, version, spec, artifacts")
    .eq("slug", slug)
    .maybeSingle();
  return toLivePage(page);
}

/** Featured root page — null when nothing is featured (root falls back). */
export async function getFeaturedPage(): Promise<LivePageData | null> {
  return getFeaturedPageFrom(await createClient());
}

/** Published page at /{locale}/{slug} — the world-visible live URL. */
export async function getPublishedPageBySlug(
  slug: string,
): Promise<LivePageData | null> {
  return getPublishedPageBySlugFrom(await createClient(), slug);
}
