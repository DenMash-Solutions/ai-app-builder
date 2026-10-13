import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { CONTENT_LANG, EDITOR, I18N, PATHS, PROMPTS, ROLE } from "./constants";
import { mockGenerate, readHistoryStorage, waitForMsw } from "./helpers";
import { I18N_UI_LINES } from "./msw/fixture";

const langTrigger = (page: Page) =>
  page.getByRole(ROLE.button, { name: I18N.langTitle });

async function selectContentLang(page: Page, match: RegExp): Promise<void> {
  await langTrigger(page).click();
  const popover = page.locator('[data-slot="popover-content"]');
  await popover.getByRole(ROLE.button, { name: match }).click();
}

async function generateI18n(page: Page): Promise<void> {
  await mockGenerate(page, { lines: I18N_UI_LINES });
  await page.goto(PATHS.ui);
  await waitForMsw(page);
  await page.getByRole(ROLE.button, { name: PROMPTS.signIn }).click();
  await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);
  await expect(page.getByText(I18N.seedTitle, { exact: true })).toBeVisible();
}

test.describe("content languages", () => {
  test("toggle merges the active language over the seed and survives reload", async ({
    page,
  }) => {
    await generateI18n(page);
    await expect(page.getByText(I18N.esTitle, { exact: true })).toHaveCount(0);

    // Switch to Spanish → the heading merges the overlay…
    await selectContentLang(page, /Spanish/);
    await expect(page.getByText(I18N.esTitle, { exact: true })).toBeVisible();
    // …while the untranslated subtitle falls back to the seed.
    await expect(
      page.getByText(I18N.seedSubtitle, { exact: true }),
    ).toBeVisible();

    // The selection persists (global + per-entry) across a reload.
    await page.reload();
    await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);
    await expect(page.getByText(I18N.esTitle, { exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        (key) => localStorage.getItem(key),
        CONTENT_LANG.global,
      ),
    ).toBe("es");
  });

  test("copy edits in a non-seed language write the i18n overlay, not the seed", async ({
    page,
  }) => {
    await generateI18n(page);
    await selectContentLang(page, /Spanish/);
    await expect(page.getByText(I18N.esTitle, { exact: true })).toBeVisible();

    // Pick the heading and edit its copy-bound text while Spanish is active.
    await page.getByRole(ROLE.button, { name: EDITOR.pick }).click();
    await page.getByText(I18N.esTitle, { exact: true }).click();
    const panel = page.locator("[data-editor-panel]");
    await expect(panel).toBeVisible();
    const textField = panel.getByLabel("text", { exact: true });
    await textField.fill(I18N.edited);
    await textField.press("Enter");
    await expect(page.getByText(I18N.edited, { exact: true })).toBeVisible();

    // The write redirects to the es overlay; the seed copy stays intact.
    const entries = await readHistoryStorage(page);
    const state = entries[0].spec.state as {
      copy: Record<string, string>;
      i18n: Record<string, Record<string, string>>;
    };
    expect(state.copy.title).toBe(I18N.seedTitle);
    expect(state.i18n.es.title).toBe(I18N.edited);
  });

  test("a stale stored language falls back to the seed", async ({ page }) => {
    await mockGenerate(page, { lines: I18N_UI_LINES });
    await page.addInitScript(
      (key) => localStorage.setItem(key, "de"),
      CONTENT_LANG.global,
    );
    await page.goto(PATHS.ui);
    await waitForMsw(page);
    await page.getByRole(ROLE.button, { name: PROMPTS.signIn }).click();
    await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);
    // "de" is not on the spec → clean fallback to the seed language.
    await expect(page.getByText(I18N.seedTitle, { exact: true })).toBeVisible();
    await expect(page.getByText(I18N.esTitle, { exact: true })).toHaveCount(0);
  });
});
