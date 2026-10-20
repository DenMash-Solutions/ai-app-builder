import { expect, test } from "@playwright/test";
import { AUTH, PATHS, ROLE, SHELL } from "./constants";

/**
 * App shell (docs/plan/034-app-shell): sidebar navigation + account menu on the
 * app surfaces (`/ui/**`, `/admin`), chrome-less public content (landing,
 * live, preview, auth), the anonymous `/admin` guard with its return path,
 * and the mobile drawer. Nothing here signs in — authenticated state is
 * covered by the MCP journey and (later) the authed e2e suites.
 */

test.describe("app shell — desktop", () => {
  test("the playground shows the sidebar with a sign-in action and no admin link", async ({
    page,
  }) => {
    await page.goto(PATHS.ui);

    const nav = page.getByRole(ROLE.navigation, { name: SHELL.navLabel });
    await expect(nav).toBeVisible();
    await expect(
      nav.getByRole(ROLE.link, { name: SHELL.playgroundNav }),
    ).toHaveAttribute("href", /\/en\/ui$/);
    // Live pages is admin-only — absent for anonymous visitors.
    await expect(
      page.getByRole(ROLE.link, { name: SHELL.livePagesNav }),
    ).toHaveCount(0);

    await page.getByRole(ROLE.link, { name: SHELL.signIn }).click();
    await expect(page).toHaveURL(/\/en\/login$/);
    await expect(
      page.getByRole(ROLE.heading, { name: AUTH.loginTitle }),
    ).toBeVisible();
  });

  test("the anonymous /admin visit redirects to login with a return path", async ({
    page,
  }) => {
    await page.goto(PATHS.admin);
    await expect(page).toHaveURL(/\/en\/login\?next=%2Fen%2Fadmin$/);
    await expect(
      page.getByRole(ROLE.heading, { name: AUTH.loginTitle }),
    ).toBeVisible();
  });

  test("the sidebar follows the route locale", async ({ page }) => {
    await page.goto("/es/ui");
    await expect(
      page.getByRole(ROLE.navigation, { name: SHELL.esNavLabel }),
    ).toBeVisible();
    const signIn = page.getByRole(ROLE.link, { name: SHELL.esSignIn });
    await expect(signIn).toBeVisible();
    await expect(signIn).toHaveAttribute("href", /\/es\/login$/);
  });

  test("public content stays chrome-less", async ({ page }) => {
    await page.goto(PATHS.root);
    await expect(page).toHaveURL(/\/en$/);
    await expect(page.getByRole(ROLE.navigation)).toHaveCount(0);
    await page.goto(PATHS.login);
    await expect(page.getByRole(ROLE.navigation)).toHaveCount(0);
  });
});

test.describe("app shell — mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("navigation collapses into an edge drawer", async ({ page }) => {
    await page.goto(PATHS.ui);

    // No sidebar; the edge tab opens the drawer.
    await expect(page.getByRole(ROLE.navigation)).toHaveCount(0);
    const tab = page.getByRole(ROLE.button, { name: SHELL.openMenu });
    await tab.click();

    const nav = page.getByRole(ROLE.navigation, { name: SHELL.navLabel });
    await expect(nav).toBeVisible();
    await expect(
      page.getByRole(ROLE.link, { name: SHELL.signIn }),
    ).toBeVisible();

    // The in-sheet close button dismisses it (the outside trigger unmounts
    // while open — radix hides the outside world from the a11y tree).
    await expect(tab).toHaveCount(0);
    await page.getByRole(ROLE.button, { name: SHELL.closeMenu }).click();
    await expect(page.getByRole(ROLE.navigation)).toHaveCount(0);
    await expect(tab).toBeVisible();
  });
});
