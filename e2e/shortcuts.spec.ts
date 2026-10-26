import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { EDITOR, PATHS, PROMPTS, ROLE, STATE_MOCK, UI } from "./constants";
import { mockGenerate, readHistoryStorage, waitForMsw } from "./helpers";
import { STATEFUL_UI_LINES } from "./msw/fixture";

async function generate(page: Page): Promise<void> {
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
  // Post-generation remount: wait for the route or later keystrokes hit the
  // pre-redirect instance and are lost.
  await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);
}

async function generateStateful(page: Page): Promise<void> {
  await mockGenerate(page, { lines: STATEFUL_UI_LINES });
  await page.goto(PATHS.ui);
  await waitForMsw(page);
  await page
    .getByRole(ROLE.button, { name: PROMPTS.signIn })
    .filter({ visible: true })
    .click();
  await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);
}

test.describe("canvas editing shortcuts", () => {
  test("double-click opens the editor and enables pick", async ({ page }) => {
    await generate(page);

    const pick = page
      .getByRole(ROLE.button, { name: EDITOR.pick })
      .filter({ visible: true });
    await expect(pick).toHaveAttribute("aria-pressed", "false");

    await page.getByText(UI.mockHeading).filter({ visible: true }).dblclick();

    const panel = page.locator("[data-editor-panel]").filter({ visible: true });
    await expect(panel).toBeVisible();
    await expect(
      panel.getByText("Heading", { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    await expect(pick).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.locator("[data-jr-selected]").filter({ visible: true }),
    ).toHaveCount(1);
  });

  test("double-click selects the exact repeat instance", async ({ page }) => {
    await generateStateful(page);

    await page
      .getByText("Item C", { exact: true })
      .filter({ visible: true })
      .dblclick();

    const panel = page.locator("[data-editor-panel]").filter({ visible: true });
    await expect(panel).toBeVisible();
    const count = STATE_MOCK.itemLabels.length;
    await expect(
      panel.getByTestId("instance-scope").filter({ visible: true }),
    ).toHaveText(EDITOR.instanceScope(3, count, "/items/2"));
    const selected = page
      .locator("[data-jr-selected]")
      .filter({ visible: true });
    await expect(selected).toHaveCount(1);
    await expect(selected).toContainText("Item C");
  });

  test("P/X/G toggle tool modes; letters inside inputs never toggle", async ({
    page,
  }) => {
    await generate(page);
    const pick = page
      .getByRole(ROLE.button, { name: EDITOR.pick })
      .filter({ visible: true });
    const dnd = page
      .getByRole(ROLE.button, { name: EDITOR.dragdrop })
      .filter({ visible: true });
    const xray = page
      .getByRole(ROLE.button, { name: EDITOR.xray })
      .filter({ visible: true });

    await page.keyboard.press("p");
    await expect(pick).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("p");
    await expect(pick).toHaveAttribute("aria-pressed", "false");

    await page.keyboard.press("x");
    await expect(xray).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.locator("[data-xray-dot]").filter({ visible: true }).first(),
    ).toBeVisible();
    await page.keyboard.press("x");
    await expect(xray).toHaveAttribute("aria-pressed", "false");

    await page.keyboard.press("g");
    await expect(dnd).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".jr-dnd").filter({ visible: true })).toHaveCount(
      1,
    );
    await page.keyboard.press("g");
    await expect(dnd).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".jr-dnd").filter({ visible: true })).toHaveCount(
      0,
    );

    // Typing the shortcut letters inside the prompt input must not toggle
    const promptInput = page
      .getByPlaceholder(UI.promptPlaceholder)
      .filter({ visible: true });
    await promptInput.click();
    await promptInput.pressSequentially("pxg");
    await expect(pick).toHaveAttribute("aria-pressed", "false");
    await expect(xray).toHaveAttribute("aria-pressed", "false");
    await expect(dnd).toHaveAttribute("aria-pressed", "false");
  });

  test("Delete removes the selection and Cmd+Z restores it", async ({
    page,
  }) => {
    await generate(page);

    await page.getByText(UI.mockHeading).filter({ visible: true }).dblclick();
    await expect(
      page.locator("[data-editor-panel]").filter({ visible: true }),
    ).toBeVisible();

    await page.keyboard.press("Delete");
    await expect(
      page.getByText(UI.mockHeading).filter({ visible: true }),
    ).toHaveCount(0);
    let entries = await readHistoryStorage(page);
    expect(entries[0].revisions).toHaveLength(2);
    expect(entries[0].head).toBe(1);

    await page.keyboard.press("ControlOrMeta+z");
    await expect(
      page.getByText(UI.mockHeading).filter({ visible: true }),
    ).toBeVisible();
    entries = await readHistoryStorage(page);
    expect(entries[0].head).toBe(0);
  });

  test("Cmd+D duplicates and Alt+arrows move the selected sibling", async ({
    page,
  }) => {
    await generate(page);

    await page.getByText(UI.mockHeading).filter({ visible: true }).dblclick();
    await expect(
      page.locator("[data-editor-panel]").filter({ visible: true }),
    ).toBeVisible();

    await page.keyboard.press("ControlOrMeta+d");
    await expect(
      page.getByText(UI.mockHeading).filter({ visible: true }),
    ).toHaveCount(2);
    let entries = await readHistoryStorage(page);
    expect(
      entries[0].revisions?.[1]?.spec.elements["card-1"]?.children,
    ).toEqual(["heading-1", "heading-2", "text-1"]);

    // The clone (heading-2, last child) stays selected — move it up a sibling
    await page.keyboard.press("Alt+ArrowUp");
    entries = await readHistoryStorage(page);
    expect(
      entries[0].revisions?.[2]?.spec.elements["card-1"]?.children,
    ).toEqual(["heading-2", "heading-1", "text-1"]);
  });

  test("Escape cascades: panel closes first, then pick turns off", async ({
    page,
  }) => {
    await generate(page);
    const pick = page
      .getByRole(ROLE.button, { name: EDITOR.pick })
      .filter({ visible: true });

    await page.getByText(UI.mockHeading).filter({ visible: true }).dblclick();
    await expect(
      page.locator("[data-editor-panel]").filter({ visible: true }),
    ).toBeVisible();
    await expect(pick).toHaveAttribute("aria-pressed", "true");

    // First Escape belongs to the panel (its own listener) — pick stays armed
    await page.keyboard.press("Escape");
    await expect(
      page.locator("[data-editor-panel]").filter({ visible: true }),
    ).toHaveCount(0);
    await expect(pick).toHaveAttribute("aria-pressed", "true");

    // Second Escape turns pick off
    await page.keyboard.press("Escape");
    await expect(pick).toHaveAttribute("aria-pressed", "false");
  });
});
