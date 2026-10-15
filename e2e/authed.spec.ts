import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  ACTIONS,
  ADMIN,
  PATHS,
  PUBLISH,
  ROLE,
  SLOTS,
  SYNC,
  UI,
  entryRowName,
} from "./constants";
import { historyRow, generateUnique, openHistory } from "./authed-helpers";
import {
  captureFeatured,
  deleteTestRow,
  restoreFeaturedIfRecovery,
  TEST_PROMPT_PREFIX,
} from "./db";
import { BASE_URL, canSeed, hasAdminAuth, hasUserAuth, statePath } from "./env";

/**
 * Authenticated suites (plan: e2e-hardening), dedicated e2e identities only
 * (never a personal session). Cleanup touches only this test's records: UI
 * first, service-role safety net in `finally` (plus setup's leftover sweep
 * on the next run). The featured singleton is captured before mutation and
 * restored from the persisted recovery record even when assertions fail.
 *
 * Sign-out deliberately lives in `signout.spec.ts`: it revokes the shared
 * session, so it runs in its own project AFTER these tests (config chain:
 * chromium → authed → signout).
 *
 * Skips: no creds → whole file; concurrent run → everything here; no
 * service key → the feature/unfeature test only.
 */

/** Mutating suites refuse to run when another run holds the lock. */
const skipMutating = process.env.E2E_SKIP_MUTATING === "1";

/** Publishes the currently open entry at `slug` via the go-live dialog. */
async function publishOpenEntry(
  page: Page,
  prompt: string,
  slug: string,
): Promise<void> {
  await openHistory(page);
  await historyRow(page, prompt)
    .getByRole(ROLE.button, { name: PUBLISH.goLive(prompt) })
    .click();
  await page.locator("#publish-slug").fill(slug);
  await expect(
    page.locator(SLOTS.dialog).getByText(PUBLISH.available, { exact: true }),
  ).toBeVisible();
  await page
    .locator(SLOTS.dialog)
    .getByRole(ROLE.button, { name: PUBLISH.submit, exact: true })
    .click();
  await expect(
    page.getByText(PUBLISH.published(`${BASE_URL}/en/${slug}`)),
  ).toBeVisible();
}

