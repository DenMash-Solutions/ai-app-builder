import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { EDITOR, PATHS, PROMPTS, ROLE, STATE_MOCK } from "./constants";
import { mockGenerate, readHistoryStorage, waitForMsw } from "./helpers";
import { STATEFUL_UI_LINES } from "./msw/fixture";

async function generateStateful(page: Page): Promise<void> {
  await mockGenerate(page, { lines: STATEFUL_UI_LINES });
  await page.goto(PATHS.ui);
  await waitForMsw(page);
  await page
    .getByRole(ROLE.button, { name: PROMPTS.signIn })
    .filter({ visible: true })
    .click();
  // Wait for the post-generation /ui/[id] remount before enabling pick
  await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);
}

async function pickElement(page: Page, text: string) {
  await page
    .getByRole(ROLE.button, { name: EDITOR.pick })
    .filter({ visible: true })
    .click();
  await page.getByText(text, { exact: true }).filter({ visible: true }).click();
  const panel = page.locator("[data-editor-panel]").filter({ visible: true });
  await expect(panel).toBeVisible();
  return panel;
}

/**
 * The greeting (`state-greeting`, gated by `visible: { $state: "/revealed" }`)
 * never renders, so it can only be reached structurally: pick a rendered
 * element, lift selection to the root through the breadcrumb, then click the
 * child row — which must carry the `visible` discovery badge.
 */
async function selectGreeting(panel: Locator) {
  await panel
    .getByRole(ROLE.tab, { name: EDITOR.structure })
    .filter({ visible: true })
    .click();
  await panel
    .getByRole(ROLE.navigation, { name: EDITOR.breadcrumb })
    .getByRole(ROLE.button, { name: "state-root" })
    .click();
  const row = panel
    .getByRole(ROLE.button)
    .filter({ hasText: "state-greeting" })
    .first();
  await expect(row).toBeVisible();
  // discovery badge must be asserted while the Structure tab still renders
  // the row — the tab content unmounts as soon as States is selected
  await expect(row.locator('[data-marker="visible"]')).toHaveCount(1);
  await row.click();
  await panel
    .getByRole(ROLE.tab, { name: EDITOR.states })
    .filter({ visible: true })
    .click();
}

