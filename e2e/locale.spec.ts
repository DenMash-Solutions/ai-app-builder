import { expect, test } from "@playwright/test";
import { ACTIONS, ES_UI, ROLE, SWITCHER_LABELS, UI } from "./constants";
import { mockGenerate, waitForMsw } from "./helpers";

test.describe("locale", () => {
  test("redirects / to the default locale and switches to Spanish", async ({
    page,
  }) => {
    await mockGenerate(page);
    await page.goto("/");
    await waitForMsw(page);

    // Locale prefix is always on: / redirects to /en
    await expect(page).toHaveURL(/\/en$/);
    await expect(
      page.getByRole(ROLE.button, { name: ACTIONS.generate }),
    ).toBeVisible();
    await expect(page.getByPlaceholder(UI.promptPlaceholder)).toBeVisible();

    // Client-side navigation to /es via the switcher (MSW survives)
    await page.getByRole(ROLE.link, { name: SWITCHER_LABELS.es }).click();

    await expect(page).toHaveURL(/\/es$/);
    await expect(
      page.getByRole(ROLE.heading, { name: ES_UI.heading }),
    ).toBeVisible();
    await expect(page.getByPlaceholder(ES_UI.promptPlaceholder)).toBeVisible();
    await expect(
      page.getByRole(ROLE.button, { name: ES_UI.generate }),
    ).toBeVisible();
    await expect(
      page.getByRole(ROLE.button, { name: ES_UI.history }),
    ).toBeVisible();
    await expect(page.getByText(ES_UI.subtitle)).toBeVisible();
  });
});
