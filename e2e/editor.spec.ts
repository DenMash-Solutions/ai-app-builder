import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  EDITOR,
  MOCK_KEYS,
  PATHS,
  PROMPTS,
  ROLE,
  UI,
  dndGhostLabel,
  entryRowName,
  historyButtonName,
} from "./constants";
import {
  mockGenerate,
  readHistoryStorage,
  swipeVertical,
  waitForMsw,
} from "./helpers";
import { CAROUSEL_UI_LINES } from "./msw/fixture";

/** Live playground canvas. Cache Components parks the previous route's
 *  `.dot-grid` hidden (React <Activity>), so element keys must be scoped to
 *  the visible canvas — scoping by canvas (not per-element visibility) keeps
 *  zero-box `display: contents` containers (an empty Stack) matchable. */
const liveCanvas = (page: Page) =>
  page.locator(".dot-grid").filter({ visible: true });

async function generateSample(page: Page): Promise<void> {
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
  // Generation redirects to /ui/[id] and remounts the playground — wait for
  // the route before interacting, or tool-state clicks hit the old instance
  // and are lost on unmount.
  await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);
}

async function pickHeading(page: Page) {
  await page
    .getByRole(ROLE.button, { name: EDITOR.pick })
    .filter({ visible: true })
    .click();
  await page.getByText(UI.mockHeading).filter({ visible: true }).click();
  const panel = page.locator("[data-editor-panel]").filter({ visible: true });
  await expect(panel).toBeVisible();
  await expect(
    panel.getByText("Heading", { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  return panel;
}

test.describe("editor", () => {
  test("pick mode selects an element and property edits are undoable/redoable", async ({
    page,
  }) => {
    await generateSample(page);
    const panel = await pickHeading(page);

    // Level change is a local patch — no API call (shadcn/Radix Select;
    // the popup is portaled to <body>, so locate it from the page)
    await panel
      .getByRole(ROLE.combobox, { name: "level" })
      .filter({ visible: true })
      .click();
    await page
      .getByRole(ROLE.option, { name: "h2" })
      .filter({ visible: true })
      .click();
    await expect(
      page
        .locator("h2")
        .filter({ visible: true })
        .filter({ hasText: UI.mockHeading }),
    ).toBeVisible();

    let entries = await readHistoryStorage(page);
    expect(entries[0].revisions).toHaveLength(2);
    expect(entries[0].head).toBe(1);

    await panel
      .getByRole(ROLE.button, { name: EDITOR.undo })
      .filter({ visible: true })
      .click();
    await expect(
      page
        .locator("h1")
        .filter({ visible: true })
        .filter({ hasText: UI.mockHeading }),
    ).toBeVisible();

    await panel
      .getByRole(ROLE.button, { name: EDITOR.redo })
      .filter({ visible: true })
      .click();
    await expect(
      page
        .locator("h2")
        .filter({ visible: true })
        .filter({ hasText: UI.mockHeading }),
    ).toBeVisible();

    entries = await readHistoryStorage(page);
    expect(entries[0].head).toBe(1);
    expect(entries[0].revisions).toHaveLength(2);
  });

  test("className and style are edited as structured add/edit/remove lists", async ({
    page,
  }) => {
    await generateSample(page);
    const panel = await pickHeading(page);
    const heading = page
      .locator("h1")
      .filter({ visible: true })
      .filter({ hasText: UI.mockHeading });

    // Sections are Collapsibles, collapsed by default — expand className first
    await panel
      .getByRole(ROLE.button, { name: EDITOR.classNameTrigger })
      .filter({ visible: true })
      .click();
    await panel
      .getByRole(ROLE.button, { name: EDITOR.addClass })
      .filter({ visible: true })
      .click();
    const classInput = panel.getByLabel("className").filter({ visible: true });
    await expect(classInput).toHaveCount(1);
    await classInput.fill("font-normal");
    await classInput.press("Enter");
    await expect(heading).toHaveCSS("font-weight", "400");
    await expect(classInput).toHaveValue("font-normal");

    // remove the token — heading returns to its default weight
    await panel
      .getByRole(ROLE.button, { name: EDITOR.removeRow("font-normal") })
      .filter({ visible: true })
      .click();
    await expect(
      panel.getByLabel("className").filter({ visible: true }),
    ).toHaveCount(0);
    await expect(heading).toHaveCSS("font-weight", "700");

    // expand the style section and add a key/value row
    await panel
      .getByRole(ROLE.button, { name: EDITOR.styleTrigger })
      .filter({ visible: true })
      .click();
    await panel
      .getByRole(ROLE.button, { name: EDITOR.addStyleProp })
      .filter({ visible: true })
      .click();
    await panel
      .getByPlaceholder(EDITOR.styleKeyPlaceholder)
      .filter({ visible: true })
      .fill("opacity");
    await panel
      .getByPlaceholder(EDITOR.styleValuePlaceholder)
      .filter({ visible: true })
      .fill("0.5");
    await panel
      .getByPlaceholder(EDITOR.styleValuePlaceholder)
      .filter({ visible: true })
      .press("Enter");
    await expect(heading).toHaveCSS("opacity", "0.5");

    // remove the declaration — opacity returns to 1
    await panel
      .getByRole(ROLE.button, { name: EDITOR.removeRow("opacity") })
      .filter({ visible: true })
      .click();
    await expect(heading).toHaveCSS("opacity", "1");
    await expect(
      panel
        .getByRole(ROLE.button, { name: EDITOR.addStyleProp })
        .filter({ visible: true }),
    ).toBeVisible();
  });

  test("freeform action streams a patch and revisions survive a reload", async ({
    page,
  }) => {
    await generateSample(page);
    const panel = await pickHeading(page);

    await panel
      .getByRole(ROLE.tab, { name: EDITOR.actions })
      .filter({ visible: true })
      .click();
    await panel
      .getByPlaceholder(EDITOR.freeformPlaceholder)
      .filter({ visible: true })
      .fill("Rewrite the heading");
    await panel
      .getByRole(ROLE.button, { name: EDITOR.apply })
      .filter({ visible: true })
      .click();

    await expect(
      page.getByText(UI.editedHeading).filter({ visible: true }),
    ).toBeVisible();

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
    await page
      .getByRole(ROLE.button, { name: historyButtonName(1) })
      .filter({ visible: true })
      .click();
    await page
      .getByRole(ROLE.button, { name: entryRowName(PROMPTS.signIn) })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByText(UI.editedHeading).filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText(UI.mockHeading).filter({ visible: true }),
    ).toHaveCount(0);

    // Revisions are intact after restore: undo reverts the edit
    await page
      .getByRole(ROLE.button, { name: EDITOR.pick })
      .filter({ visible: true })
      .click();
    await page.getByText(UI.editedHeading).filter({ visible: true }).click();
    const restoredPanel = page
      .locator("[data-editor-panel]")
      .filter({ visible: true });
    await restoredPanel
      .getByRole(ROLE.button, { name: EDITOR.undo })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByText(UI.mockHeading).filter({ visible: true }),
    ).toBeVisible();
  });

  test("structure tab inserts, groups, and removes locally with undo", async ({
    page,
  }) => {
    await generateSample(page);
    const panel = await pickHeading(page);

    await panel
      .getByRole(ROLE.tab, { name: EDITOR.structure })
      .filter({ visible: true })
      .click();
    await expect(
      panel.getByText(EDITOR.noChildren).filter({ visible: true }),
    ).toBeVisible();
    // Leaf has nothing to unwrap — Ungroup must not offer a silent delete
    await expect(
      panel
        .getByRole(ROLE.button, { name: EDITOR.ungroup })
        .filter({ visible: true }),
    ).toBeDisabled();

    // Heading is a leaf — Insert targets its parent (card-1), appends text-1
    await panel
      .getByRole(ROLE.button, { name: EDITOR.insert })
      .filter({ visible: true })
      .click();
    const picker = page
      .locator("[data-component-picker]")
      .filter({ visible: true });
    await expect(
      picker
        .getByText(EDITOR.pickerTitle, { exact: true })
        .filter({ visible: true }),
    ).toBeVisible();
    await picker
      .getByPlaceholder(EDITOR.pickerSearch)
      .filter({ visible: true })
      .fill("Text");
    await picker
      .getByRole("option")
      .filter({ visible: true })
      .filter({ hasText: /^Text\b/ })
      .first()
      .click();

    await expect(
      page.getByText("Hello, world!").filter({ visible: true }),
    ).toBeVisible();
    const afterInsert = page
      .locator("[data-editor-panel]")
      .filter({ visible: true });
    await expect(
      afterInsert
        .getByRole(ROLE.button, { name: "card-1" })
        .filter({ visible: true }),
    ).toBeVisible();

    let entries = await readHistoryStorage(page);
    expect(entries[0].revisions).toHaveLength(2);
    expect(entries[0].head).toBe(1);

    // Undo drops the new element (panel unmounts), redo restores it
    await page.keyboard.press("ControlOrMeta+z");
    await expect(
      page.getByText("Hello, world!").filter({ visible: true }),
    ).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(
      page.getByText("Hello, world!").filter({ visible: true }),
    ).toBeVisible();

    // Group the heading into a Stack — selection moves to the new container
    await page.getByText(UI.mockHeading).filter({ visible: true }).click();
    const groupPanel = page
      .locator("[data-editor-panel]")
      .filter({ visible: true });
    await groupPanel
      .getByRole(ROLE.tab, { name: EDITOR.structure })
      .filter({ visible: true })
      .click();
    await groupPanel
      .getByRole(ROLE.button, { name: EDITOR.group, exact: true })
      .filter({ visible: true })
      .click();
    const groupPicker = page
      .locator("[data-component-picker]")
      .filter({ visible: true });
    await expect(
      groupPicker
        .getByText(EDITOR.pickerGroupTitle, { exact: true })
        .filter({ visible: true }),
    ).toBeVisible();
    await groupPicker
      .getByPlaceholder(EDITOR.pickerSearch)
      .filter({ visible: true })
      .fill("Stack");
    await groupPicker
      .getByRole("option")
      .filter({ visible: true })
      .filter({ hasText: /^Stack\b/ })
      .first()
      .click();

    const stackPanel = page
      .locator("[data-editor-panel]")
      .filter({ visible: true });
    await expect(
      stackPanel.getByText("Stack", { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText(UI.mockHeading).filter({ visible: true }),
    ).toBeVisible();

    // Remove a child — selection falls back to the parent (root card)
    await page.getByText(UI.mockBody).filter({ visible: true }).click();
    const textPanel = page
      .locator("[data-editor-panel]")
      .filter({ visible: true });
    await textPanel
      .getByRole(ROLE.tab, { name: EDITOR.structure })
      .filter({ visible: true })
      .click();
    await textPanel
      .getByRole(ROLE.button, { name: EDITOR.remove })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByText(UI.mockBody).filter({ visible: true }),
    ).toHaveCount(0);
    const rootPanel = page
      .locator("[data-editor-panel]")
      .filter({ visible: true });
    await expect(
      rootPanel.getByText("Card", { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    // Selection change remounts the panel (new key), but the active tab persists
    await expect(
      rootPanel
        .getByRole(ROLE.tab, { name: EDITOR.structure })
        .filter({ visible: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      rootPanel
        .getByRole(ROLE.button, { name: EDITOR.remove })
        .filter({ visible: true }),
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
    await panel
      .getByRole(ROLE.tab, { name: EDITOR.structure })
      .filter({ visible: true })
      .click();

    // Selecting the root via breadcrumb keeps the Structure tab (lifted state)
    await panel
      .getByRole(ROLE.button, { name: "card-1" })
      .filter({ visible: true })
      .click();
    const rootPanel = page
      .locator("[data-editor-panel]")
      .filter({ visible: true });
    await expect(
      rootPanel
        .getByRole(ROLE.tab, { name: EDITOR.structure })
        .filter({ visible: true }),
    ).toHaveAttribute("aria-selected", "true");

    // Boundary arrows: first child cannot move up, last child cannot move down
    const headingRow = rootPanel
      .getByRole("button", { name: "Heading heading-1" })
      .filter({ visible: true })
      .locator("xpath=..")
      .filter({ visible: true });
    const textRow = rootPanel
      .getByRole("button", { name: "Text text-1" })
      .filter({ visible: true })
      .locator("xpath=..")
      .filter({ visible: true });
    await expect(
      headingRow
        .getByRole("button", { name: EDITOR.moveUp })
        .filter({ visible: true }),
    ).toBeDisabled();
    await expect(
      textRow
        .getByRole("button", { name: EDITOR.moveDown })
        .filter({ visible: true }),
    ).toBeDisabled();

    // Move the heading below the text — selection stays on the root
    await headingRow
      .getByRole("button", { name: EDITOR.moveDown })
      .filter({ visible: true })
      .click();
    let entries = await readHistoryStorage(page);
    expect(entries[0].revisions).toHaveLength(2);
    expect(entries[0].head).toBe(1);
    expect(
      entries[0].revisions?.[1]?.spec.elements["card-1"]?.children,
    ).toEqual(["text-1", "heading-1"]);

    // Duplicate the heading — the clone lands after it and becomes selected
    await rootPanel
      .getByRole("button", { name: "Heading heading-1" })
      .filter({ visible: true })
      .click();
    await rootPanel
      .getByRole(ROLE.button, { name: EDITOR.duplicate })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByText(UI.mockHeading).filter({ visible: true }),
    ).toHaveCount(2);
    await expect(
      rootPanel.getByText("heading-2").filter({ visible: true }),
    ).toBeVisible();
    entries = await readHistoryStorage(page);
    expect(entries[0].revisions).toHaveLength(3);
    expect(entries[0].head).toBe(2);
    expect(
      entries[0].revisions?.[2]?.spec.elements["card-1"]?.children,
    ).toEqual(["text-1", "heading-1", "heading-2"]);

    // Group the original heading into a Stack — selection moves to the container
    await rootPanel
      .getByRole(ROLE.button, { name: "card-1" })
      .filter({ visible: true })
      .click();
    await rootPanel
      .getByRole("button", { name: "Heading heading-1" })
      .filter({ visible: true })
      .click();
    await rootPanel
      .getByRole(ROLE.button, { name: EDITOR.group, exact: true })
      .filter({ visible: true })
      .click();
    const groupPicker = page
      .locator("[data-component-picker]")
      .filter({ visible: true });
    await expect(
      groupPicker
        .getByText(EDITOR.pickerGroupTitle, { exact: true })
        .filter({ visible: true }),
    ).toBeVisible();
    await groupPicker
      .getByPlaceholder(EDITOR.pickerSearch)
      .filter({ visible: true })
      .fill("Stack");
    await groupPicker
      .getByRole("option")
      .filter({ visible: true })
      .filter({ hasText: /^Stack\b/ })
      .first()
      .click();
    await expect(
      rootPanel.getByText("stack-1").filter({ visible: true }),
    ).toBeVisible();
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
    await rootPanel
      .getByRole(ROLE.button, { name: EDITOR.ungroup })
      .filter({ visible: true })
      .click();
    await expect(
      rootPanel.getByText("heading-1").filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page.getByText(UI.mockHeading).filter({ visible: true }),
    ).toHaveCount(2);
    entries = await readHistoryStorage(page);
    expect(entries[0].revisions).toHaveLength(5);
    expect(entries[0].head).toBe(4);
    expect(
      entries[0].revisions?.[4]?.spec.elements["card-1"]?.children,
    ).toEqual(["text-1", "heading-1", "heading-2"]);
    expect(entries[0].revisions?.[4]?.spec.elements["stack-1"]).toBeUndefined();

    // Root protection: remove, duplicate, and unwrap all disabled
    await rootPanel
      .getByRole(ROLE.button, { name: "card-1" })
      .filter({ visible: true })
      .click();
    await expect(
      rootPanel
        .getByRole(ROLE.button, { name: EDITOR.remove })
        .filter({ visible: true }),
    ).toBeDisabled();
    await expect(
      rootPanel
        .getByRole(ROLE.button, { name: EDITOR.duplicate })
        .filter({ visible: true }),
    ).toBeDisabled();
    await expect(
      rootPanel
        .getByRole(ROLE.button, { name: EDITOR.ungroup })
        .filter({ visible: true }),
    ).toBeDisabled();

    entries = await readHistoryStorage(page);
    expect(entries[0].revisions).toHaveLength(5);
    expect(entries[0].head).toBe(4);
  });

  test("canvas drag reorders, moves across containers, and supports cancel", async ({
    page,
  }) => {
    await generateSample(page);
    const panel = await pickHeading(page);
    await panel
      .getByRole(ROLE.tab, { name: EDITOR.structure })
      .filter({ visible: true })
      .click();

    // Insert an empty Stack into card-1 so a second container exists
    await panel
      .getByRole(ROLE.button, { name: EDITOR.insert })
      .filter({ visible: true })
      .click();
    const picker = page
      .locator("[data-component-picker]")
      .filter({ visible: true });
    await picker
      .getByPlaceholder(EDITOR.pickerSearch)
      .filter({ visible: true })
      .fill("Stack");
    await picker
      .getByRole("option")
      .filter({ visible: true })
      .filter({ hasText: /^Stack\b/ })
      .first()
      .click();
    await expect(
      liveCanvas(page).locator('[data-jr-key="stack-1"]'),
    ).toBeAttached();

    // Leave pick mode so the edit panel can't cover drag targets
    await page
      .getByRole(ROLE.button, { name: EDITOR.pick })
      .filter({ visible: true })
      .click();
    await expect(
      page.locator("[data-editor-panel]").filter({ visible: true }),
    ).toHaveCount(0);

    // Drag starts disabled — opt in via the tool rail
    await page
      .getByRole(ROLE.button, { name: EDITOR.dragdrop })
      .filter({ visible: true })
      .click();
    await expect(page.locator(".jr-dnd").filter({ visible: true })).toHaveCount(
      1,
    );

    const box = async (key: string) => {
      const bounds = await liveCanvas(page)
        .locator(`[data-jr-key="${key}"] > *`)
        .first()
        .boundingBox();
      if (!bounds) throw new Error(`no bounding box for ${key}`);
      return bounds;
    };
    const center = (bounds: {
      x: number;
      y: number;
      width: number;
      height: number;
    }) => ({
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    });

    // (a) Reorder within card-1: drag text-1 onto heading-1's top edge
    const text = center(await box("text-1"));
    const heading = await box("heading-1");
    await page.mouse.move(text.x, text.y);
    await page.mouse.down();
    await page.mouse.move(text.x + 10, text.y); // cross the 5px threshold
    await page.mouse.move(
      heading.x + heading.width / 2,
      heading.y + heading.height * 0.15,
      { steps: 6 },
    );
    const ghost = page.locator("[data-dnd-ghost]").filter({ visible: true });
    await expect(ghost).toHaveAttribute("aria-label", dndGhostLabel("text-1"));
    await expect(
      page.locator('[data-dnd-zone="before"]').filter({ visible: true }),
    ).toBeAttached();
    await page.mouse.up();
    await expect(ghost).toHaveCount(0);

    let entries = await readHistoryStorage(page);
    expect(entries[0].revisions).toHaveLength(3);
    expect(entries[0].head).toBe(2);
    expect(entries[0].revisions?.[2]?.label).toBe("structure:move");
    expect(
      entries[0].revisions?.[2]?.spec.elements["card-1"]?.children,
    ).toEqual(["text-1", "heading-1", "stack-1"]);

    // (b) Cross-container: drag text-1 into the (empty) stack-1. Layout
    // changed in (a) — re-measure the source. The stack is only measured after
    // arming: empty containers get a hit area mid-drag.
    const moved = center(await box("text-1"));
    await page.mouse.move(moved.x, moved.y);
    await page.mouse.down();
    await page.mouse.move(moved.x + 10, moved.y);
    const stack = center(await box("stack-1"));
    await page.mouse.move(stack.x, stack.y, { steps: 6 });
    await expect(
      page.locator('[data-dnd-zone="inside"]').filter({ visible: true }),
    ).toBeAttached();
    await page.mouse.up();

    entries = await readHistoryStorage(page);
    expect(entries[0].revisions).toHaveLength(4);
    expect(entries[0].head).toBe(3);
    expect(
      entries[0].revisions?.[3]?.spec.elements["card-1"]?.children,
    ).toEqual(["heading-1", "stack-1"]);
    expect(
      entries[0].revisions?.[3]?.spec.elements["stack-1"]?.children,
    ).toEqual(["text-1"]);
    await expect(
      liveCanvas(page).locator('[data-jr-key="stack-1"]'),
    ).toContainText(UI.mockBody);

    // (c) Escape cancels the drag without a revision
    const headingCenter = center(await box("heading-1"));
    await page.mouse.move(headingCenter.x, headingCenter.y);
    await page.mouse.down();
    await page.mouse.move(headingCenter.x + 10, headingCenter.y);
    await expect(
      page.locator("[data-dnd-ghost]").filter({ visible: true }),
    ).toBeAttached();
    await page.keyboard.press("Escape");
    await expect(
      page.locator("[data-dnd-ghost]").filter({ visible: true }),
    ).toHaveCount(0);
    await page.mouse.up();

    entries = await readHistoryStorage(page);
    expect(entries[0].revisions).toHaveLength(4);
    expect(entries[0].head).toBe(3);

    // (d) Undo restores the cross-container move
    await page.keyboard.press("ControlOrMeta+z");
    entries = await readHistoryStorage(page);
    expect(entries[0].head).toBe(2);
    expect(
      entries[0].revisions?.[2]?.spec.elements["card-1"]?.children,
    ).toEqual(["text-1", "heading-1", "stack-1"]);
    await expect(
      liveCanvas(page).locator('[data-jr-key="stack-1"]'),
    ).not.toContainText(UI.mockBody);
  });

  test("drag mode starts off and the tool rail toggle gates it", async ({
    page,
  }) => {
    await generateSample(page);

    const toggle = page
      .getByRole(ROLE.button, { name: EDITOR.dragdrop })
      .filter({ visible: true });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".jr-dnd").filter({ visible: true })).toHaveCount(
      0,
    );

    // A drag attempt while disabled never arms: no ghost, no revision
    const before = await readHistoryStorage(page);
    const text = await liveCanvas(page)
      .locator('[data-jr-key="text-1"] > *')
      .first()
      .boundingBox();
    const heading = await liveCanvas(page)
      .locator('[data-jr-key="heading-1"] > *')
      .first()
      .boundingBox();
    if (!text || !heading) throw new Error("missing drag targets");
    await page.mouse.move(text.x + text.width / 2, text.y + text.height / 2);
    await page.mouse.down();
    await page.mouse.move(text.x + 20, text.y);
    await page.mouse.move(
      heading.x + heading.width / 2,
      heading.y + heading.height / 2,
      { steps: 6 },
    );
    await expect(
      page.locator("[data-dnd-ghost]").filter({ visible: true }),
    ).toHaveCount(0);
    await page.mouse.up();

    const after = await readHistoryStorage(page);
    expect(after[0].revisions).toHaveLength(before[0].revisions?.length ?? 0);

    // Toggling on arms drag mode, toggling off disarms it
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".jr-dnd").filter({ visible: true })).toHaveCount(
      1,
    );

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".jr-dnd").filter({ visible: true })).toHaveCount(
      0,
    );
  });

  test("x-ray dots label elements and pick hover shows a badge", async ({
    page,
  }) => {
    await generateSample(page);

    await page
      .getByRole(ROLE.button, { name: EDITOR.xray })
      .filter({ visible: true })
      .click();
    // CSS outlines still mark containers vs leaves while the mode is on
    await expect(
      liveCanvas(page).locator('[data-jr-key="card-1"][data-jr-container]'),
    ).toHaveCount(1);
    await expect(
      liveCanvas(page).locator('[data-jr-key="heading-1"][data-jr-container]'),
    ).toHaveCount(0);

    // One dot per element — containers and leaves alike
    await expect(
      page.locator('[data-xray-dot="card-1"]').filter({ visible: true }),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-xray-dot="heading-1"]').filter({ visible: true }),
    ).toHaveCount(1);

    // Hovering a dot shows the `key · Type` label
    await page
      .locator('[data-xray-dot="heading-1"]')
      .filter({ visible: true })
      .hover();
    const label = page
      .locator('[data-xray-label="heading-1"]')
      .filter({ visible: true });
    await expect(label).toHaveCount(1);
    await expect(label).toContainText("heading-1");
    await expect(label).toContainText("Heading");

    // Click transforms the dot in place into a chip (pin) that clears the
    // element's top border and outlines the element itself. Singletons get
    // the `+`/`✓` toggle directly (no dropdown); the chip body toggles
    // scope and only the X button removes.
    await page
      .locator('[data-xray-dot="heading-1"]')
      .filter({ visible: true })
      .click();
    const chip = page
      .locator('[data-xray-chip="heading-1"]')
      .filter({ visible: true });
    await expect(chip).toHaveCount(1);
    await expect(label).toHaveCount(0);
    const singletonScope = chip
      .locator("[data-xray-scope]")
      .filter({ visible: true });
    await expect(singletonScope).toHaveAttribute(
      "data-xray-scope-state",
      "idle",
    );
    await expect(
      chip.locator("[data-xray-remove]").filter({ visible: true }),
    ).toHaveCount(1);
    await expect(
      liveCanvas(page).locator('[data-jr-key="heading-1"][data-xray-pinned]'),
    ).toHaveCount(1);

    // The + toggles scope on, the ✓ toggles it off — no dropdown involved
    await singletonScope.click();
    await expect(singletonScope).toHaveAttribute(
      "data-xray-scope-state",
      "active",
    );
    await expect(
      page.locator("[data-jr-scope]").filter({ visible: true }),
    ).toHaveCount(1);
    await singletonScope.click();
    await expect(singletonScope).toHaveAttribute(
      "data-xray-scope-state",
      "idle",
    );
    await expect(
      page.locator("[data-jr-scope]").filter({ visible: true }),
    ).toHaveCount(0);

    // Clicking the chip body toggles scope — it does NOT remove the chip.
    // Only the X button removes.
    await chip.click();
    await expect(chip).toHaveCount(1);
    await expect(
      page.locator("[data-jr-scope]").filter({ visible: true }),
    ).toHaveCount(1);
    // The X button is the only removal path.
    await chip.locator("[data-xray-remove]").filter({ visible: true }).click();
    await expect(chip).toHaveCount(0);
    await expect(
      page.locator('[data-xray-dot="heading-1"]').filter({ visible: true }),
    ).toHaveCount(1);
    await expect(
      liveCanvas(page).locator('[data-jr-key="heading-1"][data-xray-pinned]'),
    ).toHaveCount(0);
    await expect(
      page.locator("[data-jr-scope]").filter({ visible: true }),
    ).toHaveCount(0);

    await page
      .getByRole(ROLE.button, { name: EDITOR.xray })
      .filter({ visible: true })
      .click();
    await expect(
      page.locator("[data-jr-container]").filter({ visible: true }),
    ).toHaveCount(0);
    await expect(
      page.locator("[data-xray-dot]").filter({ visible: true }),
    ).toHaveCount(0);
    await expect(
      page.locator("[data-xray-label]").filter({ visible: true }),
    ).toHaveCount(0);
    await expect(
      page.locator("[data-xray-chip]").filter({ visible: true }),
    ).toHaveCount(0);

    await page
      .getByRole(ROLE.button, { name: EDITOR.pick })
      .filter({ visible: true })
      .click();
    await page.getByText(UI.mockHeading).filter({ visible: true }).hover();
    const badge = page.locator("[data-editor-badge]").filter({ visible: true });
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("heading-1");
  });

  test("x-ray dots fan, mark boxless elements, and never overflow the canvas", async ({
    page,
  }) => {
    await mockGenerate(page, { lines: CAROUSEL_UI_LINES });
    await page.goto(PATHS.ui);
    await waitForMsw(page);
    await page
      .getByRole(ROLE.button, { name: PROMPTS.signIn })
      .filter({ visible: true })
      .click();
    await page.setViewportSize({ width: 724, height: 900 });
    await expect(
      page.getByText("Carousel Heading 1").filter({ visible: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);

    await page
      .getByRole(ROLE.button, { name: EDITOR.xray })
      .filter({ visible: true })
      .click();

    // One dot per element, including instances past the canvas column
    await expect(
      page.locator('[data-xray-dot="carousel-row"]').filter({ visible: true }),
    ).toHaveCount(1);
    await expect(
      page
        .locator('[data-xray-dot="carousel-card-3"]')
        .filter({ visible: true }),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-xray-dot="carousel-tabs"]').filter({ visible: true }),
    ).toHaveCount(1);

    // Fan: dots sharing a y-band are pitched a full hit-size (20px) apart —
    // coincident anchors (row/tabs, overlay content/badge/image, nested
    // parent/child unions) never collapse or cover each other's centers
    const tooClose = await page.evaluate(() => {
      const centers = Array.from(
        document.querySelectorAll("[data-xray-dot]"),
      ).map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      const clashes: Array<[number, number]> = [];
      for (let i = 0; i < centers.length; i += 1) {
        for (let j = i + 1; j < centers.length; j += 1) {
          const dx = Math.abs(centers[i].x - centers[j].x);
          const dy = Math.abs(centers[i].y - centers[j].y);
          if (dy < 16 && dx < 16) clashes.push([i, j]);
        }
      }
      return clashes;
    });
    expect(tooClose).toEqual([]);

    // The `hidden` card paints nothing → amber boxless dot at the cascade
    await expect(
      page
        .locator('[data-xray-boxless="carousel-ghost"]')
        .filter({ visible: true }),
    ).toHaveCount(1);

    // Labels/dots are clipped to the canvas box — decorations never add
    // scrollable overflow (same invariant as the selection-ring regression)
    const metrics = await page
      .locator("main .overflow-y-auto")
      .filter({ visible: true })
      .first()
      .evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }));
    expect(metrics.scrollWidth).toBe(metrics.clientWidth);
  });

  test("selection ring on an element past the canvas edge adds no horizontal overflow", async ({
    page,
  }) => {
    await mockGenerate(page, { lines: CAROUSEL_UI_LINES });
    await page.goto(PATHS.ui);
    await waitForMsw(page);
    await page
      .getByRole(ROLE.button, { name: PROMPTS.signIn })
      .filter({ visible: true })
      .click();
    await page.setViewportSize({ width: 724, height: 900 });

    const heading = page
      .getByText("Carousel Heading 3")
      .filter({ visible: true });
    await expect(heading).toBeVisible();
    await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);
    const canvas = page
      .locator("main .overflow-y-auto")
      .filter({ visible: true })
      .first();

    // Sanity: the row scrolls internally, but getBoundingClientRect is
    // unclipped geometry — card 3's heading must stick out past the column
    const pastColumn = await heading.evaluate((el) => {
      const scroller = el.closest<HTMLElement>(".overflow-y-auto");
      if (!scroller) throw new Error("no canvas scroll container");
      return Math.round(
        el.getBoundingClientRect().right -
          scroller.getBoundingClientRect().right,
      );
    });
    expect(pastColumn).toBeGreaterThan(0);

    await page
      .getByRole(ROLE.button, { name: EDITOR.pick })
      .filter({ visible: true })
      .click();
    // dispatchEvent picks without Playwright's scroll-into-view, keeping the
    // partially-out-of-column state the ring must tolerate
    await heading.dispatchEvent("click");

    const ring = page
      .locator("[data-editor-selection-ring]")
      .filter({ visible: true });
    await expect(ring).toBeVisible();
    // The ring frames the target (rAF tracker wrote the heading's rect)
    await expect
      .poll(async () => {
        const ringBox = await ring.boundingBox();
        const headingBox = await heading.boundingBox();
        if (!ringBox || !headingBox) return -1;
        return Math.abs(ringBox.x - headingBox.x);
      })
      .toBeLessThanOrEqual(2);

    // Invariant: a decorative overlay never adds scrollable overflow to the
    // canvas scroll container (regression: the ring used to live inside the
    // scroller in scroll coordinates, inflating scrollWidth by 106px)
    const metrics = await canvas.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      scrollLeft: el.scrollLeft,
    }));
    expect(metrics.scrollWidth).toBe(metrics.clientWidth);
    expect(metrics.scrollLeft).toBe(0);
  });

  test("edit panel docks right on desktop, bottom on mobile, and stays open across re-pick", async ({
    page,
  }) => {
    await generateSample(page);
    const panel = await pickHeading(page);
    const desktop = page.viewportSize();
    if (!desktop) throw new Error("missing viewport size");

    // Desktop: docked flush to the right edge, full viewport height
    await expect
      .poll(async () => {
        const box = await panel.boundingBox();
        return box ? Math.round(box.x + box.width) : -1;
      })
      .toBe(desktop.width);
    const desktopBox = await panel.boundingBox();
    if (!desktopBox) throw new Error("panel has no bounding box");
    expect(Math.round(desktopBox.height)).toBe(desktop.height);

    // Re-pick while open: the drawer stays, content swaps to the new element
    await page.getByText(UI.mockBody).filter({ visible: true }).click();
    await expect(
      page.locator("[data-editor-panel]").filter({ visible: true }),
    ).toHaveCount(1);
    await expect(
      panel
        .getByText(MOCK_KEYS.text, { exact: true })
        .filter({ visible: true })
        .first(),
    ).toBeVisible();

    // Escape closes the drawer; pick mode stays armed for re-pick
    await panel
      .getByRole(ROLE.tab, { name: EDITOR.structure })
      .filter({ visible: true })
      .click();
    await page.keyboard.press("Escape");
    await expect(
      page.locator("[data-editor-panel]").filter({ visible: true }),
    ).toHaveCount(0);

    // Narrow viewport: the same panel remounts as a bottom sheet
    await page.setViewportSize({ width: 375, height: 700 });
    await page.getByText(UI.mockHeading).filter({ visible: true }).click();
    const mobilePanel = page
      .locator("[data-editor-panel]")
      .filter({ visible: true });
    await expect(mobilePanel).toBeVisible();
    await expect
      .poll(async () => {
        const box = await mobilePanel.boundingBox();
        return box ? Math.round(box.y + box.height) : -1;
      })
      .toBe(700);
    const mobileBox = await mobilePanel.boundingBox();
    if (!mobileBox) throw new Error("panel has no bounding box");
    expect(Math.round(mobileBox.width)).toBe(375);
  });

  test("drawer treats ≥md (768px) as desktop — sheet below, docked at or above", async ({
    page,
  }) => {
    await generateSample(page);

    // 700px is ≥ the old sm threshold but < md: must still be a bottom sheet
    await page.setViewportSize({ width: 700, height: 800 });
    const panel = await pickHeading(page);
    await expect
      .poll(async () => {
        const box = await panel.boundingBox();
        return box ? Math.round(box.width) : -1;
      })
      .toBe(700);
    const flexDirection = () =>
      page.evaluate(() => {
        const canvas = document.querySelector("[data-canvas]");
        return canvas ? getComputedStyle(canvas).flexDirection : null;
      });
    expect(await flexDirection()).toBe("column");

    // 800px ≥ md: live resize docks the same panel to the right edge
    await page.setViewportSize({ width: 800, height: 800 });
    await expect
      .poll(async () => {
        const box = await panel.boundingBox();
        return box ? Math.round(box.width) : -1;
      })
      .toBe(448);
    expect(await flexDirection()).toBe("row");
    // The sheet expand affordance is mobile-only
    await expect(
      page
        .getByRole(ROLE.button, { name: EDITOR.expandSheet })
        .filter({ visible: true }),
    ).toHaveCount(0);
  });

  test("mobile sheet swipes up to full screen and down to collapse, then dismiss", async ({
    page,
  }) => {
    await generateSample(page);
    await page.setViewportSize({ width: 375, height: 700 });
    const panel = await pickHeading(page);
    const height = async (): Promise<number> => {
      const box = await panel.boundingBox();
      return box ? Math.round(box.height) : -1;
    };

    // Default sheet: content-hugging (capped at 80dvh, not a fixed fill) —
    // wait out the 200ms enter animation, then capture the settled height
    await expect
      .poll(async () => {
        const a = await height();
        await new Promise((resolve) => setTimeout(resolve, 60));
        const b = await height();
        return a === b && a > 0;
      })
      .toBe(true);
    const baseline = await height();
    expect(baseline).toBeLessThan(560);

    // Expand button (mobile-only affordance): grows to full screen, collapses back
    await page
      .getByRole(ROLE.button, { name: EDITOR.expandSheet })
      .filter({ visible: true })
      .click();
    await expect.poll(height).toBe(700);
    await page
      .getByRole(ROLE.button, { name: EDITOR.collapseSheet })
      .filter({ visible: true })
      .click();
    await expect.poll(height).toBe(baseline);

    // Swipe up: grows to full screen; swipe down: collapses back
    await swipeVertical(page, "[data-editor-panel]", 650, 150);
    await expect.poll(height).toBe(700);
    await swipeVertical(page, "[data-editor-panel]", 150, 650);
    await expect.poll(height).toBe(baseline);

    // Swipe down again: dismisses the sheet
    await swipeVertical(page, "[data-editor-panel]", 300, 650);
    await expect(
      page.locator("[data-editor-panel]").filter({ visible: true }),
    ).toHaveCount(0);
  });
});
