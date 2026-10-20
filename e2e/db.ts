import fs from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import landingFixture from "./fixtures/landing-fixture.json";
import themeFixture from "./fixtures/theme-fixture.json";
import { E2E_STATE_DIR, canSeed, e2eEnv, statePath } from "./env";

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
 * Removes crash leftovers: `uis` rows owned by the dedicated e2e admin that
 * carry the test marker prefix. Scoped by identity AND marker — the personal
 * account and unmarked records are never touched.
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
  if (ids.length === 0) return 0;
  const { error: deleteError } = await svc.from("uis").delete().in("id", ids);
  if (deleteError) {
    throw new Error(
      `[e2e] leftover sweep delete failed: ${deleteError.message}`,
    );
  }
  return ids.length;
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
 * Service-role cleanup for data-source records (docs/plan/database-provider):
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
