import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  dismissUploadNudge,
  generateUnique,
  historyRow,
  openHistory,
} from "./authed-helpers";
import {
  PATHS,
  PUBLISH,
  ROLE,
  SLOTS,
  USERNAME,
  accountMenuLabel,
} from "./constants";
import { deleteTestRow, waitForRemoteRow } from "./db";
import { BASE_URL, e2eEnv, hasAdminAuth, hasUserAuth, statePath } from "./env";
import { PUBLISH_UI_LINES } from "./msw/fixture";

/**
 * Usernames + public profiles (plan 068). Serial on purpose: the claim of each
 * identity's handle has to land before the "taken" and profile tests read it,
 * and both identities share one database.
 *
 * The handles are derived from the dedicated e2e identities, so a re-run lands
 * on the same handle and the claim step is a no-op (the account menu already
 * shows `@handle`). That also means "banner shows while unclaimed" can only be
 * observed on a first run; the assertion here is the post-claim state.
 */

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  // Next's dev tools shadow host is a 0×0 `nextjs-portal` that still wins
  // hit-testing over the sidebar footer (the account button), so Playwright
  // reports the portal "intercepts pointer events". Dev-only artifact of a
  // reused `next dev`; neutralise it per document instead of force-clicking.
  await page.addInitScript(() => {
    const apply = () => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal { pointer-events: none !important; }";
      document.head.appendChild(style);
    };
    if (document.head) apply();
    else document.addEventListener("DOMContentLoaded", apply, { once: true });
  });
});

/** `e2e-<slugified local part>` — always pattern-valid and never reserved. */
function handleFor(email: string): string {
  const local = (email.split("@")[0] ?? "").toLowerCase();
  const slug = local.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `e2e-${slug}`.slice(0, 40);
}

async function openAccountMenu(page: Page, email: string): Promise<void> {
  // The first-login upload nudge pins the same bottom-left corner.
  await dismissUploadNudge(page);
  await page.getByRole(ROLE.button, { name: accountMenuLabel(email) }).click();
  await expect(page.getByTestId("username-menu-item")).toBeVisible();
} /** Claims the identity's handle if it has none yet (idempotent across runs). */
async function claimIfNeeded(
  page: Page,
  email: string,
  handle: string,
): Promise<void> {
  await page.goto(PATHS.ui);
  await openAccountMenu(page, email);
  await page.getByTestId("username-menu-item").click();
  const dialog = page.locator(SLOTS.dialog);
  await expect(dialog).toBeVisible();

  // The dialog's own title says which flow this is: an account that already
  // has a handle gets the change dialog. Branching on the title avoids racing
  // the profile fetch that fills the menu label.
  const claimTitle = dialog.getByRole(ROLE.heading, {
    name: USERNAME.claimTitle,
  });
  const changeTitle = dialog.getByRole(ROLE.heading, {
    name: USERNAME.changeTitle,
  });
  await expect(claimTitle.or(changeTitle)).toBeVisible();
  if (await changeTitle.isVisible()) {
    await page.keyboard.press("Escape");
    return;
  }

  await dialog.locator("#username-claim-input").fill(handle);
  // Availability is a server round trip behind a debounce — the verdict, not
  // the keystroke, is what enables the submit.
  await expect(dialog.locator("#username-claim-status")).toHaveText(
    USERNAME.available,
    { timeout: 15_000 },
  );
  await dialog.getByRole(ROLE.button, { name: USERNAME.submit }).click();
  await expect(dialog).toBeHidden();
}

async function expectClaimed(
  page: Page,
  email: string,
  handle: string,
): Promise<void> {
  await page.goto(PATHS.ui);
  await openAccountMenu(page, email);
  // Auto-retrying: the menu label fills in when the profile read lands.
  await expect(page.getByTestId("username-menu-item")).toContainText(
    `@${handle}`,
    { timeout: 15_000 },
  );
  await page.keyboard.press("Escape");
  // Claimed → the prompt has nothing left to ask for.
  await expect(page.getByText(USERNAME.bannerTitle)).toHaveCount(0);
}

