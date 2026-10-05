import { expect, test } from "@playwright/test";
import { ACTIONS, PROMPTS, ROLE, UI } from "./constants";

test.describe("responsive", () => {
  test("header actions collapse into a popover and chips fit the viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await page.goto("/");

    const trigger = page.getByRole(ROLE.button, { name: ACTIONS.openMenu });
    await expect(trigger).toBeVisible();

    await trigger.click();
    const history = page.getByRole(ROLE.button, { name: ACTIONS.history });
    await expect(history).toBeVisible();
    await history.click();
    const close = page.getByRole(ROLE.button, { name: ACTIONS.close });
    await expect(close).toBeVisible();
    await close.click();

    const subtitle = page.getByText(UI.subtitle);
    const subtitleBox = await subtitle.boundingBox();
    expect(subtitleBox).not.toBeNull();
    if (!subtitleBox) throw new Error("subtitle has no bounding box");
    expect(subtitleBox.x).toBeGreaterThanOrEqual(0);
    expect(subtitleBox.x + subtitleBox.width).toBeLessThanOrEqual(375);

    const chip = page.getByRole(ROLE.button, { name: PROMPTS.dentalSpanish });
    await expect(chip).toBeVisible();
    const box = await chip.boundingBox();
    expect(box).not.toBeNull();
    if (!box) throw new Error("chip has no bounding box");
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);

    const fitsViewport = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(fitsViewport).toBe(true);
  });
});
