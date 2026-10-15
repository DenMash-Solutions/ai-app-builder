import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  CONTENT_LANG,
  EDITOR,
  I18N,
  PATHS,
  PROMPTS,
  ROLE,
  SLOTS,
} from "./constants";
import { mockGenerate, readHistoryStorage, waitForMsw } from "./helpers";
import { I18N_PTBR_EDIT_LINES, I18N_UI_LINES } from "./msw/fixture";

const langTrigger = (page: Page) =>
  page.getByRole(ROLE.button, { name: I18N.langTitle });

async function selectContentLang(page: Page, match: RegExp): Promise<void> {
  await langTrigger(page).click();
  const popover = page.locator('[data-slot="popover-content"]');
  // Row select buttons carry no aria-label (the per-language "Remove …"
  // actions do) — scope to them so a name regex can't match a remove action.
  await popover
    .locator("button:not([aria-label])")
    .filter({ hasText: match })
    .first()
    .click();
}

async function generateI18n(page: Page, editLines?: string[]): Promise<void> {
  await mockGenerate(page, { lines: I18N_UI_LINES, editLines });
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

  test("Add language… is a searchable picker that steers the model with the picked tag", async ({
    page,
  }) => {
    await generateI18n(page, I18N_PTBR_EDIT_LINES);

    // The action opens the picker — a comprehensive language catalog.
    await langTrigger(page).click();
    const popover = page.locator('[data-slot="popover-content"]');
    await popover.getByRole(ROLE.button, { name: I18N.addLang }).click();
    const dialog = page.locator(SLOTS.dialog);
    await expect(dialog).toBeVisible();
    const options = dialog.getByRole(ROLE.option);
    expect(await options.count()).toBeGreaterThan(150);

    // A junk query shows the friendly hint — the dialog stays open and
    // nothing is steered.
    const filter = dialog.getByLabel(I18N.addDialog.filterLabel);
    await filter.fill("not a language!!");
    await expect(dialog.getByText(I18N.addDialog.noMatch)).toBeVisible();
    await expect(dialog).toBeVisible();

    // Search matches the localized name (en UI → all three Portuguese rows)…
    await filter.fill("Portuguese");
    await expect(options).toHaveCount(3);

    // …and the tag narrows to the variant; picking it steers the model with
    // the canonical tag and the canvas switches to the new layer.
    await filter.fill("pt-br");
    await expect(options).toHaveCount(1);
    await dialog.getByRole(ROLE.option, { name: /pt-BR/ }).click();
    await expect(dialog).toBeHidden();
    // Feedback lands while the model works: the loading toast resolves to
    // the completion message once the layer commits (CLDR en name; ICU is
    // pinned by the Playwright version).
    await expect(
      page.getByText(I18N.addedLang("Brazilian Portuguese"), { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(I18N.ptTitle, { exact: true })).toBeVisible();

    // The write landed under the canonical tag; seed copy stays intact.
    const entries = await readHistoryStorage(page);
    const state = entries[0].spec.state as {
      copy: Record<string, string>;
      i18n: Record<string, Record<string, string>>;
    };
    expect(state.copy.title).toBe(I18N.seedTitle);
    expect(state.i18n["pt-BR"].title).toBe(I18N.ptTitle);

    // Removal asks for confirmation — cancelling keeps the language intact.
    await langTrigger(page).click();
    // "Brazilian Portuguese" is CLDR's en name for pt-BR (Chromium's ICU is
    // pinned by the Playwright version, so the string stays deterministic).
    const removePtBr = popover.getByRole(ROLE.button, {
      name: I18N.removeLang("Brazilian Portuguese"),
    });
    await removePtBr.click();
    const confirmDialog = page.locator(SLOTS.dialog);
    await expect(confirmDialog).toBeVisible();
    await confirmDialog
      .getByRole(ROLE.button, { name: I18N.removeConfirm.cancel })
      .click();
    await expect(page.getByText(I18N.ptTitle, { exact: true })).toBeVisible();

    // Confirming drops the overlay layer — the canvas falls back to the seed
    // and the layer leaves the entry.
    await langTrigger(page).click();
    await removePtBr.click();
    await confirmDialog
      .getByRole(ROLE.button, { name: I18N.removeConfirm.confirm })
      .click();
    await expect(page.getByText(I18N.seedTitle, { exact: true })).toBeVisible();
    const afterEntries = await readHistoryStorage(page);
    const afterState = afterEntries[0].spec.state as {
      copy: Record<string, string>;
      i18n?: Record<string, Record<string, string>>;
    };
    expect(afterState.i18n?.["pt-BR"]).toBeUndefined();
    expect(afterState.i18n?.es.title).toBe(I18N.esTitle);
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
