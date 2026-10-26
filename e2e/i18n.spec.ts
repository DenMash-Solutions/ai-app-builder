import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  CONTENT_LANG,
  EDITOR,
  I18N,
  PATHS,
  PREVIEW,
  PROMPTS,
  ROLE,
  SLOTS,
} from "./constants";
import { mockGenerate, readHistoryStorage, waitForMsw } from "./helpers";
import {
  I18N_PTBR_EDIT_LINES,
  I18N_UI_LINES,
  NO_COPY_UI_LINES,
} from "./msw/fixture";

const langTrigger = (page: Page) =>
  page
    .getByRole(ROLE.button, { name: I18N.langTitle })
    .filter({ visible: true });

async function selectContentLang(page: Page, match: RegExp): Promise<void> {
  await langTrigger(page).click();
  const popover = page
    .locator('[data-slot="popover-content"]')
    .filter({ visible: true });
  // Row select buttons carry no aria-label (the per-language "Remove …"
  // actions do) — scope to them so a name regex can't match a remove action.
  await popover
    .locator("button:not([aria-label])")
    .filter({ visible: true })
    .filter({ hasText: match })
    .first()
    .click();
}

async function generateI18n(page: Page, editLines?: string[]): Promise<void> {
  await mockGenerate(page, { lines: I18N_UI_LINES, editLines });
  await page.goto(PATHS.ui);
  await waitForMsw(page);
  await page
    .getByRole(ROLE.button, { name: PROMPTS.signIn })
    .filter({ visible: true })
    .click();
  await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);
  await expect(
    page.getByText(I18N.seedTitle, { exact: true }).filter({ visible: true }),
  ).toBeVisible();
}

