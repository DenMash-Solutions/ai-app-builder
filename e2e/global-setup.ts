import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { chromium } from "@playwright/test";
import { AUTH, PATHS, ROLE, SHELL } from "./constants";
import {
  acquireRunLock,
  restoreFeaturedIfRecovery,
  seedFixture,
  sweepOwnLeftovers,
} from "./db";
import {
  BASE_URL,
  E2E_STATE_DIR,
  canSeed,
  e2eEnv,
  hasAdminAuth,
  hasUserAuth,
  statePath,
} from "./env";

/**
 * Global setup (plan: e2e-hardening), in order:
 *
 * 1. bundle the MSW generate mock,
 * 2. acquire the run lock — a concurrent run flips E2E_SKIP_MUTATING so the
 *    state-mutating suites refuse to run,
 * 3. DB (all optional, service role): consume a leftover featured-recovery
 *    record (crash recovery) → sweep marker-scoped leftovers → seed the
 *    fixture (fail fast when the key is present but the seed cannot run),
 * 4. storage states for the dedicated identities via the REAL login form —
 *    unset creds skip cleanly, set-but-invalid creds fail fast.
 */

export default async function globalSetup(): Promise<void> {
  const bundle = spawnSync(
    "bun",
    [
      "build",
      "e2e/msw/init.ts",
      "--outfile",
      "e2e/msw/init.generated.js",
      "--format=iife",
      "--target=browser",
      '--define:process.env.NODE_ENV="development"',
    ],
    { stdio: "inherit" },
  );
  if (bundle.status !== 0) {
    throw new Error("Failed to bundle the MSW init script");
  }

  // 2) Run lock — refuse to mutate alongside another run.
  fs.mkdirSync(E2E_STATE_DIR, { recursive: true });
  const lock = acquireRunLock();
  if (!lock.owned) {
    process.env.E2E_SKIP_MUTATING = "1";
    console.warn(
      "[e2e] another run holds the lock — state-mutating suites will skip",
    );
  }

  // 3) DB: crash recovery → leftover sweep → seed.
  if (canSeed) {
    if (await restoreFeaturedIfRecovery()) {
      console.warn(
        "[e2e] consumed a leftover recovery record from a previous crashed run",
      );
    }
    try {
      if (hasAdminAuth) {
        const swept = await sweepOwnLeftovers(e2eEnv.adminEmail);
        if (swept > 0) {
          console.warn(
            `[e2e] swept ${swept} leftover test row(s) from a previous run`,
          );
        }
      }
      await seedFixture();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `[e2e seed] ${message} — fix SUPABASE_SERVICE_ROLE_KEY / fixture setup, ` +
          "or unset the key to skip seeding",
      );
    }
  } else {
    console.warn(
      "[e2e] SUPABASE_SERVICE_ROLE_KEY absent — skipping the DB seed " +
        "(suite runs against the database as-is)",
    );
  }

  // 4) Storage states through the real login form.
  if (hasAdminAuth) {
    await saveStorageState("admin", e2eEnv.adminEmail, e2eEnv.adminPassword);
  } else {
    console.warn(
      "[e2e] E2E_ADMIN_* absent — authenticated suites will skip (see .env.example)",
    );
  }
  if (hasUserAuth) {
    await saveStorageState("user", e2eEnv.userEmail, e2eEnv.userPassword);
  }
}

/** Logs in through the spec-rendered form and stores the session. */
async function saveStorageState(
  name: string,
  email: string,
  password: string,
): Promise<void> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: BASE_URL });
    const page = await context.newPage();
    await page.goto(PATHS.login);
    await page.getByLabel(AUTH.email).fill(email);
    await page.getByLabel(AUTH.password).fill(password);
    await page.getByRole(ROLE.button, { name: AUTH.loginSubmit }).click();
    try {
      await page
        .locator(
          `[aria-label="${SHELL.accountMenu.replace("{email}", email)}"]`,
        )
        .waitFor({ timeout: 15_000 });
    } catch {
      throw new Error(
        `[e2e auth] sign-in failed for ${email} — credentials are set but ` +
          "rejected (wrong password or missing account)",
      );
    }
    await context.storageState({ path: statePath(`${name}.json`) });
    await context.close();
  } finally {
    await browser.close();
  }
}
