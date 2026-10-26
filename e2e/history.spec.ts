import { expect, test } from "@playwright/test";
import {
  ACTIONS,
  PATHS,
  PROMPTS,
  ROLE,
  UI,
  entryRowName,
  historyButtonName,
} from "./constants";
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
    await page.goto(PATHS.ui);
    await waitForMsw(page);

    // Generate → auto-saved (then redirected to /ui/[id])
    await page
      .getByRole(ROLE.button, { name: PROMPTS.signIn })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByText(UI.mockHeading).filter({ visible: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);
    await expect(
      page
        .getByRole(ROLE.button, { name: historyButtonName(1) })
        .filter({ visible: true }),
    ).toBeVisible();

    const stored = await readHistoryStorage(page);
    expect(stored).toHaveLength(1);
    expect(stored[0].prompt).toBe(PROMPTS.signIn);
    expect(stored[0].spec).toHaveProperty("elements");

    // Persist across a full reload — the /ui/[id] URL deep-links the entry
    await page.reload();
    await waitForMsw(page);
    await expect(
      page
        .getByRole(ROLE.button, { name: historyButtonName(1) })
        .filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText(UI.mockHeading).filter({ visible: true }),
    ).toBeVisible();

    // Restore from the drawer without calling the API
    await page
      .getByRole(ROLE.button, { name: historyButtonName(1) })
      .filter({ visible: true })
      .click();
    const entry = page
      .getByRole(ROLE.button, {
        name: entryRowName(PROMPTS.signIn),
      })
      .filter({ visible: true });
    await expect(entry).toBeVisible();
    await expect(
      page.getByText(UI.justNow).filter({ visible: true }),
    ).toBeVisible();
    await entry.click();

    await expect(
      page.getByText(UI.mockHeading).filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText(UI.mockBody).filter({ visible: true }),
    ).toBeVisible();
    expect(await generateCalls(page)).toBe(0);

    // Delete the active entry → back to the landing (the drawer unmounts
    // with the route, so reopen it to confirm the empty state)
    await page
      .getByRole(ROLE.button, { name: historyButtonName(1) })
      .filter({ visible: true })
      .click();
    await page
      .getByRole(ROLE.button, { name: ACTIONS.deleteEntry })
      .filter({ visible: true })
      .click();

    await expect(
      page.getByText(UI.emptyState).filter({ visible: true }),
    ).toBeVisible();
    await page
      .getByRole(ROLE.button, { name: historyButtonName() })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByText(UI.historyEmpty).filter({ visible: true }),
    ).toBeVisible();
    await page
      .getByRole(ROLE.button, { name: ACTIONS.close })
      .filter({ visible: true })
      .click();
    await expect(
      page
        .getByRole(ROLE.button, { name: ACTIONS.history })
        .filter({ visible: true }),
    ).toBeVisible();
    expect(await readHistoryStorage(page)).toHaveLength(0);
  });

  test("clears all entries at once", async ({ page }) => {
    await mockGenerate(page);
    await page.goto(PATHS.ui);
    await waitForMsw(page);

    await page
      .getByRole(ROLE.button, { name: PROMPTS.signIn })
      .filter({ visible: true })
      .click();
    await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);
    await expect(
      page
        .getByRole(ROLE.button, { name: historyButtonName(1) })
        .filter({ visible: true }),
    ).toBeVisible();

    // Example chips only show in the empty state — clear the canvas first.
    await page
      .getByRole(ROLE.button, { name: ACTIONS.clear })
      .filter({ visible: true })
      .click();
    await page
      .getByRole(ROLE.button, { name: PROMPTS.revenueDashboard })
      .filter({ visible: true })
      .click();
    await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);
    await expect(
      page
        .getByRole(ROLE.button, { name: historyButtonName(2) })
        .filter({ visible: true }),
    ).toBeVisible();
    expect(await readHistoryStorage(page)).toHaveLength(2);

    await page
      .getByRole(ROLE.button, { name: historyButtonName(2) })
      .filter({ visible: true })
      .click();
    await expect(
      page
        .getByRole(ROLE.button, {
          name: entryRowName(PROMPTS.signIn),
        })
        .filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole(ROLE.button, {
          name: entryRowName(PROMPTS.revenueDashboard),
        })
        .filter({ visible: true }),
    ).toBeVisible();
    await page
      .getByRole(ROLE.button, { name: ACTIONS.clearAll })
      .filter({ visible: true })
      .click();

    // Clearing from /ui/[id] navigates back to the landing and unmounts the
    // drawer — reopen it to confirm it is empty
    await expect(
      page.getByText(UI.emptyState).filter({ visible: true }),
    ).toBeVisible();
    await page
      .getByRole(ROLE.button, { name: historyButtonName() })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByText(UI.historyEmpty).filter({ visible: true }),
    ).toBeVisible();
    await page
      .getByRole(ROLE.button, { name: ACTIONS.close })
      .filter({ visible: true })
      .click();
    await expect(
      page
        .getByRole(ROLE.button, { name: ACTIONS.history })
        .filter({ visible: true }),
    ).toBeVisible();
    expect(await readHistoryStorage(page)).toHaveLength(0);
  });
});
