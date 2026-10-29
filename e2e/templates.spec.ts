import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  EDITOR,
  MOCK_KEYS,
  PATHS,
  PROMPTS,
  ROLE,
  UI,
  entryRowName,
  historyButtonName,
} from "./constants";
import type { StoredEntry, StoredSpec } from "./helpers";
import { mockGenerate, readHistoryStorage, waitForMsw } from "./helpers";

/** Saved-template library (plan 060) — visitor-level, one array in storage. */
const readLibrary = (page: Page): Promise<Record<string, unknown>[]> =>
  page.evaluate(
    () =>
      JSON.parse(
        localStorage.getItem("genui-component-templates") ?? "[]",
      ) as Record<string, unknown>[],
  );

/** Keys of the expanded roots carrying the plan-060 provenance stamp. */
const stampedKeys = (spec: StoredSpec): string[] =>
  Object.keys(spec.elements).filter(
    (key) => spec.elements[key]?.props?.["data-template-id"] !== undefined,
  );

/** The entry's current revision (`revisions[head]`), when fully recorded. */
const headRevision = (entries: StoredEntry[]) => {
  const entry = entries[0];
  if (!entry || entry.head === undefined || !entry.revisions) return undefined;
  return entry.revisions[entry.head];
};

const picker = (page: Page) =>
  page.locator("[data-component-picker]").filter({ visible: true });

const panel = (page: Page) =>
  page.locator("[data-editor-panel]").filter({ visible: true });

async function generateSample(page: Page): Promise<void> {
  await mockGenerate(page);
  await page.goto(PATHS.ui);
  await waitForMsw(page);
  await page
    .getByRole(ROLE.button, { name: PROMPTS.signIn })
    .filter({ visible: true })
    .click();
  await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);
}

/** Pick the mock heading and return the open edit panel (Properties tab). */
async function pickHeading(page: Page) {
  await page
    .getByRole(ROLE.button, { name: EDITOR.pick })
    .filter({ visible: true })
    .click();
  await page
    .getByText(UI.mockHeading)
    .filter({ visible: true })
    .first()
    .click();
  await expect(panel(page)).toBeVisible();
  return panel(page);
}

async function openStructureTab(page: Page) {
  const openPanel = panel(page);
  await openPanel
    .getByRole(ROLE.tab, { name: EDITOR.structure })
    .filter({ visible: true })
    .click();
  return openPanel;
}

/** Save the currently selected element under `name` from the structure tab. */
async function saveAsTemplate(page: Page, name: string) {
  await panel(page)
    .getByRole(ROLE.button, { name: EDITOR.saveTemplate })
    .filter({ visible: true })
    .click();
  const dialog = page
    .locator("[data-save-template-dialog]")
    .filter({ visible: true });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole(ROLE.textbox, { name: EDITOR.saveTemplateLabel })
    .fill(`  ${name}  `);
  await dialog
    .getByRole(ROLE.button, { name: EDITOR.saveTemplateSubmit })
    .click();
  await expect(dialog).toHaveCount(0);
}

/** Open the Templates picker and click the row whose name contains `name`. */
async function insertTemplate(page: Page, name: string) {
  await panel(page)
    .getByRole(ROLE.button, { name: EDITOR.templates })
    .filter({ visible: true })
    .click();
  const row = picker(page).getByRole(ROLE.option).filter({ hasText: name });
  await expect(row).toHaveCount(1);
  await row.click();
  await expect(picker(page)).toHaveCount(0);
}

