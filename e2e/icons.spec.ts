import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { EDITOR, PATHS, PREVIEW, PROMPTS, ROLE, UI } from "./constants";
import { mockGenerate, waitForMsw } from "./helpers";
import {
  FILTER_UI_LINES,
  ICON_UI_LINES,
  PAGINATED_UI_LINES,
} from "./msw/fixture";

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
    // The repeat sits on the GRID container, so the grid has one child per
    // item — the grouping bug (repeat on the cell) would show a single child
    // holding every row. Count each cell's label paragraph: on the canvas
    // the renderer wraps repeated children in transparent editor keys
    // (span[data-jr-key]), on the preview they are plain divs — the label
    // <p> is identical on both surfaces.
    const grid = canvas.locator("div.grid").first();
    await expect(grid.locator("p")).toHaveCount(10);

    // Typing fires Input change → setState($computed filterItems) → the
    // repeat narrows to the single match.
    const input = canvas.locator('[data-slot="input"]');
    await expect(input).toHaveValue("");
    await input.fill("star");
    await expect(input).toHaveValue("star");
    await expect(cells).toHaveCount(1);
    await expect(grid.locator("p")).toHaveCount(1);
    await expect(canvas.locator("svg.lucide-star")).toBeVisible();

    // Clearing the field: an empty query returns the full source array.
    await input.fill("");
    await expect(cells).toHaveCount(10);
    await expect(grid.locator("p")).toHaveCount(10);
  });

  test("pagination stays bounded and labels the true position", async ({
    page,
  }) => {
    await generate(page, PAGINATED_UI_LINES);

    const canvas = page.locator("[data-canvas]");
    const grid = canvas.locator("div.grid").first();
    const label = canvas.getByText(/^Page \d+ of \d+$/);
    const prev = canvas.getByRole(ROLE.button, { name: "Previous" });
    const next = canvas.getByRole(ROLE.button, { name: "Next" });

    // Seeded first page: 1-based label with the true total (3 pages over 11
    // items), 5 grid children, Previous hidden at the start (element-level
    // visible: page > 0).
    await expect(label).toHaveText("Page 1 of 3");
    await expect(grid.locator("p")).toHaveCount(5);
    await expect(prev).toHaveCount(0);

    await next.click();
    await expect(label).toHaveText("Page 2 of 3");
    await expect(grid.locator("p")).toHaveCount(5);
    await expect(prev).toBeVisible();

    await next.click();
    await expect(label).toHaveText("Page 3 of 3");
    await expect(grid.locator("p")).toHaveCount(1);

    // Next past the end: stepPage clamps the write — the page state itself
    // can never pass the last page (the "Page 3 of 2" bug).
    await next.click();
    await expect(label).toHaveText("Page 3 of 3");
    await expect(grid.locator("p")).toHaveCount(1);

    // Previous walks back down; at the start the label reads page 1 and the
    // button hides again.
    await prev.click();
    await expect(label).toHaveText("Page 2 of 3");
    await prev.click();
    await expect(label).toHaveText("Page 1 of 3");
    await expect(prev).toHaveCount(0);
    await expect(grid.locator("p")).toHaveCount(5);

    // The read-only preview renders the same bounded behavior (one shared
    // renderer + function registry across surfaces). Assert the cells first
    // (proves the spec rendered), then the label — the preview route can be
    // cold-compiled on first hit.
    await page.getByRole(ROLE.link, { name: PREVIEW.open }).click();
    await expect(page).toHaveURL(/\/en\/[^/]+$/);
    await waitForMsw(page);
    const main = page.locator("main");
    await expect(main.locator("div.grid").first().locator("p")).toHaveCount(5);
    await expect(main.getByText(/^Page \d+ of \d+$/)).toHaveText(
      "Page 1 of 3",
      { timeout: 15000 },
    );
  });

  test("the preview slug syncs its page with the URL (052 D9, preview surface)", async ({
    page,
  }) => {
    await generate(page, PAGINATED_UI_LINES);

    // Open the read-only preview (the share surface).
    await page.getByRole(ROLE.link, { name: PREVIEW.open }).click();
    await expect(page).toHaveURL(/\/en\/[^/]+$/);
    await waitForMsw(page);
    const main = page.locator("main");
    const label = main.getByText(/^Page \d+ of \d+$/);
    const next = main.getByRole(ROLE.button, { name: "Next" });
    await expect(label).toHaveText("Page 1 of 3", { timeout: 15000 });

    // Shareable OUT: stepping on the slug route rewrites the URL in place
    // (replaceState — no navigation), 1-based like the canvas.
    await next.click();
    await expect(label).toHaveText("Page 2 of 3");
    await expect(page).toHaveURL(/\?page=2/);

    // Deep-link IN: a fresh load at ?page=2 seeds the overlayed page — the
    // label reads page 2 with no interaction (the list rows follow the
    // spec's own seeded-slice pattern; the surface contract is label+URL).
    await page.reload();
    await waitForMsw(page);
    await expect(
      page.locator("main").getByText(/^Page \d+ of \d+$/),
    ).toHaveText("Page 2 of 3", { timeout: 15000 });
  });

  test("a generated grid scales from phone to desktop viewports", async ({
    page,
  }) => {
    await generate(page, FILTER_UI_LINES);

    const trackCount = () =>
      page.evaluate(() => {
        const el = document.querySelector("[data-canvas] div.grid");
        if (!el) return -1;
        return getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/)
          .length;
      });

    // Desktop: `columns: 5` is the desktop target — five tracks.
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect.poll(trackCount).toBe(5);

    // Phone: the responsive ladder (grid-cols-1 sm:grid-cols-2 lg:grid-cols-5)
    // collapses to a single full-width column.
    await page.setViewportSize({ width: 375, height: 812 });
    await expect.poll(trackCount).toBe(1);
  });
});
