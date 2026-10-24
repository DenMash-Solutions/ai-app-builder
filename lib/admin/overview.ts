import { asPublishClient } from "@/lib/publish/publish";
import { revalidateProjection } from "@/lib/publish/revalidate";
import type { AdminPageSummary } from "./admin-spec"; /**
 * Admin overview: every published page (world-readable projection, enriched
 * with the owner email readable by admins via RLS) plus the featured pointer
 * from the settings singleton.
 */

export interface AdminOverview {
  pages: AdminPageSummary[];
  featuredUiId: string | null;
}

export async function loadOverview(client: unknown): Promise<AdminOverview> {
  const db = asPublishClient(client);

  const [pagesRes, profilesRes, settingsRes] = await Promise.all([
    db
      .from("published_pages")
      // `artifacts` rides along only to derive its keys (the coverage tag
      // badges) — PostgREST can't project jsonb keys, and this projection is
      // admin-only and loaded once per console visit.
      .select("ui_id, name, slug, version, owner_id, artifacts")
      .order("published_at", { ascending: false }),
    db.from("profiles").select("id, email"),
    db
      .from("site_settings")
      .select("featured_ui_id")
      .eq("id", true)
      .maybeSingle(),
  ]);

  const emailById = new Map<string, string>();
  for (const row of (profilesRes.data as Array<Record<string, unknown>>) ??
    []) {
    if (typeof row.id === "string" && typeof row.email === "string") {
      emailById.set(row.id, row.email);
    }
  }

  const featuredUiId =
    (settingsRes.data as { featured_ui_id?: string } | null)?.featured_ui_id ??
    null;

  const pages: AdminPageSummary[] = (
    (pagesRes.data as Array<Record<string, unknown>>) ?? []
  )
    .filter((row) => typeof row.ui_id === "string")
    .map((row) => ({
      uiId: String(row.ui_id),
      name: String(row.name ?? ""),
      slug: String(row.slug ?? ""),
      version: Number(row.version ?? 1),
      ownerEmail: emailById.get(String(row.owner_id)) ?? null,
      featured: String(row.ui_id) === featuredUiId,
      languages: artifactLanguages(row.artifacts),
    }));

  return { pages, featuredUiId };
}

/** Sorted language tags baked into a page's artifact map (bad shape → none). */
function artifactLanguages(artifacts: unknown): string[] {
  if (
    typeof artifacts !== "object" ||
    artifacts === null ||
    Array.isArray(artifacts)
  ) {
    return [];
  }
  return Object.keys(artifacts).sort();
}

/** Feature/unfeature the root page (site_settings singleton, admin-only RLS). */
export async function setFeatured(
  client: unknown,
  uiId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const db = asPublishClient(client);
  const { error } = await db
    .from("site_settings")
    .upsert({ id: true, featured_ui_id: uiId }, { onConflict: "id" });
  if (error) return { ok: false, error: error.message };
  // The featured lookup is share-cached (055 C) — the pointer just moved.
  revalidateProjection(["site_settings"]);
  return { ok: true };
}
