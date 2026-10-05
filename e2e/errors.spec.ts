import { expect, test } from "@playwright/test";
import { MODELS, PROMPTS, QUOTA, ROLE, UI } from "./constants";
import {
  generateCalls,
  mockGenerate,
  readHistoryStorage,
  waitForMsw,
} from "./helpers";

const RATE_LIMIT_BODY = {
  error: "Rate limit reached for gemini-3.8-flash",
  code: "rate_limit",
};

test.describe("error handling", () => {
  test("quota failure opens the model dialog and auto-retries with the selected model", async ({
    page,
  }) => {
    await mockGenerate(page, { status: 429, body: RATE_LIMIT_BODY });
    await page.goto("/");
    await waitForMsw(page);

    await page.getByRole(ROLE.button, { name: PROMPTS.signIn }).click();

    // Quota dialog replaces the old inline error alert.
    await expect(page.getByText(QUOTA.title)).toBeVisible();
    await expect(page.getByText(QUOTA.description)).toBeVisible();
    await expect(
      page.getByRole(ROLE.button, { name: QUOTA.switchAndRetry }),
    ).toBeDisabled();

    // Switch to a higher-limit model, let the mock recover, then retry.
    await page
      .getByRole("menuitemradio", { name: new RegExp(MODELS.lite) })
      .click();
    await page.evaluate(() => {
      (window as unknown as { __GENERATE_MOCK__?: object }).__GENERATE_MOCK__ =
        {};
    });
    await page.getByRole(ROLE.button, { name: QUOTA.switchAndRetry }).click();

    await expect(page.getByText(UI.mockHeading)).toBeVisible();
    await expect(page.getByText(QUOTA.title)).not.toBeVisible();
    expect(await generateCalls(page)).toBeGreaterThanOrEqual(2);

    const history = await readHistoryStorage(page);
    expect(history).toHaveLength(1);
    expect(history[0].prompt).toBe(PROMPTS.signIn);

    // The header pill reflects the switched model.
    await expect(
      page.getByRole(ROLE.button, { name: MODELS.liteShortLabel }),
    ).toBeVisible();
  });

  test("dismissing the quota dialog reports the failure as a toast", async ({
    page,
  }) => {
    await mockGenerate(page, { status: 429, body: RATE_LIMIT_BODY });
    await page.goto("/");
    await waitForMsw(page);

    await page.getByRole(ROLE.button, { name: PROMPTS.signIn }).click();
    await expect(page.getByText(QUOTA.title)).toBeVisible();

    await page.getByRole(ROLE.button, { name: QUOTA.dismiss }).click();

    await expect(page.getByText(UI.generationFailed)).toBeVisible();
    await expect(page.getByText(RATE_LIMIT_BODY.error)).toBeVisible();
    await expect(page.getByText(QUOTA.title)).not.toBeVisible();
    expect(await readHistoryStorage(page)).toHaveLength(0);
  });

  test("the selected model persists across reloads", async ({ page }) => {
    await mockGenerate(page);
    await page.goto("/");
    await waitForMsw(page);

    await page
      .getByRole(ROLE.button, { name: MODELS.defaultShortLabel })
      .click();
    await page
      .getByRole("menuitemradio", { name: new RegExp(MODELS.lite) })
      .click();

    await page.reload();
    await waitForMsw(page);

    await expect(
      page.getByRole(ROLE.button, { name: MODELS.liteShortLabel }),
    ).toBeVisible();
  });
});
