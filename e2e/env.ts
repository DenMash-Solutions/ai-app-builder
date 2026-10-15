import fs from "node:fs";
import path from "node:path";

/**
 * Centralized environment loading for the Playwright suite. Next.js reads
 * `.env.local` itself, but Playwright does not — so this parses it once at
 * import WITHOUT overriding variables already present in the process
 * (explicit env always wins). Everything else reads through here, so a
 * missing file or missing key is a defined "absent" state, never a crash.
 */

const ENV_LOCAL = path.resolve(process.cwd(), ".env.local");

function loadEnvLocal(): void {
  if (!fs.existsSync(ENV_LOCAL)) return;
  const raw = fs.readFileSync(ENV_LOCAL, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvLocal();

/** Dev-server origin — shared by config, global setup, and tests. */
export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * Gitignored e2e state dir: storage states, the run lock, and the featured
 * recovery record. Deliberately NOT `test-results/` — Playwright cleans its
 * output directory between runs, and these files must survive crashes.
 */
export const E2E_STATE_DIR = path.resolve(process.cwd(), "e2e/.state");

export function statePath(name: string): string {
  return path.join(E2E_STATE_DIR, name);
}

export interface E2EEnv {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  adminEmail: string;
  adminPassword: string;
  userEmail: string;
  userPassword: string;
  /** Owner of the seeded fixture rows — a data identity, never a login. */
  fixtureEmail: string;
}

export const e2eEnv: E2EEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  adminEmail: process.env.E2E_ADMIN_EMAIL ?? "",
  adminPassword: process.env.E2E_ADMIN_PASSWORD ?? "",
  userEmail: process.env.E2E_USER_EMAIL ?? "",
  userPassword: process.env.E2E_USER_PASSWORD ?? "",
  fixtureEmail: process.env.E2E_FIXTURE_EMAIL ?? "anon@e2e.com",
};

/** Service-role key present → seeding / featured restore are possible. */
export const canSeed = Boolean(e2eEnv.supabaseUrl && e2eEnv.serviceRoleKey);

/** Dedicated admin credentials present → the authed suite can log in. */
export const hasAdminAuth = Boolean(e2eEnv.adminEmail && e2eEnv.adminPassword);

/** Dedicated non-admin credentials present → the denial test can log in. */
export const hasUserAuth = Boolean(e2eEnv.userEmail && e2eEnv.userPassword);
