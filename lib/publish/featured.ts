import type { Spec } from "@json-render/core";
import { createClient, createPublicReadClient } from "@/lib/supabase/server";
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
  const { data: settings, error } = await supabase
    .from("site_settings")
    .select("featured_ui_id")
    .eq("id", true)
    .maybeSingle();
  if (error) {
    console.error(
      `[featured] proxy site_settings read failed: ${error.message}`,
    );
    return [];
  }
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
  const { data, error } = await supabase
    .from("published_pages")
    .select("slug")
    .eq("slug", slug)
    .maybeSingle();
  if (error) {
    // Keep the boolean contract (a check that throws breaks callers), but
    // never let a failed read pass as silent "does not exist".
    console.error(
      `[featured] published_pages slug check failed for "${slug}": ${error.message}`,
    );
    return false;
  }
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
  const { data: settings, error: settingsError } = await supabase
    .from("site_settings")
    .select("featured_ui_id")
    .eq("id", true)
    .maybeSingle();

  if (settingsError) {
    // A failed read must be VISIBLE — never masquerade as "not featured"
    // (that silently swaps the root for the Playground). Loud, then null.
    console.error(
      `[featured] site_settings read failed — root falls back to Playground: ${settingsError.message}`,
    );
    return null;
  }
  if (!settings?.featured_ui_id) return null; // genuine "nothing featured".

  const { data: page, error: pageError } = await supabase
    .from("published_pages")
    .select("slug, name, version, spec, artifacts")
    .eq("ui_id", settings.featured_ui_id)
    .maybeSingle();

  if (pageError) {
    console.error(
      `[featured] published_pages read failed for ${settings.featured_ui_id} — root falls back to Playground: ${pageError.message}`,
    );
    return null;
  }
  if (page === null) {
    // Dangling pointer: FK-unreachable featured id (abnormal — the seed
    // matrix only ever warns about this state, nothing repairs it).
    console.warn(
      `[featured] featured_ui_id=${settings.featured_ui_id} has no published page — root falls back to Playground`,
    );
  }
  return toLivePage(page);
}

export async function getPublishedPageBySlugFrom(
  supabase: ProjectionClient,
  slug: string,
): Promise<LivePageData | null> {
  const { data: page, error } = await supabase
    .from("published_pages")
    .select("slug, name, version, spec, artifacts")
    .eq("slug", slug)
    .maybeSingle();
  if (error) {
    console.error(
      `[featured] published_pages read failed for slug "${slug}": ${error.message}`,
    );
    return null;
  }
  return toLivePage(page);
}

/** Featured root page — null when nothing is featured (root falls back). */
export async function getFeaturedPage(): Promise<LivePageData | null> {
  // Cookie-free public read (see createPublicReadClient): prerenderable.
  return getFeaturedPageFrom(createPublicReadClient());
}

/** Published page at /{locale}/{slug} — the world-visible live URL. */
export async function getPublishedPageBySlug(
  slug: string,
): Promise<LivePageData | null> {
  return getPublishedPageBySlugFrom(createPublicReadClient(), slug);
}