test.describe("component templates", () => {
  test("save a selection and copy-expand it with provenance (twice, survives reload)", async ({
    page,
  }) => {
    await generateSample(page);
    await pickHeading(page);
    await openStructureTab(page);

    // Save the leaf heading — trimmed name, detached 1-element snapshot,
    // and NO spec revision (library writes are not history).
    await saveAsTemplate(page, "Saved heading");
    let library = await readLibrary(page);
    expect(library).toHaveLength(1);
    expect((library[0] as { name: string }).name).toBe("Saved heading");
    const subtree = (
      library[0] as {
        subtree: { rootKey: string; elements: Record<string, unknown> };
      }
    ).subtree;
    expect(subtree.rootKey).toBe(MOCK_KEYS.heading);
    expect(Object.keys(subtree.elements)).toEqual([MOCK_KEYS.heading]);
    expect(await readHistoryStorage(page)).toHaveLength(1);

    // Insert #1 — picker offers the row with its element count.
    await insertTemplate(page, "Saved heading");
    let entries = await readHistoryStorage(page);
    expect(entries[0].revisions).toHaveLength(2);
    let revision = headRevision(entries)!;
    expect(revision.label).toBe("structure:insert:Saved heading");
    let spec = revision.spec;
    let stamped = stampedKeys(spec);
    expect(stamped).toHaveLength(1);
    expect(new Set(Object.keys(spec.elements)).size).toBe(
      Object.keys(spec.elements).length,
    );
    const templateId = (library[0] as { id: string }).id;
    expect(spec.elements[stamped[0]]?.props?.["data-template-id"]).toBe(
      templateId,
    );
    expect(spec.elements[stamped[0]]?.props?.level).toBe("h1");
    expect(spec.elements[MOCK_KEYS.card]?.children).toContain(stamped[0]);

    // Insert #2 — a second, independent copy (fresh keys again).
    await insertTemplate(page, "Saved heading");
    entries = await readHistoryStorage(page);
    expect(entries[0].revisions).toHaveLength(3);
    revision = headRevision(entries)!;
    spec = revision.spec;
    stamped = stampedKeys(spec);
    expect(stamped).toHaveLength(2);
    expect(new Set(Object.keys(spec.elements)).size).toBe(
      Object.keys(spec.elements).length,
    );
    // Both stamped the same template id, both children of the same parent.
    for (const key of stamped) {
      expect(spec.elements[key]?.props?.["data-template-id"]).toBe(templateId);
      expect(spec.elements[MOCK_KEYS.card]?.children).toContain(key);
    }

    // Edit copy B's level — copy A (and the source) stay at h1.
    const copyB = stamped[1];
    await panel(page)
      .getByRole(ROLE.tab, { name: EDITOR.properties })
      .filter({ visible: true })
      .click();
    await panel(page)
      .getByRole(ROLE.combobox, { name: "level" })
      .filter({ visible: true })
      .click();
    await page
      .getByRole(ROLE.option, { name: "h2" })
      .filter({ visible: true })
      .click();
    entries = await readHistoryStorage(page);
    spec = headRevision(entries)!.spec;
    expect(spec.elements[copyB]?.props?.level).toBe("h2");
    expect(spec.elements[stamped[0]]?.props?.level).toBe("h1");
    expect(spec.elements[MOCK_KEYS.heading]?.props?.level).toBe("h1");

    // Reload → restore from history, library survives, picker still offers it.
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
    // Original + two expanded copies all render the heading text.
    await expect(
      page.getByText(UI.mockHeading).filter({ visible: true }),
    ).toHaveCount(3);

    library = await readLibrary(page);
    expect(library).toHaveLength(1);
    expect((library[0] as { name: string }).name).toBe("Saved heading");

    const restoredPanel = await pickHeading(page);
    await openStructureTab(page);
    await restoredPanel
      .getByRole(ROLE.button, { name: EDITOR.templates })
      .filter({ visible: true })
      .click();
    const row = picker(page)
      .getByRole(ROLE.option)
      .filter({ hasText: "Saved heading" });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("1 element");
  });

  test("rename (commit + escape) and delete templates in the picker", async ({
    page,
  }) => {
    await generateSample(page);
    await pickHeading(page);
    await openStructureTab(page);
    await saveAsTemplate(page, "Original name");

    await panel(page)
      .getByRole(ROLE.button, { name: EDITOR.templates })
      .filter({ visible: true })
      .click();
    await expect(
      picker(page).getByRole(ROLE.option).filter({ hasText: "Original name" }),
    ).toHaveCount(1);

    // Rename: Enter commits (trimmed) and the row + library update live.
    await picker(page)
      .getByRole(ROLE.button, { name: EDITOR.pickerRenameTemplate })
      .click();
    const renameInput = picker(page).getByRole(ROLE.textbox, {
      name: EDITOR.pickerRenameTemplate,
    });
    await renameInput.fill("  Renamed template  ");
    await renameInput.press("Enter");
    await expect(
      picker(page)
        .getByRole(ROLE.option)
        .filter({ hasText: "Renamed template" }),
    ).toHaveCount(1);
    expect(((await readLibrary(page))[0] as { name: string }).name).toBe(
      "Renamed template",
    );

    // Escape cancels — the draft never reaches the library.
    await picker(page)
      .getByRole(ROLE.button, { name: EDITOR.pickerRenameTemplate })
      .click();
    await picker(page)
      .getByRole(ROLE.textbox, { name: EDITOR.pickerRenameTemplate })
      .fill("Discarded draft");
    await picker(page)
      .getByRole(ROLE.textbox, { name: EDITOR.pickerRenameTemplate })
      .press("Escape");
    await expect(
      picker(page)
        .getByRole(ROLE.option)
        .filter({ hasText: "Renamed template" }),
    ).toHaveCount(1);
    expect(((await readLibrary(page))[0] as { name: string }).name).toBe(
      "Renamed template",
    );

    // Delete: row disappears, library empties, empty-state hint offers the
    // save path instead — and the spec is untouched (library ≠ history).
    await picker(page)
      .getByRole(ROLE.button, { name: EDITOR.pickerDeleteTemplate })
      .click();
    await expect(picker(page).getByRole(ROLE.option)).toHaveCount(0);
    await expect(
      picker(page).getByText(EDITOR.pickerTemplatesEmpty),
    ).toBeVisible();
    expect(await readLibrary(page)).toHaveLength(0);
    const entries = await readHistoryStorage(page);
    expect(entries[0].revisions).toHaveLength(1);

    // Reopening the picker still shows the empty hint (insert no longer offered).
    await page.keyboard.press("Escape");
    await expect(picker(page)).toHaveCount(0);
    await panel(page)
      .getByRole(ROLE.button, { name: EDITOR.templates })
      .filter({ visible: true })
      .click();
    await expect(
      picker(page).getByText(EDITOR.pickerTemplatesEmpty),
    ).toBeVisible();
  });
});
