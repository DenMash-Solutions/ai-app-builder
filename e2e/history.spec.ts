import { expect, test } from "@playwright/test";
import { ACTIONS, PROMPTS, ROLE, UI, historyButtonName } from "./constants";
import {
  generateCalls,
  mockGenerate,
  readHistoryStorage,
  waitForMsw,
} from "./helpers";

test.describe("history", () => {
  test("saves, persists across reload, restores, and deletes", async ({
    page,
  }) => {
    await mockGenerate(page);
    await page.goto("/");
    await waitForMsw(page);

    // Generate → auto-saved
    await page.getByRole(ROLE.button, { name: PROMPTS.signIn }).click();
    await expect(page.getByText(UI.mockHeading)).toBeVisible();
    await expect(
      page.getByRole(ROLE.button, { name: historyButtonName(1) }),
    ).toBeVisible();

    const stored = await readHistoryStorage(page);
    expect(stored).toHaveLength(1);
    expect(stored[0].prompt).toBe(PROMPTS.signIn);
    expect(stored[0].spec).toHaveProperty("elements");

    // Persist across a full reload
    await page.reload();
    await waitForMsw(page);
    await expect(
      page.getByRole(ROLE.button, { name: historyButtonName(1) }),
    ).toBeVisible();
    await expect(page.getByText(UI.emptyState)).toBeVisible();

    // Restore from the drawer without calling the API
    await page.getByRole(ROLE.button, { name: historyButtonName(1) }).click();
    const entry = page.getByRole(ROLE.button, {
      name: new RegExp(PROMPTS.signIn),
    });
    await expect(entry).toBeVisible();
    await expect(page.getByText(UI.justNow)).toBeVisible();
    await entry.click();

    await expect(page.getByText(UI.mockHeading)).toBeVisible();
    await expect(page.getByText(UI.mockBody)).toBeVisible();
    expect(await generateCalls(page)).toBe(0);

    // Delete the entry (drawer stays open showing the empty state)
    await page.getByRole(ROLE.button, { name: historyButtonName(1) }).click();
    await page.getByRole(ROLE.button, { name: ACTIONS.deleteEntry }).click();

    await expect(page.getByText(UI.historyEmpty)).toBeVisible();
    await page.getByRole(ROLE.button, { name: ACTIONS.close }).click();
    await expect(
      page.getByRole(ROLE.button, { name: ACTIONS.history }),
    ).toBeVisible();
    expect(await readHistoryStorage(page)).toHaveLength(0);
  });

  test("clears all entries at once", async ({ page }) => {
    await mockGenerate(page);
    await page.goto("/");
    await waitForMsw(page);

    await page.getByRole(ROLE.button, { name: PROMPTS.signIn }).click();
    await expect(
      page.getByRole(ROLE.button, { name: historyButtonName(1) }),
    ).toBeVisible();

    await page
      .getByRole(ROLE.button, { name: PROMPTS.revenueDashboard })
      .click();
    await expect(
      page.getByRole(ROLE.button, { name: historyButtonName(2) }),
    ).toBeVisible();
    expect(await readHistoryStorage(page)).toHaveLength(2);

    await page.getByRole(ROLE.button, { name: historyButtonName(2) }).click();
    await expect(
      page.getByRole(ROLE.button, {
        name: new RegExp(PROMPTS.signIn),
      }),
    ).toBeVisible();
    await expect(
      page.getByRole(ROLE.button, {
        name: new RegExp(PROMPTS.revenueDashboard),
      }),
    ).toBeVisible();
    await page.getByRole(ROLE.button, { name: ACTIONS.clearAll }).click();

    await expect(page.getByText(UI.historyEmpty)).toBeVisible();
    await page.getByRole(ROLE.button, { name: ACTIONS.close }).click();
    await expect(
      page.getByRole(ROLE.button, { name: ACTIONS.history }),
    ).toBeVisible();
    expect(await readHistoryStorage(page)).toHaveLength(0);
  });
});
