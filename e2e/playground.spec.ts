import { expect, test } from "@playwright/test";
import {
  ACTIONS,
  MOCK_ERROR_MESSAGE,
  MOCK_ROOT_KEY,
  PROMPTS,
  QUOTA,
  ROLE,
  UI,
  historyButtonName,
} from "./constants";
import {
  generateCalls,
  mockGenerate,
  readHistoryStorage,
  waitForMsw,
} from "./helpers";

test.describe("playground", () => {
  test("renders the shell with an empty state", async ({ page }) => {
    await mockGenerate(page);
    await page.goto("/");
    await waitForMsw(page);

    await expect(
      page.getByRole(ROLE.heading, { name: UI.heading }),
    ).toBeVisible();
    await expect(page.getByText(UI.emptyState)).toBeVisible();
    await expect(
      page.getByRole(ROLE.button, { name: ACTIONS.history }),
    ).toBeVisible();
    await expect(page.getByPlaceholder(UI.promptPlaceholder)).toBeVisible();
  });

  test("renders the mocked UI from an example chip", async ({ page }) => {
    await mockGenerate(page);
    await page.goto("/");
    await waitForMsw(page);

    await page.getByRole(ROLE.button, { name: PROMPTS.signIn }).click();

    await expect(page.getByText(UI.mockHeading)).toBeVisible();
    await expect(page.getByText(UI.mockBody)).toBeVisible();
    await expect(
      page.getByRole(ROLE.button, { name: historyButtonName(1) }),
    ).toBeVisible();
    expect(await generateCalls(page)).toBe(1);
  });

  test("generates from a custom prompt and stores it in history", async ({
    page,
  }) => {
    await mockGenerate(page);
    await page.goto("/");
    await waitForMsw(page);

    const prompt = PROMPTS.customBilling;
    await page.getByPlaceholder(UI.promptPlaceholder).fill(prompt);
    await page.getByRole(ROLE.button, { name: ACTIONS.generate }).click();

    await expect(page.getByText(UI.mockHeading)).toBeVisible();

    const history = await readHistoryStorage(page);
    expect(history).toHaveLength(1);
    expect(history[0].prompt).toBe(prompt);
    expect(history[0].spec.root).toBe(MOCK_ROOT_KEY);
  });

  test("shows an error toast when the API fails and saves nothing", async ({
    page,
  }) => {
    await mockGenerate(page, {
      status: 500,
      body: { error: MOCK_ERROR_MESSAGE },
    });
    await page.goto("/");
    await waitForMsw(page);

    await page.getByRole(ROLE.button, { name: PROMPTS.signIn }).click();

    await expect(page.getByText(UI.generationFailed)).toBeVisible();
    await expect(page.getByText(MOCK_ERROR_MESSAGE)).toBeVisible();
    await expect(page.getByText(QUOTA.title)).not.toBeVisible();
    await expect(
      page.getByRole(ROLE.button, { name: ACTIONS.history }),
    ).toBeVisible();
    expect(await readHistoryStorage(page)).toHaveLength(0);
  });
});