test.describe("content languages", () => {
  test("toggle merges the active language over the seed and survives reload", async ({
    page,
  }) => {
    await generateI18n(page);
    await expect(
      page.getByText(I18N.esTitle, { exact: true }).filter({ visible: true }),
    ).toHaveCount(0);

    // Switch to Spanish → the heading merges the overlay…
    await selectContentLang(page, /Spanish/);
    await expect(
      page.getByText(I18N.esTitle, { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    // …while the untranslated subtitle falls back to the seed.
    await expect(
      page
        .getByText(I18N.seedSubtitle, { exact: true })
        .filter({ visible: true }),
    ).toBeVisible();

    // The selection persists (global + per-entry) across a reload.
    await page.reload();
    await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);
    await expect(
      page.getByText(I18N.esTitle, { exact: true }).filter({ visible: true }),
    ).toBeVisible();
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

    // The rail's language trigger opens the spec popover; its "Add
    // language…" row opens the picker — a comprehensive language catalog
    // (rail = the control's single home: trigger → popover row → dialog).
    const popover = page
      .locator('[data-slot="popover-content"]')
      .filter({ visible: true });
    await langTrigger(page).click();
    await popover
      .getByRole(ROLE.button, { name: I18N.addLang })
      .filter({ visible: true })
      .click();
    const dialog = page.locator(SLOTS.dialog).filter({ visible: true });
    await expect(dialog).toBeVisible();
    const options = dialog.getByRole(ROLE.option).filter({ visible: true });
    expect(await options.count()).toBeGreaterThan(150);

    // A junk query shows the friendly hint — the dialog stays open and
    // nothing is steered.
    const filter = dialog
      .getByLabel(I18N.addDialog.filterLabel)
      .filter({ visible: true });
    await filter.fill("not a language!!");
    await expect(
      dialog.getByText(I18N.addDialog.noMatch).filter({ visible: true }),
    ).toBeVisible();
    await expect(dialog).toBeVisible();

    // Search matches the localized name (en UI → all three Portuguese rows)…
    await filter.fill("Portuguese");
    await expect(options).toHaveCount(3);

    // …and the tag narrows to the variant; picking it steers the model with
    // the canonical tag and the canvas switches to the new layer.
    await filter.fill("pt-br");
    await expect(options).toHaveCount(1);
    await dialog
      .getByRole(ROLE.option, { name: /pt-BR/ })
      .filter({ visible: true })
      .click();
    await expect(dialog).toBeHidden();
    // Feedback lands while the model works: the loading toast resolves to
    // the completion message once the layer commits (CLDR en name; ICU is
    // pinned by the Playwright version).
    await expect(
      page
        .getByText(I18N.addedLang("Brazilian Portuguese"), { exact: true })
        .filter({ visible: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText(I18N.ptTitle, { exact: true }).filter({ visible: true }),
    ).toBeVisible();

    // The design's own language switcher gained the option too — the mock
    // stream only lands the i18n layer, so this proves the deterministic
    // fix-up committed the button alongside the layer.
    const switcherPtBr = page
      .getByRole(ROLE.button, {
        name: I18N.switcher.ptBr,
        exact: true,
      })
      .filter({ visible: true });
    await expect(switcherPtBr).toBeVisible();

    // And it is the real switcher: a canvas click changes the content
    // language, with the rail trigger following what the canvas shows.
    const switcherEs = page
      .getByRole(ROLE.button, {
        name: I18N.switcher.es,
        exact: true,
      })
      .filter({ visible: true });
    await switcherEs.click();
    await expect(
      page.getByText(I18N.esTitle, { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    // The trigger follows the canvas (its tag renders CSS-uppercased — match
    // case-insensitively against either form).
    await expect(langTrigger(page)).toContainText(/es/i);
    await switcherPtBr.click();
    await expect(
      page.getByText(I18N.ptTitle, { exact: true }).filter({ visible: true }),
    ).toBeVisible();

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
    const removePtBr = popover
      .getByRole(ROLE.button, {
        name: I18N.removeLang("Brazilian Portuguese"),
      })
      .filter({ visible: true });
    await removePtBr.click();
    const confirmDialog = page.locator(SLOTS.dialog).filter({ visible: true });
    await expect(confirmDialog).toBeVisible();
    await confirmDialog
      .getByRole(ROLE.button, { name: I18N.removeConfirm.cancel })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByText(I18N.ptTitle, { exact: true }).filter({ visible: true }),
    ).toBeVisible();

    // Confirming drops the overlay layer — the canvas falls back to the seed
    // and the layer leaves the entry.
    await langTrigger(page).click();
    await removePtBr.click();
    await confirmDialog
      .getByRole(ROLE.button, { name: I18N.removeConfirm.confirm })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByText(I18N.seedTitle, { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    // The switcher no longer offers the removed language — neither on the
    // canvas nor in the committed spec.
    await expect(switcherPtBr).toHaveCount(0);
    const afterEntries = await readHistoryStorage(page);
    const afterState = afterEntries[0].spec.state as {
      copy: Record<string, string>;
      i18n?: Record<string, Record<string, string>>;
    };
    expect(afterState.i18n?.["pt-BR"]).toBeUndefined();
    expect(afterState.i18n?.es.title).toBe(I18N.esTitle);
    const afterElements = afterEntries[0].spec.elements as Record<
      string,
      { props?: { buttons?: Array<{ value: string }> } }
    >;
    expect(
      afterElements["lang-toggle"].props?.buttons?.map(
        (button) => button.value,
      ),
    ).toEqual(["es", "en"]);
  });

  test("the rail keeps Add language reachable on a spec without copy", async ({
    page,
  }) => {
    // normalizeSpecCopy lifts element text into state.copy at ingest, so a
    // spec without copy is one without a single lift-able string (the
    // text-free fixture). Before the rail move, the whole language UI (and
    // with it "Add language…") vanished on such specs — the pill was gated
    // on translatable copy. Rev 3: the trigger lives on the rail, ungated,
    // and shows the current tag.
    await mockGenerate(page, { lines: NO_COPY_UI_LINES });
    await page.goto(PATHS.ui);
    await waitForMsw(page);
    await page
      .getByRole(ROLE.button, { name: PROMPTS.signIn })
      .filter({ visible: true })
      .click();
    await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);

    // Exactly one language control, on the rail (the TopBar lost the pill):
    // it shows the current tag even though nothing is translatable.
    const trigger = page
      .getByRole(ROLE.button, { name: I18N.langTitle })
      .filter({ visible: true });
    await expect(trigger).toHaveCount(1);
    await expect(
      page
        .locator("[data-tool-rail]")
        .filter({ visible: true })
        .getByRole(ROLE.button, {
          name: I18N.langTitle,
        })
        .filter({ visible: true }),
    ).toHaveCount(1);
    await expect(trigger).toContainText(/en/i);

    // Its popover carries the Add row → the picker dialog opens.
    await trigger.click();
    const popover = page
      .locator('[data-slot="popover-content"]')
      .filter({ visible: true });
    await popover
      .getByRole(ROLE.button, { name: I18N.addLang })
      .filter({ visible: true })
      .click();
    await expect(
      page.locator(SLOTS.dialog).filter({ visible: true }),
    ).toBeVisible();
  });

  test("copy edits in a non-seed language write the i18n overlay, not the seed", async ({
    page,
  }) => {
    await generateI18n(page);
    await selectContentLang(page, /Spanish/);
    await expect(
      page.getByText(I18N.esTitle, { exact: true }).filter({ visible: true }),
    ).toBeVisible();

    // Pick the heading and edit its copy-bound text while Spanish is active.
    await page
      .getByRole(ROLE.button, { name: EDITOR.pick })
      .filter({ visible: true })
      .click();
    await page
      .getByText(I18N.esTitle, { exact: true })
      .filter({ visible: true })
      .click();
    const panel = page.locator("[data-editor-panel]").filter({ visible: true });
    await expect(panel).toBeVisible();
    const textField = panel
      .getByLabel("text", { exact: true })
      .filter({ visible: true });
    await textField.fill(I18N.edited);
    await textField.press("Enter");
    await expect(
      page.getByText(I18N.edited, { exact: true }).filter({ visible: true }),
    ).toBeVisible();

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
    await page
      .getByRole(ROLE.button, { name: PROMPTS.signIn })
      .filter({ visible: true })
      .click();
    await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);
    // "de" is not on the spec → clean fallback to the seed language.
    await expect(
      page.getByText(I18N.seedTitle, { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText(I18N.esTitle, { exact: true }).filter({ visible: true }),
    ).toHaveCount(0);
  });

  test("the design's switcher drives the preview by route, and content-only locales serve their own slug", async ({
    page,
  }) => {
    await generateI18n(page);

    // The read-only preview renders the spec's switcher against the route.
    // Anchor on a single trailing segment — /en/ui/{id} must not match.
    await page
      .getByRole(ROLE.link, { name: PREVIEW.open })
      .filter({ visible: true })
      .click();
    await expect(page).toHaveURL(/\/en\/[^/]+$/);
    await waitForMsw(page);
    await expect(
      page.getByText(I18N.seedTitle, { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    const slug = new URL(page.url()).pathname.split("/").pop()!;

    // Clicking ES navigates to the Spanish route — on this surface the URL
    // owns the language (decisions 5 and 11), so the whole page re-serves.
    // The first click races hydration (the SSR button exists before React
    // attaches its handlers) — retry click+navigation until the route moves.
    await expect(async () => {
      await page
        .getByRole(ROLE.button, { name: I18N.switcher.es, exact: true })
        .filter({ visible: true })
        .click();
      await expect(page).toHaveURL(new RegExp(`/es/${slug}$`));
    }).toPass({ timeout: 15_000 });
    await expect(
      page.getByText(I18N.esTitle, { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText(I18N.seedTitle, { exact: true }).filter({ visible: true }),
    ).toHaveCount(0);

    // …and back to English.
    await page
      .getByRole(ROLE.button, { name: I18N.switcher.en, exact: true })
      .filter({ visible: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/en/${slug}$`));
    await expect(
      page.getByText(I18N.seedTitle, { exact: true }).filter({ visible: true }),
    ).toBeVisible();

    // A content-only locale serves its own slug route: the fixture carries no
    // fr layer, so the seed renders under lang="fr"…
    const frPage = await page.goto(`/fr/${slug}`);
    expect(frPage?.status()).toBe(200);
    await waitForMsw(page);
    await expect(
      page.locator("html").filter({ visible: true }),
    ).toHaveAttribute("lang", "fr");
    await expect(
      page.getByText(I18N.seedTitle, { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    // …and the preview pill stays pointed at an app language.
    await expect(
      page
        .getByRole(ROLE.link, { name: PREVIEW.openPlayground })
        .filter({ visible: true }),
    ).toHaveAttribute("href", `/en/ui/${slug}`);

    // App surfaces remain app-locale only: /fr/ui is a 404.
    const appSurface = await page.goto("/fr/ui");
    expect(appSurface?.status()).toBe(404);
  });
});
