import { expect, test } from "@playwright/test";
import {
  ACTIONS,
  MOCK_KEYS,
  MODELS,
  PATHS,
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
    await page.goto(PATHS.ui);
    await waitForMsw(page);

    await page
      .getByRole(ROLE.button, { name: PROMPTS.signIn })
      .filter({ visible: true })
      .click();

    // Quota dialog replaces the old inline error alert.
    await expect(
      page.getByText(QUOTA.title).filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText(QUOTA.description).filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole(ROLE.button, { name: QUOTA.switchAndRetry })
        .filter({ visible: true }),
    ).toBeDisabled();

    // Switch to a higher-limit model, let the mock recover, then retry.
    await page
      .getByRole("menuitemradio", { name: new RegExp(MODELS.lite) })
      .filter({ visible: true })
      .click();
    await page.evaluate(() => {
      (window as unknown as { __GENERATE_MOCK__?: object }).__GENERATE_MOCK__ =
        {};
    });
    await page
      .getByRole(ROLE.button, { name: QUOTA.switchAndRetry })
      .filter({ visible: true })
      .click();

    await expect(
      page.getByText(UI.mockHeading).filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText(QUOTA.title).filter({ visible: true }),
    ).not.toBeVisible();
    expect(await generateCalls(page)).toBeGreaterThanOrEqual(2);

    const history = await readHistoryStorage(page);
    expect(history).toHaveLength(1);
    expect(history[0].prompt).toBe(PROMPTS.signIn);

    // The header pill reflects the switched model.
    await expect(
      page
        .getByRole(ROLE.button, { name: MODELS.liteShortLabel })
        .filter({ visible: true }),
    ).toBeVisible();
  });

  test("dismissing the quota dialog reports the failure as a toast", async ({
    page,
  }) => {
    await mockGenerate(page, { status: 429, body: RATE_LIMIT_BODY });
    await page.goto(PATHS.ui);
    await waitForMsw(page);

    await page
      .getByRole(ROLE.button, { name: PROMPTS.signIn })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByText(QUOTA.title).filter({ visible: true }),
    ).toBeVisible();

    await page
      .getByRole(ROLE.button, { name: QUOTA.dismiss })
      .filter({ visible: true })
      .click();

    await expect(
      page.getByText(UI.generationFailed).filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText(RATE_LIMIT_BODY.error).filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText(QUOTA.title).filter({ visible: true }),
    ).not.toBeVisible();
    expect(await readHistoryStorage(page)).toHaveLength(0);
  });

  test("the selected model persists across reloads", async ({ page }) => {
    await mockGenerate(page);
    await page.goto(PATHS.ui);
    await waitForMsw(page);

    await page
      .getByRole(ROLE.button, { name: MODELS.defaultShortLabel })
      .filter({ visible: true })
      .click();
    await page
      .getByRole("menuitemradio", { name: new RegExp(MODELS.lite) })
      .filter({ visible: true })
      .click();

    await page.reload();
    await waitForMsw(page);

    await expect(
      page
        .getByRole(ROLE.button, { name: MODELS.liteShortLabel })
        .filter({ visible: true }),
    ).toBeVisible();
  });

  test("service failure opens the model dialog and retries with the selected model", async ({
    page,
  }) => {
    await mockGenerate(page, { status: 503, body: SERVICE_BODY });
    await page.goto(PATHS.ui);
    await waitForMsw(page);

    await page
      .getByRole(ROLE.button, { name: PROMPTS.signIn })
      .filter({ visible: true })
      .click();

    await expect(
      page.getByText(SERVICE.title).filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText(SERVICE.description).filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole(ROLE.button, { name: SERVICE.switchAndRetry })
        .filter({ visible: true }),
    ).toBeDisabled();

    await page
      .getByRole("menuitemradio", { name: new RegExp(MODELS.lite) })
      .filter({ visible: true })
      .click();
    await page.evaluate(() => {
      (window as unknown as { __GENERATE_MOCK__?: object }).__GENERATE_MOCK__ =
        {};
    });
    await page
      .getByRole(ROLE.button, { name: SERVICE.switchAndRetry })
      .filter({ visible: true })
      .click();

    await expect(
      page.getByText(UI.mockHeading).filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText(SERVICE.title).filter({ visible: true }),
    ).not.toBeVisible();
    expect(await generateCalls(page)).toBeGreaterThanOrEqual(2);

    const history = await readHistoryStorage(page);
    expect(history).toHaveLength(1);
    expect(history[0].prompt).toBe(PROMPTS.signIn);
  });

  test("dismissing the service dialog reports the failure as a toast", async ({
    page,
  }) => {
    await mockGenerate(page, { status: 503, body: SERVICE_BODY });
    await page.goto(PATHS.ui);
    await waitForMsw(page);

    await page
      .getByRole(ROLE.button, { name: PROMPTS.signIn })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByText(SERVICE.title).filter({ visible: true }),
    ).toBeVisible();

    await page
      .getByRole(ROLE.button, { name: SERVICE.dismiss })
      .filter({ visible: true })
      .click();

    await expect(
      page.getByText(UI.generationFailed).filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText(SERVICE_BODY.error).filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText(SERVICE.title).filter({ visible: true }),
    ).not.toBeVisible();
    expect(await readHistoryStorage(page)).toHaveLength(0);
  });

  test("an empty completion opens the service dialog and creates no history entry", async ({
    page,
  }) => {
    await mockGenerate(page, { lines: [] });
    await page.goto(PATHS.ui);
    await waitForMsw(page);

    await page
      .getByRole(ROLE.button, { name: PROMPTS.signIn })
      .filter({ visible: true })
      .click();

    await expect(
      page.getByText(SERVICE.title).filter({ visible: true }),
    ).toBeVisible();
    expect(await readHistoryStorage(page)).toHaveLength(0);
  });

  test("a steer with no usable changes opens the service dialog and adds no revision", async ({
    page,
  }) => {
    await mockGenerate(page);
    await page.goto(PATHS.ui);
    await waitForMsw(page);

    await page
      .getByRole(ROLE.button, { name: PROMPTS.signIn })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByText(UI.mockHeading).filter({ visible: true }),
    ).toBeVisible();
    // Steer only exists on /ui/[id] — wait for the post-generate redirect,
    // or the prompt bar on the landing would start a fresh generation
    await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);

    // The edit stream carries one truncated JSONL line — the fragment is
    // dropped, so the completion equals the request baseline spec.
    const truncatedLine = `{"op":"replace","path":"/elements/${MOCK_KEYS.heading}/props/text","value":"Cut`;
    await page.evaluate((line) => {
      (window as unknown as { __GENERATE_MOCK__?: object }).__GENERATE_MOCK__ =
        { editLines: [line] };
    }, truncatedLine);

    await page
      .getByPlaceholder(UI.promptPlaceholder)
      .filter({ visible: true })
      .fill(PROMPTS.customBilling);
    await page
      .getByRole(ROLE.button, { name: ACTIONS.steer })
      .filter({ visible: true })
      .click();

    await expect(
      page.getByText(SERVICE.title).filter({ visible: true }),
    ).toBeVisible();

    const history = await readHistoryStorage(page);
    expect(history).toHaveLength(1);
    expect(history[0].head).toBe(0);
    expect(history[0].revisions).toHaveLength(1);

    await page
      .getByRole(ROLE.button, { name: SERVICE.dismiss })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByText(UI.generationFailed).filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText(SERVICE.noChanges).filter({ visible: true }),
    ).toBeVisible();
    expect((await readHistoryStorage(page))[0].revisions).toHaveLength(1);
  });
});
