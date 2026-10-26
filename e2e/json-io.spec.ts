import { expect, test } from "@playwright/test";
import {
  JSON_IO,
  PATHS,
  ROLE,
  SLOTS,
  UI,
  historyButtonName,
} from "./constants";
import { readHistoryStorage } from "./helpers";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const IMPORTED_SPEC = {
  root: "page",
  elements: {
    page: {
      type: "Stack",
      props: {
        direction: "vertical",
        gap: "md",
        className: "p-8",
      },
      children: ["title"],
    },
    title: {
      type: "Heading",
      props: { text: "Imported works" },
    },
  },
};

// Big enough to overflow the fixed-height dialog textarea (h-64 = 256px of
// ~16px lines needs >16 lines; 30 padded items ≈ 130+ lines).
const BIG_SPEC = JSON.stringify(
  {
    ...IMPORTED_SPEC,
    state: {
      items: Array.from({ length: 30 }, (_, index) => ({
        id: index,
        label: `Padded item ${index} — long label text `.repeat(3),
      })),
    },
  },
  null,
  2,
);

test.describe("json import/export", () => {
  test("import lives in the history drawer: validates, scrolls, renders, saves history; row export copies the spec", async ({
    page,
  }) => {
    await page.goto(PATHS.ui);
    await page.waitForLoadState("networkidle");

    const drawer = page.locator(SLOTS.drawer).filter({ visible: true });
    const dialog = page.locator(SLOTS.dialog).filter({ visible: true });

    // Canvas is empty — no rail, no pick; the drawer is the json-io surface.
    await expect(
      page.getByText(UI.emptyState).filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole(ROLE.button, { name: JSON_IO.pick })
        .filter({ visible: true }),
    ).toHaveCount(0);

    // History is reachable on an empty canvas (only the badge is conditional).
    await page
      .getByRole(ROLE.button, { name: historyButtonName() })
      .filter({ visible: true })
      .click();
    await expect(drawer).toBeVisible();
    await expect(
      drawer.getByText(UI.historyEmpty).filter({ visible: true }),
    ).toBeVisible();

    const importButton = drawer
      .getByRole(ROLE.button, {
        name: JSON_IO.import,
      })
      .filter({ visible: true });
    await expect(importButton).toBeEnabled();

    // Invalid JSON → inline error, dialog stays open, text preserved.
    await importButton.click();
    await expect(dialog).toBeVisible();
    const textarea = page
      .getByRole(ROLE.textbox, {
        name: JSON_IO.dialogTitle,
      })
      .filter({ visible: true });
    // Catches ICU parse failures: next-intl would log INVALID_MESSAGE and
    // render the key path as fallback instead of the real-brace placeholder.
    await expect(textarea).toHaveAttribute("placeholder", JSON_IO.placeholder);
    await textarea.fill("{oops");
    await dialog
      .getByRole(ROLE.button, { name: JSON_IO.importConfirm, exact: true })
      .filter({ visible: true })
      .click();
    await expect(
      dialog
        .getByText(JSON_IO.invalidJson, { exact: true })
        .filter({ visible: true }),
    ).toBeVisible();
    await expect(textarea).toHaveValue("{oops");
    // The nested dialog must not dismiss the drawer behind it.
    await expect(drawer).toBeVisible();

    // Fixed-height scrollable textarea: big pastes never grow the dialog.
    await textarea.fill(BIG_SPEC);
    const box = await textarea.evaluate((element) => {
      const area = element as HTMLTextAreaElement;
      return {
        height: area.offsetHeight,
        scrollHeight: area.scrollHeight,
        clientHeight: area.clientHeight,
      };
    });
    expect(box.height).toBeLessThanOrEqual(272);
    expect(box.scrollHeight).toBeGreaterThan(box.clientHeight);

    // Valid spec → dialog and drawer close, renders on /ui/[id], lands in history.
    await dialog
      .getByRole(ROLE.button, { name: JSON_IO.importConfirm, exact: true })
      .filter({ visible: true })
      .click();
    await expect(dialog).toBeHidden();
    await expect(drawer).toBeHidden();
    await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);
    await expect(
      page
        .getByRole(ROLE.heading, { name: "Imported works" })
        .filter({ visible: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole(ROLE.button, { name: historyButtonName(1) })
        .filter({ visible: true }),
    ).toBeVisible();

    const stored = await readHistoryStorage(page);
    expect(stored).toHaveLength(1);
    expect(stored[0].prompt).toBe(JSON_IO.importedEntry);
    expect(stored[0].spec.root).toBe("page");

    // Row export: copies that entry's pretty-printed spec incl. state.
    await page
      .getByRole(ROLE.button, { name: historyButtonName(1) })
      .filter({ visible: true })
      .click();
    await expect(drawer).toBeVisible();
    await drawer
      .getByRole(ROLE.button, {
        name: JSON_IO.entryExport(JSON_IO.importedEntry),
        exact: true,
      })
      .filter({ visible: true })
      .click();
    await expect(
      page.getByText(JSON_IO.copied, { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    const parsed = JSON.parse(copied) as { root: string };
    expect(parsed.root).toBe("page");
    expect(copied).toContain("\n  ");
    expect(copied).toContain("Padded item 0");
  });
});
