import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  AUTH,
  BANNER,
  PATHS,
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
 * (see docs/plan/033-live-pages/tasks.md §7.3) and the data layer via unit
 * tests. Assumes the landing page is featured as root (tasks.md §8), so
 * the playground entry point for these tests is `/ui`.
 */

async function generate(page: Page, prompt: string): Promise<void> {
  await page.getByRole(ROLE.button, { name: prompt }).click();
  await expect(page.getByText(UI.mockHeading)).toBeVisible();
}

test.describe("featured root", () => {
  test("the root renders the featured landing page", async ({ page }) => {
    await page.goto(PATHS.root);
    await expect(page).toHaveURL(/\/en$/);
    await expect(
      page.getByRole(ROLE.heading, { name: UI.landingTitle }),
    ).toBeVisible();
    // The way into the playground — the landing is spec-driven (featured
    // page), so the floating pill is the entry point it guarantees.
    await expect(
      page.getByRole(ROLE.link, { name: UI.landingPill }),
    ).toHaveAttribute("href", /\/en\/ui$/);
    // …but no playground chrome on the landing itself.
    await expect(page.getByPlaceholder(UI.promptPlaceholder)).toHaveCount(0);
  });
});

test.describe("product smoke — DenMash", () => {
  test("the real DenMash live page renders the intended production copy", async ({
    page,
  }) => {
    // Decision (e2e-hardening): two independent contracts. The root test
    // above holds for whatever is legitimately featured — the seeded fixture
    // and denmash both carry the same headline, each written separately.
    // This one pins the PRODUCT's public landing directly, so copy drift
    // fails loudly here instead of setup + assertion passing in lockstep.
    await page.goto("/en/denmash");
    await expect(
      page.getByRole(ROLE.heading, { name: UI.landingTitle }),
    ).toBeVisible();
    await expect(
      page.getByRole(ROLE.link, { name: UI.landingPill }),
    ).toHaveAttribute("href", /\/en\/ui$/);
  });
});

test.describe("spec-rendered auth pages", () => {
  test("login renders as a spec form and cross-links to signup", async ({
    page,
  }) => {
    await page.goto(PATHS.login);
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
    await page.goto(PATHS.login);
    await expect(page.getByText(UI.editInPlayground)).toHaveCount(0);
    await page.goto(PATHS.signup);
    await expect(page.getByText(UI.editInPlayground)).toHaveCount(0);
  });
});

test.describe("anonymous banners", () => {
  test("the signup banner shows on the playground landing with local UIs and its dismissal sticks", async ({
    page,
  }) => {
    await mockGenerate(page);
    await page.goto(PATHS.ui);
    await waitForMsw(page);
    await generate(page, PROMPTS.signIn);

    // Landing only: with an active entry the CTA would overlay the canvas.
    await page.goto(PATHS.ui);
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
    await page.goto(PATHS.ui);
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
    await page.goto(PATHS.ui);
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
    await page.goto(PATHS.ui);
    const stored = await page.evaluate(() => {
      const raw = localStorage.getItem("genui-playground-history");
      return raw ? (JSON.parse(raw) as Array<{ slug: string }>) : [];
    });
    expect(stored[0]?.slug).not.toBe("login");
  });
});