test.describe("authenticated — admin identity", () => {
  test.skip(
    !hasAdminAuth,
    "E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set — authenticated suites skip (see .env.example)",
  );
  test.skip(
    skipMutating,
    "another e2e run holds the lock — refusing to run state-mutating suites",
  );

  test("roundtrips a generated UI through the account", async ({
    page,
    browser,
  }) => {
    const prompt = `${TEST_PROMPT_PREFIX}sync roundtrip ${randomUUID()}`;
    let entryId: string | undefined;
    try {
      entryId = await generateUnique(page, prompt);

      // Push: the status dot settles on "Saved to account".
      await expect(page.locator(`[aria-label="${SYNC.saved}"]`)).toBeVisible();

      // Pull: a FRESH context (empty localStorage) must receive the entry
      // from the account — a true server roundtrip, not a local echo.
      const fresh = await browser.newContext({
        baseURL: BASE_URL,
        storageState: statePath("admin.json"),
      });
      try {
        const freshPage = await fresh.newPage();
        await freshPage.goto(PATHS.ui);
        await openHistory(freshPage);
        await expect(historyRow(freshPage, prompt)).toBeVisible();
        await historyRow(freshPage, prompt)
          .getByRole(ROLE.button, { name: entryRowName(prompt) })
          .click();
        await expect(freshPage.getByText(UI.mockHeading)).toBeVisible();
      } finally {
        await fresh.close();
      }

      // Cleanup: delete this test's entry through the UI…
      await openHistory(page);
      await historyRow(page, prompt)
        .getByRole(ROLE.button, { name: ACTIONS.deleteEntry })
        .click();
      await expect(historyRow(page, prompt)).toHaveCount(0);
    } finally {
      // …service-role safety net for crash paths.
      await deleteTestRow(entryId);
    }
  });

  test("publishes an entry and serves its live URL", async ({ page }) => {
    const prompt = `${TEST_PROMPT_PREFIX}publish journey ${randomUUID()}`;
    const slug = `e2e-${randomUUID()}`;
    let entryId: string | undefined;
    try {
      entryId = await generateUnique(page, prompt);
      await publishOpenEntry(page, prompt, slug);

      // The row now shows the Live badge…
      await expect(
        historyRow(page, prompt).getByRole(ROLE.link, {
          name: PUBLISH.openLive(prompt),
        }),
      ).toBeVisible();

      // …and the public URL renders the published spec with the way back.
      await page.goto(`/en/${slug}`);
      await expect(
        page.getByRole(ROLE.heading, { name: UI.mockHeading }),
      ).toBeVisible();
      await expect(
        page.getByRole(ROLE.link, { name: UI.landingPill }),
      ).toHaveAttribute("href", /\/en\/ui$/);

      // Cleanup: manage → take offline → delete the entry.
      await page.goto(PATHS.ui);
      await openHistory(page);
      await historyRow(page, prompt)
        .getByRole(ROLE.button, { name: PUBLISH.manageLive })
        .click();
      await page
        .locator(SLOTS.dialog)
        .getByRole(ROLE.button, { name: PUBLISH.unpublish })
        .click();
      await expect(page.getByText(PUBLISH.unpublishDone)).toBeVisible();
      await historyRow(page, prompt)
        .getByRole(ROLE.button, { name: ACTIONS.deleteEntry })
        .click();
      await expect(historyRow(page, prompt)).toHaveCount(0);
    } finally {
      await deleteTestRow(entryId);
    }
  });

  test("feature/unfeature from the admin console switches the root page", async ({
    page,
  }) => {
    test.skip(
      !canSeed,
      "requires SUPABASE_SERVICE_ROLE_KEY — the featured pointer is captured and restored around this test",
    );
    const prompt = `${TEST_PROMPT_PREFIX}admin feature ${randomUUID()}`;
    const slug = `e2e-${randomUUID()}`;
    let entryId: string | undefined;

    // Capture BEFORE the first mutation — the recovery record must exist
    // from the moment the singleton is at risk (crash-safe).
    await captureFeatured();
    try {
      entryId = await generateUnique(page, prompt);
      await publishOpenEntry(page, prompt, slug);

      // Feature via the admin console, scoped to OUR card by its slug.
      await page.goto(PATHS.admin);
      const card = page
        .locator('[data-slot="card"]')
        .filter({ hasText: `/${slug}` });
      await expect(card).toBeVisible();
      await card.getByRole(ROLE.button, { name: ADMIN.feature }).click();
      await expect(card.getByText(ADMIN.featuredBadge)).toBeVisible();
      await expect(
        card.getByRole(ROLE.button, { name: ADMIN.unfeature }),
      ).toBeVisible();
      await expect(
        card.getByRole(ROLE.button, { name: ADMIN.feature }),
      ).toBeHidden();

      // The root now renders OUR page.
      await page.goto(PATHS.root);
      await expect(page).toHaveURL(/\/en$/);
      await expect(
        page.getByRole(ROLE.heading, { name: UI.mockHeading }),
      ).toBeVisible();

      // Unfeature → the playground is back on /.
      await page.goto(PATHS.admin);
      await card.getByRole(ROLE.button, { name: ADMIN.unfeature }).click();
      await expect(card.getByText(ADMIN.featuredBadge)).toBeHidden();
      await page.goto(PATHS.root);
      await expect(page).toHaveURL(/\/en$/);
      await expect(page.getByPlaceholder(UI.promptPlaceholder)).toBeVisible();

      // Cleanup: unpublish → delete (through the UI).
      await page.goto(PATHS.ui);
      await openHistory(page);
      await historyRow(page, prompt)
        .getByRole(ROLE.button, { name: PUBLISH.manageLive })
        .click();
      await page
        .locator(SLOTS.dialog)
        .getByRole(ROLE.button, { name: PUBLISH.unpublish })
        .click();
      await expect(page.getByText(PUBLISH.unpublishDone)).toBeVisible();
      await historyRow(page, prompt)
        .getByRole(ROLE.button, { name: ACTIONS.deleteEntry })
        .click();
      await expect(historyRow(page, prompt)).toHaveCount(0);
    } finally {
      // Restore the captured pointer first (it may still point at our row),
      // then remove whatever this test created.
      await restoreFeaturedIfRecovery();
      await deleteTestRow(entryId);
    }
  });
});

test.describe("authenticated — non-admin identity", () => {
  test.use({ storageState: statePath("user.json") });
  test.skip(
    !hasUserAuth,
    "E2E_USER_EMAIL / E2E_USER_PASSWORD not set — the denial test skips (see .env.example)",
  );

  test("a signed-in non-admin is bounced from /admin", async ({ page }) => {
    await page.goto(PATHS.admin);
    await expect(page).toHaveURL(/\/en$/);
    // No admin surface leaks: no shell navigation on the root, no console.
    await expect(page.getByRole(ROLE.navigation)).toHaveCount(0);
    await expect(page.getByText(ADMIN.title, { exact: true })).toHaveCount(0);
    await expect(page.getByText(ADMIN.feature)).toHaveCount(0);
  });
});
