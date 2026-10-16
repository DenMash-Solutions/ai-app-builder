import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { EDITOR, PATHS, PREVIEW, PROMPTS, ROLE, UI } from "./constants";
import { mockGenerate, waitForMsw } from "./helpers";
import { FILTER_UI_LINES, ICON_UI_LINES } from "./msw/fixture";

async function generate(page: Page, lines?: string[]): Promise<void> {
  await mockGenerate(page, lines ? { lines } : undefined);
  await page.goto(PATHS.ui);
  await waitForMsw(page);
  await page.getByRole(ROLE.button, { name: PROMPTS.signIn }).click();
  await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);
}

test.describe("catalog icons", () => {
  test("a generated icon draws on the canvas and survives the read-only preview", async ({
    page,
  }) => {
    await generate(page, ICON_UI_LINES);

    // The spec's Icon renders as a Lucide SVG at the requested size. Scope
    // to the canvas — the app chrome's own Sparkles logo shares the class.
    const icon = page.locator("[data-canvas] svg.lucide-sparkles");
    await expect(icon).toBeVisible();
    await expect(icon).toHaveAttribute("width", "24");

    // D5: the Button's icon props draw icons around the label (single
    // renderer override — click exercises it without a bound action).
    const iconButton = page.locator(
      "[data-canvas] button:has(svg.lucide-arrow-left)",
    );
    await expect(iconButton).toBeVisible();
    await expect(iconButton.locator("svg.lucide-arrow-right")).toBeVisible();
    await expect(iconButton).toContainText("Next");
    await iconButton.click();

    // The read-only preview serves the same spec from its slug.
    await page.getByRole(ROLE.link, { name: PREVIEW.open }).click();
    await expect(page).toHaveURL(/\/en\/[^/]+$/);
    await waitForMsw(page);
    await expect(page.locator("main svg.lucide-sparkles")).toBeVisible();
    await expect(
      page.locator("main button:has(svg.lucide-arrow-left)"),
    ).toBeVisible();
  });

  test("the insert picker offers Icon and the name enum drives what draws", async ({
    page,
  }) => {
    await generate(page);
    await expect(page.getByText(UI.mockHeading)).toBeVisible();

    // Open the editor panel on the heading (existing pattern from editor.spec).
    await page.getByRole(ROLE.button, { name: EDITOR.pick }).click();
    await page.getByText(UI.mockHeading).click();
    const panel = page.locator("[data-editor-panel]");
    await expect(panel).toBeVisible();

    // Structure tab → Insert → the picker lists the catalog's Icon leaf.
    await panel.getByRole(ROLE.tab, { name: EDITOR.structure }).click();
    await panel.getByRole(ROLE.button, { name: EDITOR.insert }).click();
    const picker = page.locator("[data-component-picker]");
    await picker.getByPlaceholder(EDITOR.pickerSearch).fill("Icon");
    await picker
      .getByRole(ROLE.option)
      .filter({ hasText: /^Icon\b/ })
      .first()
      .click();

    // A fresh insert uses the definition's example → sparkles draws (scoped
    // to the canvas — the chrome logo is a Sparkles icon too).
    const canvasIcon = page.locator("[data-canvas] svg.lucide-sparkles");
    await expect(canvasIcon).toBeVisible();

    // Select it: the `name` property is an enum Select over the curated set
    // (derived from the same map as the renderer), so picking another name
    // redraws the other icon.
    await page.getByRole(ROLE.button, { name: EDITOR.pick }).click();
    await page.getByRole(ROLE.button, { name: EDITOR.pick }).click();
    await canvasIcon.click();
    await expect(panel.getByText("Icon", { exact: true })).toBeVisible();
    // The panel persists its tab across selection changes — we were on
    // Structure (tree row also reads "Icon"), so switch explicitly.
    await panel.getByRole(ROLE.tab, { name: EDITOR.properties }).click();
    await panel.getByRole(ROLE.combobox, { name: "name" }).click();
    await page
      .getByRole(ROLE.option, { name: "arrow-right", exact: true })
      .click();
    await expect(
      page.locator("[data-canvas] svg.lucide-arrow-right"),
    ).toBeVisible();
    await expect(canvasIcon).toHaveCount(0);
  });

  test("a search input filters the repeated list live through filterItems", async ({
    page,
  }) => {
    await generate(page, FILTER_UI_LINES);

    const canvas = page.locator("[data-canvas]");
    // Every seeded item renders before any keystroke — state holds two raw
    // arrays, and the repeat reads /filtered-icons directly.
    const cells = canvas.getByText(
      /^(house|user|settings|search|mail|bell|star|heart|trash-2|pencil)$/,
    );
    await expect(cells).toHaveCount(10);

    // Typing fires Input change → setState($computed filterItems) → the
    // repeat narrows to the single match.
    const input = canvas.locator('[data-slot="input"]');
    await expect(input).toHaveValue("");
    await input.fill("star");
    await expect(input).toHaveValue("star");
    await expect(cells).toHaveCount(1);
    await expect(canvas.locator("svg.lucide-star")).toBeVisible();

    // Clearing the field: an empty query returns the full source array.
    await input.fill("");
    await expect(cells).toHaveCount(10);
  });
});
