import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  ACTIONS,
  ADMIN,
  I18N,
  PATHS,
  PUBLISH,
  ROLE,
  SLOTS,
  SYNC,
  UI,
  entryRowName,
} from "./constants";
import {
  dismissUploadNudge,
  generateUnique,
  historyRow,
  openHistory,
} from "./authed-helpers";
import {
  I18N_PTBR_EDIT_LINES,
  I18N_UI_LINES,
  PUBLISH_HEADING_CLASS,
  PUBLISH_UI_LINES,
} from "./msw/fixture";
import { mockGenerate, readHistoryStorage, waitForMsw } from "./helpers";
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

  test("publishes an entry and serves its live URL", async ({
    page,
    browser,
    baseURL,
  }) => {
    const prompt = `${TEST_PROMPT_PREFIX}publish journey ${randomUUID()}`;
    const slug = `e2e-${randomUUID()}`;
    let entryId: string | undefined;
    try {
      entryId = await generateUnique(page, prompt, PUBLISH_UI_LINES);
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

      // Plan (spec-languages, task 5.4): the baked `content` artifact serves
      // the page with zero JavaScript — static HTML + the compiled stylesheet
      // in the served markup, so it paints without the client engine.
      const noJs = await browser.newContext({
        baseURL,
        javaScriptEnabled: false,
      });
      const noJsPage = await noJs.newPage();
      try {
        // The bake lands right after publish (best-effort, async) — early
        // navigations may still get the client-render fallback, which needs
        // JS; retry until the static artifact is what's served.
        await expect(async () => {
          await noJsPage.goto(`/en/${slug}`);
          await expect(
            noJsPage.getByRole(ROLE.heading, { name: UI.mockHeading }),
          ).toBeVisible({ timeout: 1000 });
        }).toPass({ timeout: 20000 });

        // The baked heading carries its class tokens, and the compiled CSS
        // for them is inline in the served HTML (the FOUC-free contract).
        const classTokens = PUBLISH_HEADING_CLASS.split(" ");
        await expect(
          noJsPage.getByRole(ROLE.heading, { name: UI.mockHeading }),
        ).toHaveClass(new RegExp(`\\b${classTokens[0]}\\b`));
        const inlineCss = (
          await noJsPage.locator("style").allTextContents()
        ).join("\n");
        for (const token of classTokens) {
          expect(inlineCss).toContain(token);
        }
      } finally {
        await noJs.close();
      }

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

  test("feature/unfeature switches the root, whose switcher serves every language by route", async ({
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
      // The switcher design (MSW): English seed + es layer, with the pt-BR
      // edit stream armed for the picker below.
      await mockGenerate(page, {
        lines: I18N_UI_LINES,
        editLines: I18N_PTBR_EDIT_LINES,
      });
      await page.goto(PATHS.ui);
      await waitForMsw(page);
      await page.getByPlaceholder(UI.promptPlaceholder).fill(prompt);
      await page.getByRole(ROLE.button, { name: ACTIONS.generate }).click();
      await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);
      await expect(
        page.getByText(I18N.seedTitle, { exact: true }),
      ).toBeVisible();
      await dismissUploadNudge(page);
      const stored = (await readHistoryStorage(page)).find(
        (candidate) => candidate.prompt === prompt,
      );
      if (!stored) {
        throw new Error(
          `generated entry not found in local history: ${prompt}`,
        );
      }
      entryId = stored.id;

      // Add pt-BR through the picker: the steer lands the layer and the
      // completion fix-up commits the switcher's new option alongside it.
      await page.getByRole(ROLE.button, { name: I18N.langTitle }).click();
      const popover = page.locator('[data-slot="popover-content"]');
      await popover.getByRole(ROLE.button, { name: I18N.addLang }).click();
      const dialog = page.locator(SLOTS.dialog);
      await dialog.getByLabel(I18N.addDialog.filterLabel).fill("pt-br");
      await dialog.getByRole(ROLE.option, { name: /pt-BR/ }).click();
      await expect(
        page.getByText(I18N.addedLang("Brazilian Portuguese"), {
          exact: true,
        }),
      ).toBeVisible({ timeout: 15_000 });

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

      // The root now renders OUR page in the route's language (seed = en).
      await page.goto(PATHS.root);
      await expect(page).toHaveURL(/\/en$/);
      await expect(
        page.getByRole(ROLE.heading, { name: I18N.seedTitle, exact: true }),
      ).toBeVisible();

      // The design's switcher navigates by route (decision 13): ES lands on
      // the bare Spanish root — the root serves every language the design
      // carries (decision 12). The first click races hydration (the SSR
      // button exists before React attaches its handlers) — retry
      // click+navigation until the route moves.
      await expect(async () => {
        await page
          .getByRole(ROLE.button, { name: I18N.switcher.es, exact: true })
          .click();
        await expect(page).toHaveURL(/\/es$/);
      }).toPass({ timeout: 15_000 });
      await expect(
        page.getByRole(ROLE.heading, { name: I18N.esTitle, exact: true }),
      ).toBeVisible();

      // A content-only language serves at its bare tag: /pt-BR shows the
      // Portuguese layer…
      await page
        .getByRole(ROLE.button, { name: I18N.switcher.ptBr, exact: true })
        .click();
      await expect(page).toHaveURL(/\/pt-BR$/);
      await expect(
        page.getByRole(ROLE.heading, { name: I18N.ptTitle, exact: true }),
      ).toBeVisible();

      // …and EN comes back to the app-language root.
      await page
        .getByRole(ROLE.button, { name: I18N.switcher.en, exact: true })
        .click();
      await expect(page).toHaveURL(/\/en$/);
      await expect(
        page.getByRole(ROLE.heading, { name: I18N.seedTitle, exact: true }),
      ).toBeVisible();

      // The bare-slug sugar still resolves: /{slug} redirects to
      // /{default}/{slug} (decision 12's root resolution).
      await page.goto(`/${slug}`);
      await expect(page).toHaveURL(new RegExp(`/en/${slug}$`));

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
