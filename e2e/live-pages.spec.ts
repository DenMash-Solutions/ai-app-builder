import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  AUTH,
  BANNER,
  PROMPTS,
  PUBLISH,
  RENAME,
  ROLE,
  UI,
  historyButtonName,
} from "./constants";
import { mockGenerate, waitForMsw } from "./helpers";

/**
 * Anonymous / auth / publish-adjacent paths for the live-pages feature.
 * Nothing here signs in (credentials never live in the repo) — the
 * authenticated half of the journey is verified via the MCP script
 * (see docs/plan/live-pages/tasks.md §7.3) and the data layer via unit
 * tests. Assumes `site_settings.featured_ui_id` is null (root fallback).
 */

async function generate(page: Page, prompt: string): Promise<void> {
  await page.getByRole(ROLE.button, { name: prompt }).click();
  await expect(page.getByText(UI.mockHeading)).toBeVisible();
}

test.describe("root fallback", () => {
  test("the root renders the playground landing when nothing is featured", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/en$/);
    await expect(
      page.getByRole(ROLE.heading, { name: UI.heading }),
    ).toBeVisible();
    await expect(page.getByPlaceholder(UI.promptPlaceholder)).toBeVisible();
    await expect(page.getByText(UI.emptyState)).toBeVisible();
  });
});

test.describe("spec-rendered auth pages", () => {
  test("login renders as a spec form and cross-links to signup", async ({
    page,
  }) => {
    await page.goto("/en/login");
    await expect(
      page.getByRole(ROLE.heading, { name: AUTH.loginTitle }),
    ).toBeVisible();
    await expect(page.getByLabel(AUTH.email)).toBeVisible();
    await expect(page.getByLabel(AUTH.password)).toBeVisible();
    await expect(
      page.getByRole(ROLE.button, { name: AUTH.loginSubmit }),
    ).toBeVisible();

    await page.getByRole(ROLE.link, { name: AUTH.toSignup }).click();
    await expect(page).toHaveURL(/\/en\/signup$/);
    await expect(
      page.getByRole(ROLE.heading, { name: AUTH.signupTitle }),
    ).toBeVisible();
    await expect(page.getByLabel(AUTH.email)).toBeVisible();
    await expect(page.getByLabel(AUTH.confirm)).toBeVisible();
    await expect(
      page.getByRole(ROLE.button, { name: AUTH.signupSubmit }),
    ).toBeVisible();

    await page.getByRole(ROLE.link, { name: AUTH.toLogin }).click();
    await expect(page).toHaveURL(/\/en\/login$/);
  });

  test("no committed page leaks the edit-in-playground affordance", async ({
    page,
  }) => {
    await page.goto("/en/login");
    await expect(page.getByText(UI.editInPlayground)).toHaveCount(0);
    await page.goto("/en/signup");
    await expect(page.getByText(UI.editInPlayground)).toHaveCount(0);
  });
});

test.describe("anonymous banners", () => {
  test("the signup banner shows on the landing with local UIs and its dismissal sticks", async ({
    page,
  }) => {
    await mockGenerate(page);
    await page.goto("/");
    await waitForMsw(page);
    await generate(page, PROMPTS.signIn);

    // Landing only: with an active entry the CTA would overlay the canvas.
    await page.goto("/");
    await expect(page.getByText(BANNER.text)).toBeVisible();
    const cta = page.getByRole(ROLE.link, { name: BANNER.cta });
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("href", /\/en\/signup$/);

    await page.getByRole(ROLE.button, { name: BANNER.dismiss }).click();
    await expect(page.getByText(BANNER.text)).toHaveCount(0);

    await page.reload();
    await expect(page.getByText(BANNER.text)).toHaveCount(0);
  });

  test("history rows offer a signup CTA instead of a publish action", async ({
    page,
  }) => {
    await mockGenerate(page);
    await page.goto("/");
    await waitForMsw(page);
    await generate(page, PROMPTS.signIn);

    // Wait for the post-generation redirect to settle: opening the drawer
    // mid-navigation gets dropped when the route remounts the playground.
    await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);
    await expect(
      page.getByRole(ROLE.button, { name: historyButtonName(1) }),
    ).toBeVisible();
    await page.getByRole(ROLE.button, { name: historyButtonName(1) }).click();
    // The CTA mounts once the auth state resolves inside the animating
    // drawer — wait for it to settle before clicking.
    const cta = page.getByRole(ROLE.link, { name: PUBLISH.signupCta });
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("href", /\/en\/signup$/);
    await cta.click();
    await expect(page).toHaveURL(/\/en\/signup$/);
  });
});

test.describe("reserved slugs", () => {
  test("a reserved route segment blocks the rename save", async ({ page }) => {
    await mockGenerate(page);
    await page.goto("/");
    await waitForMsw(page);
    await generate(page, PROMPTS.signIn);

    await page.getByRole(ROLE.button, { name: RENAME.open }).click();
    await page.getByLabel(RENAME.slug, { exact: true }).fill("login");

    await expect(page.getByText(RENAME.slugReserved)).toBeVisible();
    await expect(
      page.getByRole(ROLE.button, { name: RENAME.save }),
    ).toBeDisabled();

    // The stored slug is untouched.
    await page.keyboard.press("Escape");
    await page.goto("/");
    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem("genui-playground-history");
      return raw ? (JSON.parse(raw) as Array<{ slug: string }>) : [];
    });
    expect(stored[0]?.slug).not.toBe("login");
  });
});
