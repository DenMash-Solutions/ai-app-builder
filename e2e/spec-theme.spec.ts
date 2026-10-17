import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { PATHS, PREVIEW, PROMPTS, ROLE, SPEC_THEME } from "./constants";
import { mockGenerate, waitForMsw } from "./helpers";
import { THEME_UI_LINES } from "./msw/fixture";

/**
 * Spec-driven theme (docs/plan/tool-rail-and-spec-theme): the design carries
 * its theme (`state.theme`) and toggles it with the ThemeSwitcher. The
 * canvas scopes `dark` to the design (app chrome keeps its own theme);
 * chrome-less routes (preview, public serving) theme the page itself, and
 * only PUBLIC serving persists the visitor's decision — which then beats
 * the spec default on return.
 */

const DARK_CLASS = /(^|\s)dark(\s|$)/;

const specToggle = (page: Page, label: string) =>
  page.getByRole(ROLE.button, { name: label });

const storedDecision = (page: Page) =>
  page.evaluate((key) => localStorage.getItem(key), SPEC_THEME.storageKey);

async function generateTheme(page: Page): Promise<void> {
  await mockGenerate(page, { lines: THEME_UI_LINES });
  await page.goto(PATHS.ui);
  await waitForMsw(page);
  await page.getByRole(ROLE.button, { name: PROMPTS.signIn }).click();
  await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole(ROLE.heading, { name: SPEC_THEME.heading }),
  ).toBeVisible();
}

test.describe("spec-driven theme — author surfaces", () => {
  test("the canvas scopes dark to the design; the runtime flip is session view state", async ({
    page,
  }) => {
    await generateTheme(page);
    // Scope to the canvas surface — the app chrome's own theme toggle has
    // the same accessible name and lives under the same [data-canvas] root.
    const canvasToggle = page
      .locator("[data-canvas-surface]")
      .getByRole(ROLE.button, { name: SPEC_THEME.toggleToDark });
    const canvasDark = () =>
      page.evaluate(
        () => document.querySelector("[data-canvas-surface].dark") !== null,
      );

    expect(await canvasDark()).toBe(false);
    await canvasToggle.click();
    await expect(async () => {
      expect(await canvasDark()).toBe(true);
    }).toPass();
    // The app chrome keeps its own theme — only the design subtree flips.
    await expect(page.locator("html")).not.toHaveClass(DARK_CLASS);

    // The spec's default owns persistence: the flip is view state, and the
    // chrome decision key is never written on author surfaces.
    await page.reload();
    await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);
    await expect(
      page.getByRole(ROLE.heading, { name: SPEC_THEME.heading }),
    ).toBeVisible();
    expect(await canvasDark()).toBe(false);
    expect(await storedDecision(page)).toBeNull();
  });

  test("the local preview themes the page and never touches the visitor decision", async ({
    page,
  }) => {
    await generateTheme(page);
    // The /ui/[ref] URL carries the id — follow the app's own preview link
    // to reach the slug route.
    await page.getByRole(ROLE.link, { name: PREVIEW.open }).click();
    await expect(page).toHaveURL(/\/en\/[^/]+$/);
    await waitForMsw(page);
    await expect(
      page.getByRole(ROLE.heading, { name: SPEC_THEME.heading }),
    ).toBeVisible();

    // The preview is chrome-less — the design's theme owns the page.
    await page
      .locator("main")
      .getByRole(ROLE.button, { name: SPEC_THEME.toggleToDark })
      .click();
    await expect(async () => {
      await expect(page.locator("html")).toHaveClass(DARK_CLASS);
    }).toPass();
    // Owner toggle = session view state; the decision key stays untouched.
    expect(await storedDecision(page)).toBeNull();
  });
});

test.describe("spec-driven theme — public route", () => {
  test("a fresh visitor gets the spec default pre-paint; their toggle persists and beats it on return", async ({
    page,
  }) => {
    // The seeded published page (db.ts) carries a DARK default — served to
    // anonymous visitors, no local entry in sight.
    await page.goto(`/en/${SPEC_THEME.slug}`);
    await expect(
      page.getByRole(ROLE.heading, { name: SPEC_THEME.heading }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveClass(DARK_CLASS);

    // The switcher shows where the click lands: dark → press goes light.
    await specToggle(page, SPEC_THEME.toggleToLight).click();
    await expect(page.locator("html")).not.toHaveClass(DARK_CLASS);
    expect(await storedDecision(page)).toBe("light");

    // Returning with the stored decision: light beats the spec's dark
    // default (ThemeInit applies it pre-paint; the spec script stands down).
    await page.reload();
    await expect(page.locator("html")).not.toHaveClass(DARK_CLASS);
    await expect(
      page.getByRole(ROLE.heading, { name: SPEC_THEME.heading }),
    ).toBeVisible();
  });
});
