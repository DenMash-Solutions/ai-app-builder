import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ACTIONS, PROMPTS, ROLE, UI, entryRowName } from "./constants";
import { mockGenerate, readHistoryStorage, waitForMsw } from "./helpers";

const UI_ROUTE_URL =
  /\/ui\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function generate(page: Page, prompt: string): Promise<void> {
  await page.getByRole(ROLE.button, { name: prompt }).click();
  await expect(page.getByText(UI.mockHeading)).toBeVisible();
}

test.describe("ui routes", () => {
  test("generation redirects to /ui/[id] and the deep link survives a reload", async ({
    page,
  }) => {
    await mockGenerate(page);
    await page.goto("/");
    await waitForMsw(page);

    await generate(page, PROMPTS.signIn);

    await expect(page).toHaveURL(UI_ROUTE_URL);
    const [entry] = await readHistoryStorage(page);
    expect(entry).toBeDefined();
    await expect(page).toHaveURL(new RegExp(`/ui/${entry!.id}$`));

    // The URL owns the active entry: a reload restores it without the drawer
    await page.reload();
    await waitForMsw(page);
    await expect(page.getByText(UI.mockHeading)).toBeVisible();
  });

  test("history selection navigates to the selected entry's /ui/[id]", async ({
    page,
  }) => {
    await mockGenerate(page);
    await page.goto("/");
    await waitForMsw(page);

    // Two entries: signIn first (older), revenueDashboard second (newest/active)
    await generate(page, PROMPTS.signIn);
    await expect(page).toHaveURL(UI_ROUTE_URL);
    await page.getByRole(ROLE.button, { name: ACTIONS.clear }).click();
    await expect(page.getByText(UI.emptyState)).toBeVisible();
    await generate(page, PROMPTS.revenueDashboard);

    const stored = await readHistoryStorage(page);
    expect(stored).toHaveLength(2);
    const [newest, older] = stored;
    await expect(page).toHaveURL(new RegExp(`/ui/${newest!.id}$`));

    // Selecting the older entry from the drawer switches the URL to it
    await page.getByRole(ROLE.button, { name: /History/ }).click();
    await page
      .getByRole(ROLE.button, { name: entryRowName(PROMPTS.signIn) })
      .click();
    await expect(page).toHaveURL(new RegExp(`/ui/${older!.id}$`));
    await expect(page.getByText(UI.mockHeading)).toBeVisible();
  });

  test("a deep link to an unknown id shows the not-found panel with a way back", async ({
    page,
  }) => {
    await page.goto("/ui/00000000-0000-4000-8000-000000000000");
    await expect(
      page.getByRole(ROLE.heading, { name: UI.uiRouteNotFoundTitle }),
    ).toBeVisible();

    await page.getByRole(ROLE.link, { name: UI.uiRouteNotFoundBack }).click();
    await expect(page).toHaveURL(/\/(en|es)?$/);
    await expect(page.getByText(UI.emptyState)).toBeVisible();
  });
});
