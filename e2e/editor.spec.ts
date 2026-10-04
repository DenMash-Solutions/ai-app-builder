import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { EDITOR, PROMPTS, ROLE, UI, historyButtonName } from "./constants";
import { mockGenerate, readHistoryStorage, waitForMsw } from "./helpers";

async function generateSample(page: Page): Promise<void> {
  await mockGenerate(page);
  await page.goto("/");
  await waitForMsw(page);
  await page.getByRole(ROLE.button, { name: PROMPTS.signIn }).click();
  await expect(page.getByText(UI.mockHeading)).toBeVisible();
}

async function pickHeading(page: Page) {
  await page.getByRole(ROLE.button, { name: EDITOR.pick }).click();
  await page.getByText(UI.mockHeading).click();
  const panel = page.locator("[data-editor-panel]");
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Heading", { exact: true })).toBeVisible();
  return panel;
}

test.describe("editor", () => {
  test("pick mode selects an element and property edits are undoable/redoable", async ({
    page,
  }) => {
    await generateSample(page);
    const panel = await pickHeading(page);

    // Level change is a local patch — no API call
    await panel.getByLabel("level").selectOption("h2");
    await expect(
      page.locator("h2").filter({ hasText: UI.mockHeading }),
    ).toBeVisible();

    let entries = await readHistoryStorage(page);
    expect(entries[0].revisions).toHaveLength(2);
    expect(entries[0].head).toBe(1);

    await panel.getByRole(ROLE.button, { name: EDITOR.undo }).click();
    await expect(
      page.locator("h1").filter({ hasText: UI.mockHeading }),
    ).toBeVisible();

    await panel.getByRole(ROLE.button, { name: EDITOR.redo }).click();
    await expect(
      page.locator("h2").filter({ hasText: UI.mockHeading }),
    ).toBeVisible();

    entries = await readHistoryStorage(page);
    expect(entries[0].head).toBe(1);
    expect(entries[0].revisions).toHaveLength(2);
  });

  test("freeform action streams a patch and revisions survive a reload", async ({
    page,
  }) => {
    await generateSample(page);
    const panel = await pickHeading(page);

    await panel.getByRole(ROLE.tab, { name: EDITOR.actions }).click();
    await panel
      .getByPlaceholder(EDITOR.freeformPlaceholder)
      .fill("Rewrite the heading");
    await panel.getByRole(ROLE.button, { name: EDITOR.apply }).click();

    await expect(page.getByText(UI.editedHeading)).toBeVisible();

    await expect
      .poll(async () => {
        const stored = await readHistoryStorage(page);
        return stored[0]?.revisions?.length ?? 0;
      })
      .toBe(2);
    const entries = await readHistoryStorage(page);
    expect(entries[0].head).toBe(1);

    // Reload → restore the edited entry from history (no API call)
    await page.reload();
    await waitForMsw(page);
    await page.getByRole(ROLE.button, { name: historyButtonName(1) }).click();
    await page
      .getByRole(ROLE.button, { name: new RegExp(PROMPTS.signIn) })
      .click();
    await expect(page.getByText(UI.editedHeading)).toBeVisible();
    await expect(page.getByText(UI.mockHeading)).toHaveCount(0);

    // Revisions are intact after restore: undo reverts the edit
    await page.getByRole(ROLE.button, { name: EDITOR.pick }).click();
    await page.getByText(UI.editedHeading).click();
    const restoredPanel = page.locator("[data-editor-panel]");
    await restoredPanel.getByRole(ROLE.button, { name: EDITOR.undo }).click();
    await expect(page.getByText(UI.mockHeading)).toBeVisible();
  });
});
