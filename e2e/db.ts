import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Spec } from "@json-render/core";
import {
  CATALOG_VISIBILITIES,
  type CatalogAssetType,
  type CatalogVisibility,
} from "@/lib/catalog/catalog";
import landingFixture from "./fixtures/landing-fixture.json";
import themeFixture from "./fixtures/theme-fixture.json";
import { BASE_URL, E2E_STATE_DIR, canSeed, e2eEnv, statePath } from "./env";

/**
 * Server-side e2e infrastructure (Node only — global setup/teardown and test
 * workers; the service-role key never reaches the browser bundle):
 *
 * - the optional service-role client,
 * - the fixture seed with its state matrix (plan: e2e-hardening),
 * - featured-pointer capture / crash-safe restore via a persisted recovery
 *   record (the singleton is the highest-risk mutation in the suite),
 * - the preflight run lock (refuse to mutate alongside another run),
 * - the identity+marker-scoped leftover sweep.
 */

/**
 * Fixed identity for OUR fixture row — stable across runs so the seed
 * recognizes (and never duplicates) its own records. Hex-only, valid uuid.
 */
export const FIXTURE_UI_ID = "e2e00000-0000-4000-8000-000000000001";
export const FIXTURE_SLUG = "e2e-landing";
export const FIXTURE_NAME = "E2E fixture landing";

/** Companion published page for the spec-driven theme journey (public route). */
export const THEME_UI_ID = "e2e00000-0000-4000-8000-000000000002";
export const THEME_SLUG = "e2e-theme";
export const THEME_NAME = "E2E fixture theme";

/**
 * Every record the authed suite creates carries this prompt prefix — the
 * marker the leftover sweep matches (dedicated owner AND prefix, never a
 * bare owner: the marker is what makes a sweep safe to repeat).
 */
export const TEST_PROMPT_PREFIX = "E2E ";

export function serviceClient(): SupabaseClient {
  if (!canSeed) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_URL) is not set",
    );
  }
  return createClient(e2eEnv.supabaseUrl, e2eEnv.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Resolves an auth user by email via the Auth Admin API (never assumes a UUID). */
export async function resolveUserByEmail(
  email: string,
): Promise<{ id: string } | null> {
  const svc = serviceClient();
  const target = email.trim().toLowerCase();
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await svc.auth.admin.listUsers({
      page,
      perPage: 100,
    });
    if (error) {
      throw new Error(
        `[e2e] auth lookup failed for ${email}: ${error.message}`,
      );
    }
    const users = data?.users ?? [];
    const hit = users.find(
      (user) => (user.email ?? "").toLowerCase() === target,
    );
    if (hit) return { id: hit.id };
    if (users.length < 100) break;
  }
  return null;
}

interface FeaturedState {
  rowExists: boolean;
  featured: string | null;
}

async function readFeatured(svc: SupabaseClient): Promise<FeaturedState> {
  const { data, error } = await svc
    .from("site_settings")
    .select("featured_ui_id")
    .eq("id", true)
    .maybeSingle();
  if (error) {
    throw new Error(`[e2e] cannot read site_settings: ${error.message}`);
  }
  return data
    ? { rowExists: true, featured: data.featured_ui_id ?? null }
    : { rowExists: false, featured: null };
}

