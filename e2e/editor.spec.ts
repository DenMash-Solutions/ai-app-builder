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

  test("structure tab inserts, groups, and removes locally with undo", async ({
    page,
  }) => {
    await generateSample(page);
    const panel = await pickHeading(page);

    await panel.getByRole(ROLE.tab, { name: EDITOR.structure }).click();
    await expect(panel.getByText(EDITOR.noChildren)).toBeVisible();
    // Leaf has nothing to unwrap — Ungroup must not offer a silent delete
    await expect(
      panel.getByRole(ROLE.button, { name: EDITOR.ungroup }),
    ).toBeDisabled();

    // Heading is a leaf — Insert targets its parent (card-1), appends text-1
    await panel.getByRole(ROLE.button, { name: EDITOR.insert }).click();
    const picker = page.getByRole("dialog");
    await expect(
      picker.getByText(EDITOR.pickerTitle, { exact: true }),
    ).toBeVisible();
    await picker.getByPlaceholder(EDITOR.pickerSearch).fill("Text");
    await picker
      .getByRole("option")
      .filter({ hasText: /^Text\b/ })
      .first()
      .click();

    await expect(page.getByText("Hello, world!")).toBeVisible();
    const afterInsert = page.locator("[data-editor-panel]");
    await expect(
      afterInsert.getByRole(ROLE.button, { name: "card-1" }),
    ).toBeVisible();

    let entries = await readHistoryStorage(page);
    expect(entries[0].revisions).toHaveLength(2);
    expect(entries[0].head).toBe(1);

    // Undo drops the new element (panel unmounts), redo restores it
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.getByText("Hello, world!")).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(page.getByText("Hello, world!")).toBeVisible();

    // Group the heading into a Stack — selection moves to the new container
    await page.getByText(UI.mockHeading).click();
    const groupPanel = page.locator("[data-editor-panel]");
    await groupPanel.getByRole(ROLE.tab, { name: EDITOR.structure }).click();
    await groupPanel
      .getByRole(ROLE.button, { name: EDITOR.group, exact: true })
      .click();
    const groupPicker = page.getByRole("dialog");
    await expect(
      groupPicker.getByText(EDITOR.pickerGroupTitle, { exact: true }),
    ).toBeVisible();
    await groupPicker.getByPlaceholder(EDITOR.pickerSearch).fill("Stack");
    await groupPicker
      .getByRole("option")
      .filter({ hasText: /^Stack\b/ })
      .first()
      .click();

    const stackPanel = page.locator("[data-editor-panel]");
    await expect(stackPanel.getByText("Stack", { exact: true })).toBeVisible();
    await expect(page.getByText(UI.mockHeading)).toBeVisible();

    // Remove a child — selection falls back to the parent (root card)
    await page.getByText(UI.mockBody).click();
    const textPanel = page.locator("[data-editor-panel]");
    await textPanel.getByRole(ROLE.tab, { name: EDITOR.structure }).click();
    await textPanel.getByRole(ROLE.button, { name: EDITOR.remove }).click();
    await expect(page.getByText(UI.mockBody)).toHaveCount(0);
    const rootPanel = page.locator("[data-editor-panel]");
    await expect(rootPanel.getByText("Card", { exact: true })).toBeVisible();
    // Selection change remounts the panel (new key), but the active tab persists
    await expect(
      rootPanel.getByRole(ROLE.tab, { name: EDITOR.structure }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      rootPanel.getByRole(ROLE.button, { name: EDITOR.remove }),
    ).toBeDisabled();

    entries = await readHistoryStorage(page);
    expect(entries[0].revisions).toHaveLength(4);
    expect(entries[0].head).toBe(3);
  });

  test("structure tab moves, duplicates, and ungroups with disabled states", async ({
    page,
  }) => {
    await generateSample(page);
    const panel = await pickHeading(page);
    await panel.getByRole(ROLE.tab, { name: EDITOR.structure }).click();

    // Selecting the root via breadcrumb keeps the Structure tab (lifted state)
    await panel.getByRole(ROLE.button, { name: "card-1" }).click();
    const rootPanel = page.locator("[data-editor-panel]");
    await expect(
      rootPanel.getByRole(ROLE.tab, { name: EDITOR.structure }),
    ).toHaveAttribute("aria-selected", "true");

    // Boundary arrows: first child cannot move up, last child cannot move down
    const headingRow = rootPanel
      .getByRole("button", { name: "Heading heading-1" })
      .locator("xpath=..");
    const textRow = rootPanel
      .getByRole("button", { name: "Text text-1" })
      .locator("xpath=..");
    await expect(
      headingRow.getByRole("button", { name: EDITOR.moveUp }),
    ).toBeDisabled();
    await expect(
      textRow.getByRole("button", { name: EDITOR.moveDown }),
    ).toBeDisabled();

    // Move the heading below the text — selection stays on the root
    await headingRow.getByRole("button", { name: EDITOR.moveDown }).click();
    let entries = await readHistoryStorage(page);
    expect(entries[0].revisions).toHaveLength(2);
    expect(entries[0].head).toBe(1);
    expect(
      entries[0].revisions?.[1]?.spec.elements["card-1"]?.children,
    ).toEqual(["text-1", "heading-1"]);

    // Duplicate the heading — the clone lands after it and becomes selected
    await rootPanel.getByRole("button", { name: "Heading heading-1" }).click();
    await rootPanel.getByRole(ROLE.button, { name: EDITOR.duplicate }).click();
    await expect(page.getByText(UI.mockHeading)).toHaveCount(2);
    await expect(rootPanel.getByText("heading-2")).toBeVisible();
    entries = await readHistoryStorage(page);
    expect(entries[0].revisions).toHaveLength(3);
    expect(entries[0].head).toBe(2);
    expect(
      entries[0].revisions?.[2]?.spec.elements["card-1"]?.children,
    ).toEqual(["text-1", "heading-1", "heading-2"]);

    // Group the original heading into a Stack — selection moves to the container
    await rootPanel.getByRole(ROLE.button, { name: "card-1" }).click();
    await rootPanel.getByRole("button", { name: "Heading heading-1" }).click();
    await rootPanel
      .getByRole(ROLE.button, { name: EDITOR.group, exact: true })
      .click();
    const groupPicker = page.getByRole("dialog");
    await expect(
      groupPicker.getByText(EDITOR.pickerGroupTitle, { exact: true }),
    ).toBeVisible();
    await groupPicker.getByPlaceholder(EDITOR.pickerSearch).fill("Stack");
    await groupPicker
      .getByRole("option")
      .filter({ hasText: /^Stack\b/ })
      .first()
      .click();
    await expect(rootPanel.getByText("stack-1")).toBeVisible();
    entries = await readHistoryStorage(page);
    expect(entries[0].revisions).toHaveLength(4);
    expect(entries[0].head).toBe(3);
    expect(
      entries[0].revisions?.[3]?.spec.elements["card-1"]?.children,
    ).toEqual(["text-1", "stack-1", "heading-2"]);
    expect(
      entries[0].revisions?.[3]?.spec.elements["stack-1"]?.children,
    ).toEqual(["heading-1"]);

    // Ungroup dissolves the stack and splices the heading back into the root
    await rootPanel.getByRole(ROLE.button, { name: EDITOR.ungroup }).click();
    await expect(rootPanel.getByText("heading-1")).toBeVisible();
    await expect(page.getByText(UI.mockHeading)).toHaveCount(2);
    entries = await readHistoryStorage(page);
    expect(entries[0].revisions).toHaveLength(5);
    expect(entries[0].head).toBe(4);
    expect(
      entries[0].revisions?.[4]?.spec.elements["card-1"]?.children,
    ).toEqual(["text-1", "heading-1", "heading-2"]);
    expect(entries[0].revisions?.[4]?.spec.elements["stack-1"]).toBeUndefined();

    // Root protection: remove, duplicate, and unwrap all disabled
    await rootPanel.getByRole(ROLE.button, { name: "card-1" }).click();
    await expect(
      rootPanel.getByRole(ROLE.button, { name: EDITOR.remove }),
    ).toBeDisabled();
    await expect(
      rootPanel.getByRole(ROLE.button, { name: EDITOR.duplicate }),
    ).toBeDisabled();
    await expect(
      rootPanel.getByRole(ROLE.button, { name: EDITOR.ungroup }),
    ).toBeDisabled();

    entries = await readHistoryStorage(page);
    expect(entries[0].revisions).toHaveLength(5);
    expect(entries[0].head).toBe(4);
  });

  test("x-ray outlines containers and pick hover shows a badge", async ({
    page,
  }) => {
    await generateSample(page);

    await page.getByRole(ROLE.button, { name: EDITOR.xray }).click();
    await expect(
      page.locator('[data-jr-key="card-1"][data-jr-container]'),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-jr-key="heading-1"][data-jr-container]'),
    ).toHaveCount(0);

    await page.getByRole(ROLE.button, { name: EDITOR.xray }).click();
    await expect(page.locator("[data-jr-container]")).toHaveCount(0);

    await page.getByRole(ROLE.button, { name: EDITOR.pick }).click();
    await page.getByText(UI.mockHeading).hover();
    const badge = page.locator("[data-editor-badge]");
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("heading-1");
  });
});