test.describe("states tab", () => {
  test("badges, force-preview via override, prop edit, reset keeps spec.state", async ({
    page,
  }) => {
    await generateStateful(page);
    const before = await readHistoryStorage(page);
    const stateBefore = JSON.stringify(before[0].spec.state);

    // pick a rendered element, then lift to the root's children
    const panel = await pickElement(page, STATE_MOCK.reveal);
    await selectGreeting(panel);

    // state inspector: hidden now + the truthy condition behind it
    await expect(panel.locator("[data-state-verdict]")).toHaveAttribute(
      "data-state-verdict",
      "hidden",
    );
    await expect(panel.locator("[data-condition-path]")).toHaveValue(
      "/revealed",
    );
    await expect(panel.locator("[data-condition-operator]")).toContainText(
      "truthy",
    );
    // truthy has no operand — no value field is rendered
    await expect(panel.locator("[data-condition-value]")).toHaveCount(0);

    // force-preview: override /revealed (session-only, not a spec write)
    await panel.locator('[data-state-edit="/revealed"]').click();
    await panel.locator('[data-state-edit-input="/revealed"]').fill("true");
    await panel.locator('[data-state-edit-input="/revealed"]').press("Enter");
    await expect(
      page.getByText(STATE_MOCK.title).filter({ visible: true }),
    ).toBeVisible();
    await expect(
      panel.locator('[data-state-path="/revealed"]'),
    ).toHaveAttribute("data-state-overridden", "true");
    const resetButton = panel.locator("[data-state-reset-overrides]");
    await expect(resetButton).toBeVisible();

    // Pick mode stays engaged after a pick — press Pick again and it toggles
    // OFF, so the canvas click would only clear the selection (and unmount
    // the panel mid-tab-click). Click the revealed element directly instead.
    await expect(
      page.getByRole(ROLE.button, { name: EDITOR.pick }),
    ).toHaveAttribute("aria-pressed", "true");
    await page
      .getByText(STATE_MOCK.title, { exact: true })
      .filter({ visible: true })
      .click();
    await expect(panel).toBeVisible();

    await panel
      .getByRole(ROLE.tab, { name: EDITOR.properties })
      .filter({ visible: true })
      .click();
    await panel
      .getByRole(ROLE.combobox, { name: "variant" })
      .filter({ visible: true })
      .click();
    await page
      .getByRole(ROLE.option, { name: "caption" })
      .filter({ visible: true })
      .click();

    let entries = await readHistoryStorage(page);
    expect(entries[0].spec.elements["state-greeting"]?.props).toMatchObject({
      variant: "caption",
    });
    // the override never touched the spec's state seed
    expect(JSON.stringify(entries[0].spec.state)).toBe(stateBefore);
    expect(entries[0].revisions).toHaveLength(2);
    expect(entries[0].head).toBe(1);

    // reset drops the override: the gate closes again, spec.state untouched
    await panel
      .getByRole(ROLE.tab, { name: EDITOR.states })
      .filter({ visible: true })
      .click();
    await panel.locator("[data-state-reset-overrides]").click();
    await expect(
      page.getByText(STATE_MOCK.title).filter({ visible: true }),
    ).toHaveCount(0);
    await expect(
      panel.locator('[data-state-path="/revealed"]'),
    ).toHaveAttribute("data-state-overridden", "false");
    await expect(resetButton).toHaveCount(0);

    entries = await readHistoryStorage(page);
    expect(JSON.stringify(entries[0].spec.state)).toBe(stateBefore);
    expect(entries[0].spec.elements["state-greeting"]?.visible).toEqual({
      $state: "/revealed",
    });
    expect(entries[0].revisions).toHaveLength(2);
    expect(entries[0].head).toBe(1);
  });

  test("condition editing round-trips through the revision pipeline", async ({
    page,
  }) => {
    await generateStateful(page);
    const panel = await pickElement(page, STATE_MOCK.reveal);
    await selectGreeting(panel);

    // truthy → eq: the value field appears (kind auto-maps), then commit
    await panel.locator("[data-condition-operator]").click();
    await page
      .getByRole(ROLE.option, { name: "eq", exact: true })
      .filter({ visible: true })
      .click();
    await expect(panel.locator("[data-condition-value]")).toHaveCount(1);
    await panel.locator("[data-condition-value]").fill("true");
    await panel.locator("[data-condition-value]").press("Enter");

    let entries = await readHistoryStorage(page);
    expect(entries[0].spec.elements["state-greeting"]?.visible).toEqual({
      $state: "/revealed",
      eq: true,
    });
    // operator switch (eq "") + value commit are two undoable revisions
    expect(entries[0].revisions).toHaveLength(3);
    expect(entries[0].head).toBe(2);
    expect(entries[0].revisions?.[entries[0].head ?? 0]?.label).toBe(
      "property:visible",
    );

    // undo walks both condition edits back to the original truthy check
    await panel
      .getByRole(ROLE.button, { name: EDITOR.undo })
      .filter({ visible: true })
      .click();
    await panel
      .getByRole(ROLE.button, { name: EDITOR.undo })
      .filter({ visible: true })
      .click();

    entries = await readHistoryStorage(page);
    expect(entries[0].spec.elements["state-greeting"]?.visible).toEqual({
      $state: "/revealed",
    });
    expect(entries[0].head).toBe(0);
    await expect(panel.locator("[data-condition-operator]")).toContainText(
      "truthy",
    );
    await expect(panel.locator("[data-condition-value]")).toHaveCount(0);
    // the gate never changed visually: /revealed stayed false throughout
    await expect(
      page.getByText(STATE_MOCK.title).filter({ visible: true }),
    ).toHaveCount(0);
  });
});
