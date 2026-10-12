import { expect, test } from "@playwright/test";
import { PATHS, ROLE, THEME } from "./constants";

const DARK_CLASS = /(^|\s)dark(\s|$)/;

test.describe("theme", () => {
  test("toggles dark mode and persists it across a reload", async ({
    page,
  }) => {
    await page.goto(PATHS.ui);
    const html = page.locator("html");

    await expect(html).not.toHaveClass(DARK_CLASS);

    await page.getByRole(ROLE.button, { name: THEME.toggleToDark }).click();
    await expect(html).toHaveClass(DARK_CLASS);

    await page.reload();
    await expect(page.locator("html")).toHaveClass(DARK_CLASS);

    await page.getByRole(ROLE.button, { name: THEME.toggleToLight }).click();
    await expect(page.locator("html")).not.toHaveClass(DARK_CLASS);
  });
});
