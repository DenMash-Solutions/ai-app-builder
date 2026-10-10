import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  ACTIONS,
  EDITOR,
  PATCH_OP,
  PATCH_PATH,
  PROMPTS,
  ROLE,
  SCOPE,
} from "./constants";
import {
  lastGeneratePrompt,
  mockGenerate,
  waitForMsw,
  type GenerateMockConfig,
} from "./helpers";
import { STATEFUL_UI_LINES } from "./msw/fixture";

/** Canned edit patch against the stateful fixture's repeat template. */
const STATEFUL_EDIT_LINES: string[] = [
  JSON.stringify({
    op: PATCH_OP.replace,
    path: `${PATCH_PATH.elements}/state-item/props/text`,
    value: "Edited item",
  }),
];

async function generateStateful(
  page: Page,
  config: GenerateMockConfig = {},
): Promise<void> {
  await mockGenerate(page, {
    lines: STATEFUL_UI_LINES,
    editLines: STATEFUL_EDIT_LINES,
    ...config,
  });
  await page.goto("/");
  await waitForMsw(page);
  await page.getByRole(ROLE.button, { name: PROMPTS.signIn }).click();
  await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);
}

async function enablePick(page: Page): Promise<void> {
  await page.getByRole(ROLE.button, { name: EDITOR.pick }).click();
}

async function steer(page: Page, prompt: string): Promise<void> {
  await page.getByPlaceholder("Describe the UI you want…").fill(prompt);
  await page.getByRole(ROLE.button, { name: ACTIONS.steer }).click();
}

