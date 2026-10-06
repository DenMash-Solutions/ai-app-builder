import { expect, test } from "@playwright/test";
import {
  ACTIONS,
  MOCK_KEYS,
  MODELS,
  PROMPTS,
  QUOTA,
  ROLE,
  SERVICE,
  UI,
} from "./constants";
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

const SERVICE_BODY = {
  error:
    "Service unavailable: gemini-3.1-flash-lite returned no response — switch model and retry.",
  code: "service_unavailable",
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

  test("service failure opens the model dialog and retries with the selected model", async ({
    page,
  }) => {
    await mockGenerate(page, { status: 503, body: SERVICE_BODY });
    await page.goto("/");
    await waitForMsw(page);

    await page.getByRole(ROLE.button, { name: PROMPTS.signIn }).click();

    await expect(page.getByText(SERVICE.title)).toBeVisible();
    await expect(page.getByText(SERVICE.description)).toBeVisible();
    await expect(
      page.getByRole(ROLE.button, { name: SERVICE.switchAndRetry }),
    ).toBeDisabled();

    await page
      .getByRole("menuitemradio", { name: new RegExp(MODELS.lite) })
      .click();
    await page.evaluate(() => {
      (window as unknown as { __GENERATE_MOCK__?: object }).__GENERATE_MOCK__ =
        {};
    });
    await page.getByRole(ROLE.button, { name: SERVICE.switchAndRetry }).click();

    await expect(page.getByText(UI.mockHeading)).toBeVisible();
    await expect(page.getByText(SERVICE.title)).not.toBeVisible();
    expect(await generateCalls(page)).toBeGreaterThanOrEqual(2);

    const history = await readHistoryStorage(page);
    expect(history).toHaveLength(1);
    expect(history[0].prompt).toBe(PROMPTS.signIn);
  });

  test("dismissing the service dialog reports the failure as a toast", async ({
    page,
  }) => {
    await mockGenerate(page, { status: 503, body: SERVICE_BODY });
    await page.goto("/");
    await waitForMsw(page);

    await page.getByRole(ROLE.button, { name: PROMPTS.signIn }).click();
    await expect(page.getByText(SERVICE.title)).toBeVisible();

    await page.getByRole(ROLE.button, { name: SERVICE.dismiss }).click();

    await expect(page.getByText(UI.generationFailed)).toBeVisible();
    await expect(page.getByText(SERVICE_BODY.error)).toBeVisible();
    await expect(page.getByText(SERVICE.title)).not.toBeVisible();
    expect(await readHistoryStorage(page)).toHaveLength(0);
  });

  test("an empty completion opens the service dialog and creates no history entry", async ({
    page,
  }) => {
    await mockGenerate(page, { lines: [] });
    await page.goto("/");
    await waitForMsw(page);

    await page.getByRole(ROLE.button, { name: PROMPTS.signIn }).click();

    await expect(page.getByText(SERVICE.title)).toBeVisible();
    expect(await readHistoryStorage(page)).toHaveLength(0);
  });

  test("a steer with no usable changes opens the service dialog and adds no revision", async ({
    page,
  }) => {
    await mockGenerate(page);
    await page.goto("/");
    await waitForMsw(page);

    await page.getByRole(ROLE.button, { name: PROMPTS.signIn }).click();
    await expect(page.getByText(UI.mockHeading)).toBeVisible();

    // The edit stream carries one truncated JSONL line — the fragment is
    // dropped, so the completion equals the request baseline spec.
    const truncatedLine = `{"op":"replace","path":"/elements/${MOCK_KEYS.heading}/props/text","value":"Cut`;
    await page.evaluate((line) => {
      (window as unknown as { __GENERATE_MOCK__?: object }).__GENERATE_MOCK__ =
        { editLines: [line] };
    }, truncatedLine);

    await page
      .getByPlaceholder(UI.promptPlaceholder)
      .fill(PROMPTS.customBilling);
    await page.getByRole(ROLE.button, { name: ACTIONS.steer }).click();

    await expect(page.getByText(SERVICE.title)).toBeVisible();

    const history = await readHistoryStorage(page);
    expect(history).toHaveLength(1);
    expect(history[0].head).toBe(0);
    expect(history[0].revisions).toHaveLength(1);

    await page.getByRole(ROLE.button, { name: SERVICE.dismiss }).click();
    await expect(page.getByText(UI.generationFailed)).toBeVisible();
    await expect(page.getByText(SERVICE.noChanges)).toBeVisible();
    expect((await readHistoryStorage(page))[0].revisions).toHaveLength(1);
  });
});
