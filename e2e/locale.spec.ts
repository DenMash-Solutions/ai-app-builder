import { expect, test } from "@playwright/test";
import { ACTIONS, ES_UI, PATHS, ROLE, SWITCHER_LABELS, UI } from "./constants";
import { mockGenerate, waitForMsw } from "./helpers";

test.describe("locale", () => {
  test("redirects / to the default locale (featured landing) and switches the playground to Spanish", async ({
    page,
  }) => {
    await mockGenerate(page);
    await page.goto(PATHS.root);
    await waitForMsw(page);

    // Locale prefix is always on: / redirects to /en — and the root renders
    // the featured landing, not the playground.
    await expect(page).toHaveURL(/\/en$/);
    await expect(
      page.getByRole(ROLE.heading, { name: UI.landingTitle }),
    ).toBeVisible();
    await expect(page.getByPlaceholder(UI.promptPlaceholder)).toHaveCount(0);

    // The playground lives at /ui (client-side MSW survives the navigation)
    await page.goto(PATHS.ui);
    await waitForMsw(page);
    await expect(
      page.getByRole(ROLE.button, { name: ACTIONS.generate }),
    ).toBeVisible();
    await expect(page.getByPlaceholder(UI.promptPlaceholder)).toBeVisible();

    // Client-side navigation to /es via the switcher (MSW survives)
    await page.getByRole(ROLE.link, { name: SWITCHER_LABELS.es }).click();

    await expect(page).toHaveURL(/\/es\/ui$/);
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