async function writeFeatured(
  svc: SupabaseClient,
  featured: string | null,
): Promise<void> {
  const { error } = await svc.from("site_settings").upsert(
    {
      id: true,
      featured_ui_id: featured,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) {
    throw new Error(`[e2e] cannot set featured_ui_id: ${error.message}`);
  }
  // The app share-caches this GET under the `site_settings` tag (plan 055 C)
  // and only self-heals a missed invalidation after 60s — a harness write
  // straight to REST would leave the previous run's pointer (e.g. the
  // unfeature test's null) serving stale `/en` content into the NEXT run.
  // Poke the same invalidation hop every app mutation uses.
  await invalidateProjectionTag("site_settings");
}

/** Best-effort `POST /api/revalidate` — the documented external-writer hop. */
async function invalidateProjectionTag(tag: string): Promise<void> {
  try {
    const res = await fetch(`${BASE_URL}/api/revalidate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: [tag] }),
    });
    if (!res.ok) {
      console.warn(
        `[e2e] projection revalidate poke for "${tag}" returned ${res.status}`,
      );
    }
  } catch (err) {
    console.warn(
      `[e2e] projection revalidate poke for "${tag}" failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/**
 * Idempotent fixture seed with the plan's state matrix — it recognizes its
 * own records, preserves unrelated settings, and NEVER takes a legitimate
 * featured page away from its owner:
 *
 * | site_settings state            | action                              |
 * | ------------------------------ | ----------------------------------- |
 * | no row / pointer null          | ensure fixture → point at fixture   |
 * | points at the fixture          | nothing                             |
 * | points at an unrelated page    | leave untouched                     |
 * | dangling (FK-unreachable)      | warn loudly, no write               |
 */
export async function seedFixture(): Promise<void> {
  const svc = serviceClient();

  // 1) Owner: the dedicated fixture identity — never a login account.
  const owner = await resolveUserByEmail(e2eEnv.fixtureEmail);
  if (!owner) {
    throw new Error(
      `[e2e seed] fixture owner "${e2eEnv.fixtureEmail}" not found in auth.users — ` +
        "create the account or point E2E_FIXTURE_EMAIL at an existing one",
    );
  }

  // 2) Fixture rows — upsert keyed by the fixed id: recognizes its own records.
  const { error: uiError } = await svc.from("uis").upsert(
    {
      id: FIXTURE_UI_ID,
      owner_id: owner.id,
      name: FIXTURE_NAME,
      slug: FIXTURE_SLUG,
      prompt: "e2e seed: featured landing fixture",
      revisions: [
        { label: "seed", createdAt: Date.now(), spec: landingFixture },
      ],
      head: 0,
    },
    { onConflict: "id" },
  );
  if (uiError) {
    throw new Error(`[e2e seed] uis upsert failed: ${uiError.message}`);
  }

  const { error: pageError } = await svc.from("published_pages").upsert(
    {
      ui_id: FIXTURE_UI_ID,
      owner_id: owner.id,
      slug: FIXTURE_SLUG,
      name: FIXTURE_NAME,
      version: 1,
      spec: landingFixture,
    },
    { onConflict: "ui_id" },
  );
  if (pageError) {
    throw new Error(
      `[e2e seed] published_pages upsert failed: ${pageError.message}`,
    );
  }

  // 2b) Spec-driven theme page — the PUBLIC theme journey's stage: a dark
  // default with a ThemeSwitcher, served at /{locale}/e2e-theme to
  // anonymous visitors (never featured, never pointed at).
  const { error: themeUiError } = await svc.from("uis").upsert(
    {
      id: THEME_UI_ID,
      owner_id: owner.id,
      name: THEME_NAME,
      slug: THEME_SLUG,
      prompt: "e2e seed: spec theme fixture",
      revisions: [{ label: "seed", createdAt: Date.now(), spec: themeFixture }],
      head: 0,
    },
    { onConflict: "id" },
  );
  if (themeUiError) {
    throw new Error(
      `[e2e seed] theme uis upsert failed: ${themeUiError.message}`,
    );
  }

  const { error: themePageError } = await svc.from("published_pages").upsert(
    {
      ui_id: THEME_UI_ID,
      owner_id: owner.id,
      slug: THEME_SLUG,
      name: THEME_NAME,
      version: 1,
      spec: themeFixture,
    },
    { onConflict: "ui_id" },
  );
  if (themePageError) {
    throw new Error(
      `[e2e seed] theme published_pages upsert failed: ${themePageError.message}`,
    );
  }

  // 3) Featured pointer — fill only when ABSENT.
  const { rowExists, featured } = await readFeatured(svc);
  if (!rowExists || featured === null) {
    await writeFeatured(svc, FIXTURE_UI_ID);
    console.log(
      `[e2e seed] featured pointer was ${rowExists ? "null" : "unset"} → fixture (${FIXTURE_SLUG})`,
    );
    return;
  }

  // Pointer set → validate the record it actually references.
  const { data: page, error: pageLookup } = await svc
    .from("published_pages")
    .select("ui_id, slug")
    .eq("ui_id", featured)
    .maybeSingle();
  if (pageLookup) {
    throw new Error(
      `[e2e seed] cannot validate featured page: ${pageLookup.message}`,
    );
  }
  if (!page) {
    console.warn(
      `[e2e seed] WARN featured_ui_id=${featured} is dangling — leaving it untouched ` +
        "(FK on delete set null should make this unreachable; investigate manually)",
    );
  } else if (page.ui_id === FIXTURE_UI_ID) {
    console.log("[e2e seed] featured pointer → fixture (already seeded)");
  } else {
    console.log(
      `[e2e seed] featured pointer → "${page.slug}" (unrelated, legitimate page) — left untouched`,
    );
  }
}

/**
 * Removes crash leftovers owned by the dedicated e2e admin that carry the
 * test marker prefix — `uis` rows by prompt and `projects` rows by name
 * (064). Scoped by identity AND marker — the personal account and unmarked
 * records are never touched.
 */
export async function sweepTestRows(ownerId: string): Promise<number> {
  const svc = serviceClient();
  const { data, error } = await svc
    .from("uis")
    .select("id")
    .eq("owner_id", ownerId)
    .like("prompt", `${TEST_PROMPT_PREFIX}%`);
  if (error) {
    throw new Error(`[e2e] leftover sweep failed: ${error.message}`);
  }
  const ids = (data ?? []).map((row) => String(row.id));
  if (ids.length > 0) {
    const { error: deleteError } = await svc.from("uis").delete().in("id", ids);
    if (deleteError) {
      throw new Error(
        `[e2e] leftover sweep delete failed: ${deleteError.message}`,
      );
    }
  }

  const projectResult = await svc
    .from("projects")
    .select("id")
    .eq("owner_id", ownerId)
    .like("name", `${TEST_PROMPT_PREFIX}%`);
  if (projectResult.error) {
    throw new Error(
      `[e2e] project leftover sweep failed: ${projectResult.error.message}`,
    );
  }
  const projectIds = (projectResult.data ?? []).map((row) => String(row.id));
  if (projectIds.length > 0) {
    const { error: projectDeleteError } = await svc
      .from("projects")
      .delete()
      .in("id", projectIds);
    if (projectDeleteError) {
      throw new Error(
        `[e2e] project leftover sweep delete failed: ${projectDeleteError.message}`,
      );
    }
  }

  // Catalog assets (plan 066 Task 5): name-scoped like every other marker —
  // deleting the asset cascades its versions AND installs, so one pass is a
  // complete catalog cleanup.
  const catalogResult = await svc
    .from("catalog_assets")
    .select("id")
    .eq("owner_id", ownerId)
    .like("name", `${TEST_PROMPT_PREFIX}%`);
  if (catalogResult.error) {
    throw new Error(
      `[e2e] catalog leftover sweep failed: ${catalogResult.error.message}`,
    );
  }
  const catalogIds = (catalogResult.data ?? []).map((row) => String(row.id));
  if (catalogIds.length > 0) {
    const { error: catalogDeleteError } = await svc
      .from("catalog_assets")
      .delete()
      .in("id", catalogIds);
    if (catalogDeleteError) {
      throw new Error(
        `[e2e] catalog leftover sweep delete failed: ${catalogDeleteError.message}`,
      );
    }
  }
  return ids.length + projectIds.length + catalogIds.length;
}

/**
 * Service-role safety net for a record this test itself created (the id is
 * a uuid minted by that test's own generate — targeted, never a range or a
 * bare owner match). UI-driven cleanup runs first; this covers crash paths.
 */
export async function deleteTestRow(uiId: string | undefined): Promise<void> {
  if (!uiId || !canSeed) return;
  const svc = serviceClient();
  const { error } = await svc.from("uis").delete().eq("id", uiId);
  if (error) {
    console.warn(`[e2e] cleanup of ${uiId} failed: ${error.message}`);
  }
}

/**
 * Service-role safety net for the PROJECT row this test itself created (by
 * id — targeted, never a range or a bare owner match). The name-scoped
 * leftover sweep also covers it on the next run; this keeps a run's account
 * tidy even when it is the last one. Silent without the service-role key.
 */
export async function deleteTestProject(
  projectId: string | undefined,
): Promise<void> {
  if (!projectId || !canSeed) return;
  const svc = serviceClient();
  const { error } = await svc.from("projects").delete().eq("id", projectId);
  if (error) {
    console.warn(
      `[e2e] project cleanup of ${projectId} failed: ${error.message}`,
    );
  }
}

/**
 * Service-role seed of a PROJECT row owned by a given user — RLS fixtures
 * need a project the CALLER owns without driving the UI (plan 066 Task 5,
 * the catalog_installs WITH CHECK needs `p.owner_id = auth.uid()`). The name
 * carries the `E2E ` marker so the leftover sweep also covers it. Slug is
 * per-test unique (projects_slug_check is 1..64 chars, unique per owner).
 */
export async function seedOwnedProject(request: {
  ownerId: string;
  name: string;
}): Promise<{ projectId: string }> {
  if (!canSeed) {
    throw new Error("[e2e] seedOwnedProject needs SUPABASE_SERVICE_ROLE_KEY");
  }
  const svc = serviceClient();
  const projectId = randomUUID();
  const { error } = await svc.from("projects").insert({
    id: projectId,
    owner_id: request.ownerId,
    name: request.name,
    slug: `e2e-rls-${projectId.slice(0, 8)}`,
  });
  if (error) {
    throw new Error(`[e2e] project seed failed: ${error.message}`);
  }
  return { projectId };
}

/**
 * Polls until the PROJECT row exists in the account — the authoritative
 * "projects sync push landed" gate for the cross-device test (plan 064),
 * same reasoning as `waitForRemoteRow`: the UI dot can't gate this reliably
 * (debounce plus admin-sized pulls stretch the cycle). Best-effort silent
 * without the service-role key, like the other helpers.
 */
export async function waitForRemoteProject(
  name: string,
  timeoutMs = 20_000,
): Promise<void> {
  if (!canSeed) return;
  const svc = serviceClient();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { data, error } = await svc
      .from("projects")
      .select("id")
      .eq("name", name)
      .limit(1);
    if (!error && data && data.length > 0) return;
    if (Date.now() > deadline) {
      throw new Error(
        `[e2e] account project row for "${name.slice(0, 40)}…" missing ` +
          `after ${timeoutMs}ms${error ? ` (${error.message})` : ""}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/**
 * Polls until the entry's `uis` row exists in the account — the AUTHORITATIVE
 * "sync push landed" gate for tests that write `page_versions` next: publish's
 * WITH CHECK requires the owned row (audit F2), and a race against it surfaces
 * as a bare 42501 ("Could not publish"). The UI dot can't gate this reliably:
 * its debounce plus admin-sized `uis?select=*` pulls (an admin sees EVERY row,
 * growing per run) push the full cycle past 5s (sync-trip timeout).
 * Best-effort silent without the service-role key, like the other helpers.
 */
export async function waitForRemoteRow(
  prompt: string,
  timeoutMs = 20_000,
): Promise<void> {
  if (!canSeed) return;
  const svc = serviceClient();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { data, error } = await svc
      .from("uis")
      .select("id")
      .eq("prompt", prompt)
      .limit(1);
    if (!error && data && data.length > 0) return;
    if (Date.now() > deadline) {
      throw new Error(
        `[e2e] account row for prompt "${prompt.slice(0, 40)}…" missing ` +
          `after ${timeoutMs}ms${error ? ` (${error.message})` : ""}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/**
 * Polls until the membership row (`project_screens`) exists in the account —
 * the "membership push landed" gate for the cross-device catalog test (plan
 * 066 task 5): device B can only adopt (and pointer-align) a row that was
 * pushed. Same reasoning as `waitForRemoteProject`: the UI dot can't gate
 * this (debounce plus admin-sized pulls stretch the cycle). Best-effort
 * silent without the service-role key, like the other helpers.
 */
export async function waitForRemoteMembership(
  screenId: string,
  timeoutMs = 30_000,
): Promise<void> {
  if (!canSeed) return;
  const svc = serviceClient();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { data, error } = await svc
      .from("project_screens")
      .select("id")
      .eq("screen_id", screenId)
      .limit(1);
    if (!error && data && data.length > 0) return;
    if (Date.now() > deadline) {
      throw new Error(
        `[e2e] account membership row for screen ${screenId} missing ` +
          `after ${timeoutMs}ms${error ? ` (${error.message})` : ""}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** Ids of a catalog asset seeded by `seedCatalogAsset` (asset + pinned v1). */
export interface SeededCatalogAsset {
  assetId: string;
  versionId: string;
}

/**
 * Seeds a catalog asset with its FIRST immutable version through the service
 * role (plan 066 Task 5). No production UI creates assets (the only caller is
 * the component-typed template seed), so the suite owns the rows it installs.
 * The name carries the `E2E ` marker the leftover sweep matches — deleting the
 * asset cascades its versions and installs. Throws without the service key:
 * every catalog e2e test needs it.
 */
export async function seedCatalogAsset(request: {
  ownerId: string;
  name: string;
  type: CatalogAssetType;
  visibility?: CatalogVisibility;
  spec: Spec;
}): Promise<SeededCatalogAsset> {
  if (!canSeed) {
    throw new Error("[e2e] seedCatalogAsset needs SUPABASE_SERVICE_ROLE_KEY");
  }
  const svc = serviceClient();
  const assetId = randomUUID();
  const versionId = randomUUID();
  const { error: assetError } = await svc.from("catalog_assets").insert({
    id: assetId,
    owner_id: request.ownerId,
    name: request.name,
    description: null,
    type: request.type,
    visibility: request.visibility ?? CATALOG_VISIBILITIES.private,
    latest_version_id: versionId,
  });
  if (assetError) {
    throw new Error(`[e2e] catalog asset seed failed: ${assetError.message}`);
  }
  const { error: versionError } = await svc
    .from("catalog_asset_versions")
    .insert({
      id: versionId,
      asset_id: assetId,
      owner_id: request.ownerId,
      version: 1,
      spec: request.spec,
      changelog: null,
    });
  if (versionError) {
    throw new Error(
      `[e2e] catalog version seed failed: ${versionError.message}`,
    );
  }
  return { assetId, versionId };
}

/**
 * Appends the next immutable version of a seeded asset and re-points
 * `latest_version_id` — the "author published v2" half of the pinning test,
 * done at the DB layer because no UI flow creates the FIRST asset row.
 * Returns the new version id.
 */
export async function publishSeededCatalogVersion(
  assetId: string,
  spec: Spec,
  changelog: string | null = null,
): Promise<string> {
  if (!canSeed) {
    throw new Error("[e2e] publishSeededCatalogVersion needs the service key");
  }
  const svc = serviceClient();
  const { data: assetRow, error: assetReadError } = await svc
    .from("catalog_assets")
    .select("owner_id")
    .eq("id", assetId)
    .single();
  if (assetReadError || !assetRow) {
    throw new Error(
      `[e2e] catalog asset ${assetId} unreadable: ${
        assetReadError?.message ?? "missing"
      }`,
    );
  }
  const { data: versions, error: readError } = await svc
    .from("catalog_asset_versions")
    .select("version")
    .eq("asset_id", assetId)
    .order("version", { ascending: false })
    .limit(1);
  if (readError) {
    throw new Error(`[e2e] version read failed: ${readError.message}`);
  }
  const next = (versions?.[0]?.version ?? 0) + 1;
  const versionId = randomUUID();
  const { error: insertError } = await svc
    .from("catalog_asset_versions")
    .insert({
      id: versionId,
      asset_id: assetId,
      owner_id: String(assetRow.owner_id),
      version: next,
      spec,
      changelog,
    });
  if (insertError) {
    throw new Error(`[e2e] version publish failed: ${insertError.message}`);
  }
  const { error: bumpError } = await svc
    .from("catalog_assets")
    .update({
      latest_version_id: versionId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", assetId);
  if (bumpError) {
    throw new Error(`[e2e] latest_version bump failed: ${bumpError.message}`);
  }
  return versionId;
}

/**
 * Polls until a project holds an install of the asset — the DB-level gate for
 * "the install landed" (the picker closes and navigation fire immediately,
 * but the account row is what a second device reads). Returns the install id
 * so a test can assert its pinned version later.
 */
export async function waitForRemoteCatalogInstall(
  assetId: string,
  projectId: string,
  // Must exceed the sync loop's FULL bounded-retry window, not just its
  // first attempts: a fresh install can be pushed before its `uis` parent
  // row lands (FK 409), and `scheduleRetry` backs off 1.6s → 3.2s → 6.4s →
  // 10s → 10s (MAX_PUSH_FAILURES = 5, capped at 10s) ≈ 31s before giving
  // up. Under a full parallel suite the parent upload is slow enough that a
  // 20s gate failed a test that converges fine standalone.
  timeoutMs = 45_000,
): Promise<{ installId: string; versionId: string; targetUiId: string }> {
  if (!canSeed) return { installId: "", versionId: "", targetUiId: "" };
  const svc = serviceClient();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { data, error } = await svc
      .from("catalog_installs")
      .select("id, version_id, target_ui_id")
      .eq("asset_id", assetId)
      .eq("project_id", projectId)
      .limit(1);
    if (!error && data && data.length > 0) {
      return {
        installId: String(data[0].id),
        versionId: String(data[0].version_id),
        targetUiId: data[0].target_ui_id ? String(data[0].target_ui_id) : "",
      };
    }
    if (Date.now() > deadline) {
      // Dump what DID land for this asset — "wrong project" and "not pushed
      // at all" are different bugs and the bare timeout can't tell them apart.
      const { data: all } = await svc
        .from("catalog_installs")
        .select("id, project_id, version_id, target_ui_id")
        .eq("asset_id", assetId);
      throw new Error(
        `[e2e] catalog install for ${assetId} / ${projectId} missing ` +
          `after ${timeoutMs}ms${error ? ` (${error.message})` : ""} — ` +
          `asset installs: ${JSON.stringify(all ?? [])}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/**
 * Service-role safety net for ONE seeded catalog asset (by id). UI-driven
 * cleanup runs first; this covers crash paths. Silent without the service key.
 */
export async function deleteSeededCatalogAsset(
  assetId: string | undefined,
): Promise<void> {
  if (!assetId || !canSeed) return;
  const svc = serviceClient();
  const { error } = await svc.from("catalog_assets").delete().eq("id", assetId);
  if (error) {
    console.warn(
      `[e2e] catalog cleanup of ${assetId} failed: ${error.message}`,
    );
  }
}

/**
 * Service-role cleanup for data-source records (docs/plan/046-database-provider):
 * scoped by the namespaces THIS test minted (design uuid, published slug).
 * Never a bare table sweep and never the shared "local" namespace — a real
 * visitor's rows must be unreachable from here. Idempotent, silent without
 * the service-role key.
 */
export async function deleteGenuiRecords(
  appIds: (string | undefined)[],
): Promise<void> {
  const ids = appIds.filter((id): id is string => Boolean(id));
  if (!canSeed || ids.length === 0) return;
  const svc = serviceClient();
  const { error } = await svc.from("genui_records").delete().in("app_id", ids);
  if (error) {
    console.warn(`[e2e] genui_records cleanup failed: ${error.message}`);
  }
}

const RECOVERY_FILE = statePath("featured-recovery.json");

/**
 * Records the current featured pointer BEFORE the admin test mutates it.
 * The file lives in `e2e/.state/` (survives output-dir cleanup and process
 * crashes) so setup/teardown can recover it on the next run.
 */
export async function captureFeatured(): Promise<void> {
  if (!canSeed) {
    throw new Error("captureFeatured requires SUPABASE_SERVICE_ROLE_KEY");
  }
  const svc = serviceClient();
  const { featured } = await readFeatured(svc);
  fs.mkdirSync(E2E_STATE_DIR, { recursive: true });
  fs.writeFileSync(
    RECOVERY_FILE,
    JSON.stringify({ original: featured, capturedAt: Date.now() }, null, 2),
  );
}

/**
 * Consumes the recovery record if present: restores the captured pointer
 * (only when the current value actually differs) and removes the file.
 * Called from the test's `finally`, from global teardown (second line), and
 * from the next run's setup (crash recovery). Returns true when it restored.
 */
export async function restoreFeaturedIfRecovery(): Promise<boolean> {
  if (!fs.existsSync(RECOVERY_FILE)) return false;

  let original: string | null = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(RECOVERY_FILE, "utf8")) as {
      original?: string | null;
    };
    original = parsed.original ?? null;
  } catch {
    console.warn("[e2e] unreadable featured recovery record — discarding it");
    fs.rmSync(RECOVERY_FILE, { force: true });
    return false;
  }

  if (!canSeed) {
    console.warn(
      "[e2e] featured recovery record present but SUPABASE_SERVICE_ROLE_KEY is unset — cannot restore",
    );
    return false;
  }

  const svc = serviceClient();
  const { rowExists, featured } = await readFeatured(svc);
  if (rowExists && featured === original) {
    fs.rmSync(RECOVERY_FILE, { force: true });
    return false;
  }

  // Restore FIRST, consume the record only on success — a failed write must
  // leave the file for the next run to retry.
  await writeFeatured(svc, original);
  fs.rmSync(RECOVERY_FILE, { force: true });
  console.log(
    `[e2e] restored featured pointer from recovery record (${featured ?? "unset"} → ${original ?? "null"})`,
  );
  return true;
}

/**
 * Setup/teardown convenience: resolve the dedicated admin identity and
 * sweep its marker-scoped leftovers. Returns the number of rows removed.
 */
export async function sweepOwnLeftovers(adminEmail: string): Promise<number> {
  const admin = await resolveUserByEmail(adminEmail);
  if (!admin) {
    console.warn(
      `[e2e] admin identity ${adminEmail} not found — skipping the leftover sweep`,
    );
    return 0;
  }
  return sweepTestRows(admin.id);
}

/**
 * Preflight run lock: an atomic `wx` create in `e2e/.state/`, so two runs
 * starting at the same time cannot both believe they own the mutation
 * window. Stale locks (dead pid or older than LOCK_MAX_AGE_MS) are replaced.
 */
const LOCK_FILE = statePath("lock.json");
const LOCK_MAX_AGE_MS = 2 * 60 * 60 * 1000;

interface LockInfo {
  pid: number;
  startedAt: number;
}

function readLock(): LockInfo | null {
  try {
    const info = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8")) as LockInfo;
    return typeof info.pid === "number" ? info : null;
  } catch {
    return null;
  }
}

function lockIsLive(info: LockInfo): boolean {
  if (Date.now() - (info.startedAt ?? 0) > LOCK_MAX_AGE_MS) return false;
  try {
    process.kill(info.pid, 0);
    return true;
  } catch (error) {
    // EPERM = alive but owned by another user; ESRCH = gone.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function acquireRunLock(): { owned: boolean } {
  fs.mkdirSync(E2E_STATE_DIR, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(LOCK_FILE, "wx");
      fs.writeSync(
        fd,
        JSON.stringify({ pid: process.pid, startedAt: Date.now() }),
      );
      fs.closeSync(fd);
      return { owned: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const info = readLock();
      if (info && lockIsLive(info)) {
        return { owned: info.pid === process.pid };
      }
      fs.rmSync(LOCK_FILE, { force: true }); // stale — retry the create once
    }
  }
  return { owned: false };
}

/** Releases the lock only if this process owns it. */
export function releaseRunLock(): void {
  const info = readLock();
  if (info && info.pid === process.pid) {
    fs.rmSync(LOCK_FILE, { force: true });
  }
}
