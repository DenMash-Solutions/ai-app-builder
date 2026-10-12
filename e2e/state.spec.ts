import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { EDITOR, PATHS, PROMPTS, ROLE, STATE_MOCK } from "./constants";
import { mockGenerate, readHistoryStorage, waitForMsw } from "./helpers";
import { STATEFUL_UI_LINES } from "./msw/fixture";

async function generateStateful(page: Page): Promise<void> {
  await mockGenerate(page, { lines: STATEFUL_UI_LINES });
  await page.goto(PATHS.ui);
  await waitForMsw(page);
  await page.getByRole(ROLE.button, { name: PROMPTS.signIn }).click();
  // Wait for the post-generation /ui/[id] remount before enabling pick
  await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);
}

async function pickElement(page: Page, text: string) {
  await page.getByRole(ROLE.button, { name: EDITOR.pick }).click();
  await page.getByText(text, { exact: true }).click();
  const panel = page.locator("[data-editor-panel]");
  await expect(panel).toBeVisible();
  return panel;
}

test.describe("spec state seeding", () => {
  test("seeds spec.state so repeat, $state, and setState work", async ({
    page,
  }) => {
    await generateStateful(page);

    // repeat over the seeded /items array renders one element per item
    const items = page.getByText(/^Item [A-F]$/);
    await expect(items).toHaveCount(STATE_MOCK.itemLabels.length);

    // seeded revealed:false keeps the $state-gated greeting hidden
    await expect(page.getByText(STATE_MOCK.title)).toHaveCount(0);

    // setState action flips the gate; $state resolves the seeded value
    await page.getByRole(ROLE.button, { name: STATE_MOCK.reveal }).click();
    await expect(page.getByText(STATE_MOCK.title)).toBeVisible();
  });
});

test.describe("instance-scoped editing", () => {
  test("scopes prop edits to the picked repeat instance", async ({ page }) => {
    await generateStateful(page);
    const panel = await pickElement(page, "Item C");

    // scope chip: third of six visible items → state path /items/2
    const count = STATE_MOCK.itemLabels.length;
    await expect(panel.getByTestId("instance-scope")).toHaveText(
      EDITOR.instanceScope(3, count, "/items/2"),
    );

    // the ring marks the clicked instance, not the first rendered one
    const selected = page.locator("[data-jr-selected]");
    await expect(selected).toHaveCount(1);
    await expect(selected.first()).toContainText("Item C");

    // binding prop writes only items[2].label — template prop untouched
    await panel.getByLabel("text").fill("Item C edited");
    await panel.getByLabel("text").press("Enter");
    await expect(
      page.getByText("Item C edited", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Item A", { exact: true })).toBeVisible();
    await expect(page.getByText("Item B", { exact: true })).toBeVisible();

    const entries = await readHistoryStorage(page);
    expect(entries[0].revisions).toHaveLength(2);
    expect(entries[0].head).toBe(1);
    expect(entries[0].spec.elements["state-item"]?.props).toEqual({
      text: { $item: "label" },
      className: "tracking-wide",
    });
    const labels = (
      entries[0].spec.state?.items as { label: string }[] | undefined
    )?.map((item) => item.label);
    expect(labels).toEqual([
      "Item A",
      "Item B",
      "Item C edited",
      "Item D",
      "Item E",
      "Item F",
    ]);

    // undo round-trips through the revision pipeline
    await panel.getByRole(ROLE.button, { name: EDITOR.undo }).click();
    await expect(page.getByText("Item C", { exact: true })).toBeVisible();
    await expect(page.getByText("Item C edited", { exact: true })).toHaveCount(
      0,
    );

    // structure tab keeps working and warns that edits hit every instance
    await panel.getByRole(ROLE.tab, { name: EDITOR.structure }).click();
    await expect(
      panel.getByText(
        /Structure edits apply to all 6 items \(shared template\)/,
      ),
    ).toBeVisible();
  });

  test("literal props on a repeated element edit the shared template", async ({
    page,
  }) => {
    await generateStateful(page);
    const panel = await pickElement(page, "Item B");

    const count = STATE_MOCK.itemLabels.length;
    await expect(panel.getByTestId("instance-scope")).toHaveText(
      EDITOR.instanceScope(2, count, "/items/1"),
    );

    // className lives in a Collapsible, collapsed by default
    await panel
      .getByRole(ROLE.button, { name: EDITOR.classNameTrigger })
      .click();
    await panel.getByLabel("className").fill("font-bold");
    await panel.getByLabel("className").press("Enter");

    // template-level change reaches every rendered instance
    await expect(page.locator(".font-bold")).toHaveCount(count);
    await expect(page.locator(".tracking-wide")).toHaveCount(0);

    const entries = await readHistoryStorage(page);
    expect(entries[0].spec.elements["state-item"]?.props).toEqual({
      text: { $item: "label" },
      className: "font-bold",
    });
    const labels = (
      entries[0].spec.state?.items as { label: string }[] | undefined
    )?.map((item) => item.label);
    expect(labels).toEqual(STATE_MOCK.itemLabels);
  });
});
