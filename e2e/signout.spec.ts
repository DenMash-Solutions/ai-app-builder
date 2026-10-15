import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { PATHS, ROLE, SHELL, SYNC, accountMenuLabel } from "./constants";
import { generateUnique, historyRow, openHistory } from "./authed-helpers";
import { deleteTestRow, TEST_PROMPT_PREFIX } from "./db";
import { e2eEnv, hasAdminAuth } from "./env";

/**
 * Sign-out (plan: e2e-hardening) in its OWN project — it revokes the shared
 * session (`signOut()` defaults to global scope; every authed context is
 * built from the same storageState), so it runs AFTER the authed suite via
 * the project chain: chromium → authed → signout. Running it concurrently
 * would clear the other tests' cookies through the per-request `getUser()`
 * in the Supabase proxy.
 */

const skipMutating = process.env.E2E_SKIP_MUTATING === "1";

test.describe("sign-out", () => {
  test.skip(
    !hasAdminAuth,
    "E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set — sign-out skips (see .env.example)",
  );
  test.skip(
    skipMutating,
    "another e2e run holds the lock — refusing to run state-mutating suites",
  );

  test("ends the session and keeps local history", async ({ page }) => {
    const prompt = `${TEST_PROMPT_PREFIX}sign-out ${randomUUID()}`;
    let entryId: string | undefined;
    try {
      entryId = await generateUnique(page, prompt);
      await expect(page.locator(`[aria-label="${SYNC.saved}"]`)).toBeVisible();

      // Sign out through the account menu.
      const menu = page.locator(
        `[aria-label="${accountMenuLabel(e2eEnv.adminEmail)}"]`,
      );
      await expect(menu).toBeVisible();
      await menu.click();
      await page.getByRole(ROLE.menuitem, { name: SHELL.signOut }).click();

      // The app ends the session AND routes to the public root (plan:
      // e2e-hardening — the featured root is chrome-less, so nothing about
      // the session can be asserted there; the navigation itself is the
      // contract, and waiting for it kills the race with the shell render).
      await expect(page).toHaveURL(/\/en$/);

      // Back in the playground as a visitor: session gone…
      await page.goto(PATHS.ui);
      await expect(
        page.getByRole(ROLE.link, { name: SHELL.signIn }),
      ).toBeVisible();
      await expect(page.locator(`[aria-label="${SYNC.saved}"]`)).toHaveCount(0);
      // …local history intact.
      await openHistory(page);
      await expect(historyRow(page, prompt)).toBeVisible();

      // Still signed out after a reload, history still there.
      await page.reload();
      await expect(
        page.getByRole(ROLE.link, { name: SHELL.signIn }),
      ).toBeVisible();
      await expect(page.locator(`[aria-label="${SYNC.saved}"]`)).toHaveCount(0);
      await openHistory(page);
      await expect(historyRow(page, prompt)).toBeVisible();
    } finally {
      // The session is already gone; remove the record server-side so the
      // next run's sweep doesn't have to (identity + marker scoped anyway).
      await deleteTestRow(entryId);
    }
  });
});