/** Publishes an existing history entry (same journey as authed.spec). */
async function publishEntry(
  page: Page,
  prompt: string,
  slug: string,
): Promise<void> {
  await waitForRemoteRow(prompt);
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

test.describe("usernames — admin identity", () => {
  test.skip(!hasAdminAuth, "E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set");

  test("claims its handle and the claim prompt disappears", async ({
    page,
  }) => {
    const handle = handleFor(e2eEnv.adminEmail);
    await claimIfNeeded(page, e2eEnv.adminEmail, handle);
    await expectClaimed(page, e2eEnv.adminEmail, handle);
  });
});

test.describe("usernames — non-admin identity", () => {
  test.use({ storageState: statePath("user.json") });
  test.skip(!hasUserAuth, "E2E_USER_EMAIL / E2E_USER_PASSWORD not set");

  test("claims its own handle", async ({ page }) => {
    const handle = handleFor(e2eEnv.userEmail);
    await claimIfNeeded(page, e2eEnv.userEmail, handle);
    await expectClaimed(page, e2eEnv.userEmail, handle);
  });

  test("a handle owned by someone else is refused inline", async ({ page }) => {
    const taken = handleFor(e2eEnv.adminEmail);
    await page.goto(PATHS.ui);
    await openAccountMenu(page, e2eEnv.userEmail);
    await page.getByTestId("username-menu-item").click();
    const dialog = page.locator(SLOTS.dialog);
    await expect(dialog).toBeVisible();

    await dialog.locator("#username-claim-input").fill(taken);
    // The verdict comes from the `username_available` RPC — the client cannot
    // grant itself a name, and the submit stays blocked while it is taken.
    await expect(dialog.locator("#username-claim-status")).toHaveText(
      USERNAME.taken,
      { timeout: 15_000 },
    );
    await expect(
      dialog.getByRole(ROLE.button, { name: USERNAME.submit }),
    ).toBeDisabled();
  });

  test("the profile lists published UIs only, and 404s unknown handles", async ({
    page,
    browser,
  }) => {
    const handle = handleFor(e2eEnv.userEmail);
    const publishedName = `E2E profile ${randomUUID()}`;
    const draftName = `E2E draft ${randomUUID()}`;
    const slug = `e2e-${randomUUID()}`;
    let publishedId: string | undefined;
    let draftId: string | undefined;

    try {
      publishedId = await generateUnique(page, publishedName, PUBLISH_UI_LINES);
      await publishEntry(page, publishedName, slug);
      // A second entry stays in the account but is never published.
      draftId = await generateUnique(page, draftName, PUBLISH_UI_LINES);

      const response = await page.goto(`/en/user/${handle}/ui`);
      expect(response?.status()).toBe(200);
      await expect(
        page.getByRole(ROLE.heading, {
          name: USERNAME.profileTitle(handle),
        }),
      ).toBeVisible();
      await expect(page.getByText(publishedName)).toBeVisible();
      await expect(page.getByText(draftName)).toHaveCount(0);

      // Anonymous visitors get the same list — the profile is public, the
      // account behind it is not.
      const anon = await browser.newContext({ baseURL: BASE_URL });
      try {
        const anonPage = await anon.newPage();
        const anonResponse = await anonPage.goto(`/en/user/${handle}/ui`);
        expect(anonResponse?.status()).toBe(200);
        await expect(anonPage.getByText(publishedName)).toBeVisible();
        await expect(anonPage.getByText(draftName)).toHaveCount(0);
      } finally {
        await anon.close();
      }
    } finally {
      await deleteTestRow(draftId);
      await deleteTestRow(publishedId);
    }

    const unknown = await page.goto(`/en/user/e2e-unknown-${randomUUID()}/ui`);
    expect(unknown?.status()).toBe(404);
  });

  test("deep links into the profile keep the locale and app-segment rules", async ({
    page,
  }) => {
    const handle = handleFor(e2eEnv.userEmail);

    // Unprefixed three-segment app path: `user` is an APP_SEGMENT, so it gets
    // the usual locale redirect instead of the content-path 404 rewrite.
    await page.goto(`/user/${handle}/ui`);
    await expect(page).toHaveURL(new RegExp(`/en/user/${handle}/ui$`));

    // Two segments is not a page: `/en/user/<handle>` stays a real 404.
    const twoSegments = await page.goto(`/en/user/${handle}`);
    expect(twoSegments?.status()).toBe(404);
  });
});
