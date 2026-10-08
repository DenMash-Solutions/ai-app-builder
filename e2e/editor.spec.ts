import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  EDITOR,
  MOCK_KEYS,
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

    // Level change is a local patch — no API call (shadcn/Radix Select;
    // the popup is portaled to <body>, so locate it from the page)
    await panel.getByRole(ROLE.combobox, { name: "level" }).click();
    await page.getByRole(ROLE.option, { name: "h2" }).click();
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

  test("className and style are edited as structured add/edit/remove lists", async ({
    page,
  }) => {
    await generateSample(page);
    const panel = await pickHeading(page);
    const heading = page.locator("h1").filter({ hasText: UI.mockHeading });

    // Sections are Collapsibles, collapsed by default — expand className first
    await panel
      .getByRole(ROLE.button, { name: EDITOR.classNameTrigger })
      .click();
    await panel.getByRole(ROLE.button, { name: EDITOR.addClass }).click();
    const classInput = panel.getByLabel("className");
    await expect(classInput).toHaveCount(1);
    await classInput.fill("font-normal");
    await classInput.press("Enter");
    await expect(heading).toHaveCSS("font-weight", "400");
    await expect(classInput).toHaveValue("font-normal");

    // remove the token — heading returns to its default weight
    await panel
      .getByRole(ROLE.button, { name: EDITOR.removeRow("font-normal") })
      .click();
    await expect(panel.getByLabel("className")).toHaveCount(0);
    await expect(heading).toHaveCSS("font-weight", "700");

    // expand the style section and add a key/value row
    await panel.getByRole(ROLE.button, { name: EDITOR.styleTrigger }).click();
    await panel.getByRole(ROLE.button, { name: EDITOR.addStyleProp }).click();
    await panel.getByPlaceholder(EDITOR.styleKeyPlaceholder).fill("opacity");
    await panel.getByPlaceholder(EDITOR.styleValuePlaceholder).fill("0.5");
    await panel.getByPlaceholder(EDITOR.styleValuePlaceholder).press("Enter");
    await expect(heading).toHaveCSS("opacity", "0.5");

    // remove the declaration — opacity returns to 1
    await panel
      .getByRole(ROLE.button, { name: EDITOR.removeRow("opacity") })
      .click();
    await expect(heading).toHaveCSS("opacity", "1");
    await expect(
      panel.getByRole(ROLE.button, { name: EDITOR.addStyleProp }),
    ).toBeVisible();
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
      .getByRole(ROLE.button, { name: entryRowName(PROMPTS.signIn) })
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
    const picker = page.locator("[data-component-picker]");
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
    const groupPicker = page.locator("[data-component-picker]");
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
    const groupPicker = page.locator("[data-component-picker]");
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

  test("canvas drag reorders, moves across containers, and supports cancel", async ({
    page,
  }) => {
    await generateSample(page);
    const panel = await pickHeading(page);
    await panel.getByRole(ROLE.tab, { name: EDITOR.structure }).click();

    // Insert an empty Stack into card-1 so a second container exists
    await panel.getByRole(ROLE.button, { name: EDITOR.insert }).click();
    const picker = page.locator("[data-component-picker]");
    await picker.getByPlaceholder(EDITOR.pickerSearch).fill("Stack");
    await picker
      .getByRole("option")
      .filter({ hasText: /^Stack\b/ })
      .first()
      .click();
    await expect(page.locator('[data-jr-key="stack-1"]')).toBeAttached();

    // Leave pick mode so the edit panel can't cover drag targets
    await page.getByRole(ROLE.button, { name: EDITOR.pick }).click();
    await expect(page.locator("[data-editor-panel]")).toHaveCount(0);

    // Drag starts disabled — opt in via the tool rail
    await page.getByRole(ROLE.button, { name: EDITOR.dragdrop }).click();
    await expect(page.locator(".jr-dnd")).toHaveCount(1);

    const box = async (key: string) => {
      const bounds = await page
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
    const ghost = page.locator("[data-dnd-ghost]");
    await expect(ghost).toHaveAttribute("aria-label", dndGhostLabel("text-1"));
    await expect(page.locator('[data-dnd-zone="before"]')).toBeAttached();
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
    await expect(page.locator('[data-dnd-zone="inside"]')).toBeAttached();
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
    await expect(page.locator('[data-jr-key="stack-1"]')).toContainText(
      UI.mockBody,
    );

    // (c) Escape cancels the drag without a revision
    const headingCenter = center(await box("heading-1"));
    await page.mouse.move(headingCenter.x, headingCenter.y);
    await page.mouse.down();
    await page.mouse.move(headingCenter.x + 10, headingCenter.y);
    await expect(page.locator("[data-dnd-ghost]")).toBeAttached();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-dnd-ghost]")).toHaveCount(0);
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
    await expect(page.locator('[data-jr-key="stack-1"]')).not.toContainText(
      UI.mockBody,
    );
  });

  test("drag mode starts off and the tool rail toggle gates it", async ({
    page,
  }) => {
    await generateSample(page);

    const toggle = page.getByRole(ROLE.button, { name: EDITOR.dragdrop });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".jr-dnd")).toHaveCount(0);

    // A drag attempt while disabled never arms: no ghost, no revision
    const before = await readHistoryStorage(page);
    const text = await page
      .locator('[data-jr-key="text-1"] > *')
      .first()
      .boundingBox();
    const heading = await page
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
    await expect(page.locator("[data-dnd-ghost]")).toHaveCount(0);
    await page.mouse.up();

    const after = await readHistoryStorage(page);
    expect(after[0].revisions).toHaveLength(before[0].revisions?.length ?? 0);

    // Toggling on arms drag mode, toggling off disarms it
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".jr-dnd")).toHaveCount(1);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".jr-dnd")).toHaveCount(0);
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
    await page.getByText(UI.mockBody).click();
    await expect(page.locator("[data-editor-panel]")).toHaveCount(1);
    await expect(
      panel.getByText(MOCK_KEYS.text, { exact: true }).first(),
    ).toBeVisible();

    // Escape closes the drawer; pick mode stays armed for re-pick
    await panel.getByRole(ROLE.tab, { name: EDITOR.structure }).click();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-editor-panel]")).toHaveCount(0);

    // Narrow viewport: the same panel remounts as a bottom sheet
    await page.setViewportSize({ width: 375, height: 700 });
    await page.getByText(UI.mockHeading).click();
    const mobilePanel = page.locator("[data-editor-panel]");
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
        const main = document.querySelector("main");
        return main ? getComputedStyle(main).flexDirection : null;
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
      page.getByRole(ROLE.button, { name: EDITOR.expandSheet }),
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
    await page.getByRole(ROLE.button, { name: EDITOR.expandSheet }).click();
    await expect.poll(height).toBe(700);
    await page.getByRole(ROLE.button, { name: EDITOR.collapseSheet }).click();
    await expect.poll(height).toBe(baseline);

    // Swipe up: grows to full screen; swipe down: collapses back
    await swipeVertical(page, "[data-editor-panel]", 650, 150);
    await expect.poll(height).toBe(700);
    await swipeVertical(page, "[data-editor-panel]", 150, 650);
    await expect.poll(height).toBe(baseline);

    // Swipe down again: dismisses the sheet
    await swipeVertical(page, "[data-editor-panel]", 300, 650);
    await expect(page.locator("[data-editor-panel]")).toHaveCount(0);
  });
});