test.describe("prompt scope chips", () => {
  test("shift+click toggles scope membership without moving the selection", async ({
    page,
  }) => {
    await generateStateful(page);
    await enablePick(page);

    await page
      .getByText("Item C", { exact: true })
      .click({ modifiers: ["Shift"] });

    const chips = page.getByTestId("prompt-scope");
    await expect(chips).toBeVisible();
    await expect(chips).toContainText(SCOPE.chip("state-item", "Text", 3, 6));
    await expect(page.locator("[data-jr-scope]")).toHaveCount(1);
    // Selection untouched: no drawer, pick stays armed
    await expect(page.locator("[data-editor-panel]")).toHaveCount(0);

    await page
      .getByText("Item E", { exact: true })
      .click({ modifiers: ["Shift"] });
    await expect(chips).toContainText(SCOPE.chip("state-item", "Text", 5, 6));
    await expect(page.locator("[data-jr-scope]")).toHaveCount(2);

    // Re-shift+click toggles the first target back off
    await page
      .getByText("Item C", { exact: true })
      .click({ modifiers: ["Shift"] });
    await expect(chips).not.toContainText(
      SCOPE.chip("state-item", "Text", 3, 6),
    );
    await expect(page.locator("[data-jr-scope]")).toHaveCount(1);
  });

  test("shift+click with pick off neither scopes nor selects", async ({
    page,
  }) => {
    await generateStateful(page);

    await page
      .getByText("Item C", { exact: true })
      .click({ modifiers: ["Shift"] });

    await expect(page.getByTestId("prompt-scope")).toHaveCount(0);
    await expect(page.locator("[data-jr-scope]")).toHaveCount(0);
    await expect(page.locator("[data-editor-panel]")).toHaveCount(0);
  });

  test("the drawer toggle adds and removes the current selection", async ({
    page,
  }) => {
    await generateStateful(page);
    await enablePick(page);
    await page.getByText("Item B", { exact: true }).click();
    await expect(page.locator("[data-editor-panel]")).toBeVisible();

    const toggle = page.getByTestId("prompt-scope-toggle");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("prompt-scope")).toContainText(
      SCOPE.chip("state-item", "Text", 2, 6),
    );
    await expect(page.locator("[data-jr-scope]")).toHaveCount(1);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("prompt-scope")).toHaveCount(0);
    await expect(page.locator("[data-jr-scope]")).toHaveCount(0);
  });

  test("a scoped steer sends the wrapper with each target's instance path", async ({
    page,
  }) => {
    await generateStateful(page);
    await enablePick(page);
    await page
      .getByText("Item B", { exact: true })
      .click({ modifiers: ["Shift"] });
    await page
      .getByText("Item C", { exact: true })
      .click({ modifiers: ["Shift"] });

    await steer(page, "Fix the labels");
    await expect(
      page.getByRole(ROLE.button, { name: ACTIONS.steer }),
    ).toBeEnabled();

    const prompt = await lastGeneratePrompt(page);
    expect(prompt).toContain("Edit only these 2 elements");
    expect(prompt).toContain(
      '1) element "state-item" (component type "Text"), instance 2 of 6, state path "/items/1"',
    );
    expect(prompt).toContain(
      '2) element "state-item" (component type "Text"), instance 3 of 6, state path "/items/2"',
    );
    expect(prompt).toContain("User request:\nFix the labels");

    // Chips survive the successful steer for iterative follow-ups
    await expect(page.getByTestId("prompt-scope")).toHaveCount(1);
    await expect(page.locator("[data-jr-scope]")).toHaveCount(2);
  });

  test("scoped elements pulse with a spinner while the model streams", async ({
    page,
  }) => {
    await generateStateful(page, { delayMs: 900 });
    await enablePick(page);
    await page
      .getByText("Item A", { exact: true })
      .click({ modifiers: ["Shift"] });

    await steer(page, "Fix the label");
    await expect(page.locator('[data-scope-loading="true"]')).toHaveCount(1);

    await expect(
      page.getByRole(ROLE.button, { name: ACTIONS.steer }),
    ).toBeEnabled();
    await expect(page.locator("[data-scope-loading]")).toHaveCount(0);
    // Highlight + chip remain after the stream
    await expect(page.locator("[data-jr-scope]")).toHaveCount(1);
    await expect(page.getByTestId("prompt-scope")).toContainText(
      SCOPE.chip("state-item", "Text", 1, 6),
    );
  });

  test("chip remove clears the target; removing the element drops its chip", async ({
    page,
  }) => {
    await generateStateful(page);
    await enablePick(page);
    await page
      .getByText("Item C", { exact: true })
      .click({ modifiers: ["Shift"] });

    // Chip ✕ removes the target
    await page
      .getByRole(ROLE.button, {
        name: SCOPE.removeChip(SCOPE.chip("state-item", "Text", 3, 6)),
      })
      .click();
    await expect(page.getByTestId("prompt-scope")).toHaveCount(0);
    await expect(page.locator("[data-jr-scope]")).toHaveCount(0);

    // Re-scope, then remove the element via the structure tab — the chip
    // drops automatically (derived against the live spec)
    await page
      .getByText("Item C", { exact: true })
      .click({ modifiers: ["Shift"] });
    await expect(page.getByTestId("prompt-scope")).toHaveCount(1);
    await page.getByText("Item C", { exact: true }).click();
    const panel = page.locator("[data-editor-panel]");
    await expect(panel).toBeVisible();
    await panel.getByRole(ROLE.tab, { name: EDITOR.structure }).click();
    await panel.getByRole(ROLE.button, { name: EDITOR.remove }).click();
    await expect(page.getByTestId("prompt-scope")).toHaveCount(0);
    await expect(page.locator("[data-jr-scope]")).toHaveCount(0);
  });

  test("an unscoped steer sends the raw prompt", async ({ page }) => {
    await generateStateful(page);

    await steer(page, "Add a footer");
    await expect(
      page.getByRole(ROLE.button, { name: ACTIONS.steer }),
    ).toBeEnabled();

    const prompt = await lastGeneratePrompt(page);
    expect(prompt).toBe("Add a footer");
  });

  test("shift+alt+click scopes the shared template of a repeated key", async ({
    page,
  }) => {
    await generateStateful(page);
    await enablePick(page);

    await page
      .getByText("Item C", { exact: true })
      .click({ modifiers: ["Shift", "Alt"] });

    const chips = page.getByTestId("prompt-scope");
    await expect(chips).toContainText(SCOPE.chipAll("state-item", "Text", 6));
    // One mark + one box per rendered instance
    await expect(page.locator("[data-jr-scope]")).toHaveCount(6);
    await expect(page.locator("[data-scope-box]")).toHaveCount(6);
    // Selection untouched: no drawer
    await expect(page.locator("[data-editor-panel]")).toHaveCount(0);

    await steer(page, "Make every item italic");
    await expect(
      page.getByRole(ROLE.button, { name: ACTIONS.steer }),
    ).toBeEnabled();

    const prompt = await lastGeneratePrompt(page);
    expect(prompt).toContain("Edit only this element");
    expect(prompt).toContain(
      'shared template of element "state-item" (component type "Text"), applies to all 6 rendered instances',
    );
    expect(prompt).not.toContain("instance ");
    expect(prompt).toContain("User request:\nMake every item italic");
    // Template chip + all six marks survive the steer
    await expect(chips).toContainText(SCOPE.chipAll("state-item", "Text", 6));
    await expect(page.locator("[data-jr-scope]")).toHaveCount(6);

    // Shift+alt+click again toggles the template off
    // The steer's mock patch rewrites the shared template text — the third
    // item is still the third wrapper, just relabeled.
    await page
      .getByText("Edited item", { exact: true })
      .nth(2)
      .click({ modifiers: ["Shift", "Alt"] });
    await expect(page.getByTestId("prompt-scope")).toHaveCount(0);
    await expect(page.locator("[data-jr-scope]")).toHaveCount(0);
  });

  test("x-ray chips pick and scope like the canvas", async ({ page }) => {
    await generateStateful(page);
    await page.getByRole(ROLE.button, { name: EDITOR.xray }).click();
    await enablePick(page);

    // Chips are interactive only while pick is armed
    await page.getByText("Item B", { exact: true }).hover();
    const chip = page.locator('[data-xray-chip="state-item"]');
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveCSS("pointer-events", "auto");

    // Chip click selects the instance → editor opens for it
    await chip.click();
    const panel = page.locator("[data-editor-panel]");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("state-item");

    // Chip shift+click scopes the hovered instance (Item C = 3rd of 6)
    await page.getByText("Item C", { exact: true }).hover();
    await page
      .locator('[data-xray-chip="state-item"]')
      .click({ modifiers: ["Shift"] });
    const chips = page.getByTestId("prompt-scope");
    await expect(chips).toContainText(SCOPE.chip("state-item", "Text", 3, 6));
    await expect(page.locator("[data-jr-scope]")).toHaveCount(1);

    // Chip shift+alt+click replaces it with the shared template
    await page.getByText("Item C", { exact: true }).hover();
    await page
      .locator('[data-xray-chip="state-item"]')
      .click({ modifiers: ["Shift", "Alt"] });
    await expect(chips).toContainText(SCOPE.chipAll("state-item", "Text", 6));
    await expect(page.locator("[data-jr-scope]")).toHaveCount(6);
    // The scope toggles never moved the editor selection
    await expect(panel).toBeVisible();

    // Pick off: chips return to pass-through
    await page.getByRole(ROLE.button, { name: EDITOR.pick }).click();
    await page.getByText("Item B", { exact: true }).hover();
    await expect(page.locator('[data-xray-chip="state-item"]')).toHaveCSS(
      "pointer-events",
      "none",
    );
  });

  test("the drawer template toggle adds and removes all instances", async ({
    page,
  }) => {
    await generateStateful(page);
    await enablePick(page);
    await page.getByText("Item B", { exact: true }).click();
    await expect(page.locator("[data-editor-panel]")).toBeVisible();

    const toggle = page.getByTestId("prompt-scope-template-toggle");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(toggle).toHaveAccessibleName(SCOPE.addAll(6));
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("prompt-scope")).toContainText(
      SCOPE.chipAll("state-item", "Text", 6),
    );
    await expect(page.locator("[data-jr-scope]")).toHaveCount(6);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByTestId("prompt-scope")).toHaveCount(0);
    await expect(page.locator("[data-jr-scope]")).toHaveCount(0);
  });

  test("template and instance scope of the same key are mutually exclusive", async ({
    page,
  }) => {
    await generateStateful(page);
    await enablePick(page);

    // Instance chip first…
    await page
      .getByText("Item B", { exact: true })
      .click({ modifiers: ["Shift"] });
    await expect(page.getByTestId("prompt-scope")).toContainText(
      SCOPE.chip("state-item", "Text", 2, 6),
    );

    // …then the template replaces it
    await page
      .getByText("Item C", { exact: true })
      .click({ modifiers: ["Shift", "Alt"] });
    await expect(page.getByTestId("prompt-scope")).toContainText(
      SCOPE.chipAll("state-item", "Text", 6),
    );
    await expect(page.getByTestId("prompt-scope")).not.toContainText(
      SCOPE.chip("state-item", "Text", 2, 6),
    );
    await expect(page.locator("[data-jr-scope]")).toHaveCount(6);

    // An instance click back replaces the template
    await page
      .getByText("Item B", { exact: true })
      .click({ modifiers: ["Shift"] });
    await expect(page.getByTestId("prompt-scope")).toContainText(
      SCOPE.chip("state-item", "Text", 2, 6),
    );
    await expect(page.getByTestId("prompt-scope")).not.toContainText(
      SCOPE.chipAll("state-item", "Text", 6),
    );
    await expect(page.locator("[data-jr-scope]")).toHaveCount(1);
  });

  test("prompt input is an expandable textarea with @ scoped mentions", async ({
    page,
  }) => {
    await generateStateful(page);
    await enablePick(page);
    await page
      .getByText("Item B", { exact: true })
      .click({ modifiers: ["Shift"] });

    const input = page.getByPlaceholder("Describe the UI you want…");

    // Shift+Enter inserts a newline instead of submitting
    await input.click();
    await input.pressSequentially("first line");
    await input.press("Shift+Enter");
    await input.pressSequentially("second line");
    await expect(input).toHaveValue("first line\nsecond line");
    await expect(page.getByTestId("mention-list")).toHaveCount(0);

    // A second instance gives the mention list two rows to navigate
    await page
      .getByText("Item D", { exact: true })
      .click({ modifiers: ["Shift"] });

    // @ opens the autocomplete over scope chips only; the option row
    // disambiguates the instance with its index and resolved content
    await input.fill("");
    await input.pressSequentially("tune @");
    const list = page.getByTestId("mention-list");
    await expect(list).toBeVisible();
    await expect(list).toContainText("state-item");
    await expect(list).toContainText("Text 2/6");
    await expect(list).toContainText("Item B");

    // The list spans exactly the input's width
    const listBox = await list.boundingBox();
    const inputBox = await input.boundingBox();
    expect(listBox).not.toBeNull();
    expect(inputBox).not.toBeNull();
    expect(listBox?.width ?? 0).toBeCloseTo(inputBox?.width ?? -1, 0);

    // Arrow keys move the highlight across options
    await input.press("ArrowDown");
    await expect(list.getByRole("option", { selected: true })).toHaveCount(1);
    await expect(list.getByRole("option", { selected: true })).toContainText(
      "Item D",
    );
    await input.press("ArrowUp");
    await expect(list.getByRole("option", { selected: true })).toContainText(
      "Item B",
    );

    // Enter picks the highlighted option and inserts the token — instance
    // chips carry their index (`#2`) so two instances stay distinguishable
    await input.press("Enter");
    await expect(list).toHaveCount(0);
    await expect(input).toHaveValue("tune @state-item#2");

    // The mirror renders the scoped token as a family-colored chip
    await expect(
      page.locator(
        '[data-testid="prompt-mirror"] [data-mention-chip="state-item#2"]',
      ),
    ).toHaveCount(1);

    // A second Enter submits — the just-inserted token never re-opens the
    // picker, so Enter falls through to the form submit
    await input.press("Enter");
    await expect(
      page.getByRole(ROLE.button, { name: ACTIONS.steer }),
    ).toBeEnabled();
    const prompt = await lastGeneratePrompt(page);
    // The `#2` suffix maps the mention back to the wrapper's "instance 2"
    expect(prompt).toContain("tune @state-item#2");
    expect(prompt).toContain("instance 2 of 6");
  });
});
