import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import en from "@/lib/i18n/locale/en.json";
import { EDITOR, PATHS, PROMPTS, ROLE } from "./constants";
import { FILTER_UI_LINES } from "./msw/fixture";
import { mockGenerate, waitForMsw } from "./helpers";

const DP = en.playground.devicePreview;

/** Frame label is ICU-templated (`{width} × {height}`) — render it here. */
const SIZE_LABEL = DP.sizeLabel
  .replace("{width}", "390")
  .replace("{height}", "844");

const FRAME = "[data-device-frame-iframe]";

/**
 * The FILTER fixture renders a responsive ladder
 * (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-5`): 5 tracks at the desktop
 * viewport, 1 track at 390px — the media-query proof (plan 059 verification).
 * frameLocator scopes assertions to the frame; main-document assertions go
 * through document queries scoped to VISIBLE canvases (see
 * `mainCanvasCount` — Activity keeps hidden previous routes in the DOM).
 */
function trackCount(scope: Locator) {
  return scope.evaluate(
    (el) => getComputedStyle(el).gridTemplateColumns.trim().split(/\s+/).length,
  );
}

/**
 * How many canvases are VISIBLE in the MAIN document. Scope to visibility
 * because Next 16 Cache Components keeps up to 3 routes mounted via React's
 * `<Activity>` (`display: none` — `preserving-ui-state.md`): after the
 * `/ui` → `/ui/[ref]` navigation the previous route's canvas still exists
 * in the DOM, so a raw count would always include it. Never matches the
 * frame's canvas (separate document).
 */
function mainCanvasCount(page: Page) {
  return page.evaluate(
    () =>
      Array.from(document.querySelectorAll("[data-canvas-surface]")).filter(
        (el) => el.getClientRects().length > 0,
      ).length,
  );
}

async function generate(page: Page): Promise<void> {
  await mockGenerate(page, { lines: FILTER_UI_LINES });
  await page.goto(PATHS.ui);
  await waitForMsw(page);
  await page
    .getByRole(ROLE.button, { name: PROMPTS.signIn })
    .filter({ visible: true })
    .click();
  await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);
}

async function pickPreset(page: Page, name: string): Promise<void> {
  const trigger = page
    .getByRole(ROLE.button, { name: DP.open })
    .filter({ visible: true });
  const radio = page.getByRole("radio", { name });
  // The popover does NOT close itself on selection, so blindly clicking the
  // trigger on a later pick would toggle it shut (the radio then resolves
  // mid-exit-animation and detaches). Open only when needed, close after.
  if ((await radio.count()) === 0) await trigger.click();
  await radio.click();
  if ((await radio.count()) > 0) {
    await trigger.click();
    await expect(radio).toHaveCount(0);
  }
}

test.describe("device preview", () => {
  // The 844px Mobile frame must fit the stage: Playwright's default 1280×720
  // would clip it (fit-scaling lands in plan 059 step 2).
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("Mobile preset gives a true CSS viewport; Responsive is inline again", async ({
    page,
  }) => {
    await generate(page);

    // Inline baseline at 1440px: `lg:` applies → 5 tracks.
    const inlineGrid = page.locator("[data-canvas] div.grid").first();
    await expect(inlineGrid).toBeVisible();
    expect(await trackCount(inlineGrid)).toBe(5);

    await pickPreset(page, DP.mobile);

    // Exact CSS viewport — the iframe border must not shrink it (content-box).
    const iframe = page.locator(FRAME);
    await expect(iframe).toBeVisible();
    const viewport = await iframe.evaluate((el) => {
      const win = (el as HTMLIFrameElement).contentWindow!;
      return {
        width: win.innerWidth,
        height: win.innerHeight,
        mobileQuery: win.matchMedia("(max-width: 390px)").matches,
      };
    });
    expect(viewport).toEqual({ width: 390, height: 844, mobileQuery: true });

    // …while the parent stays desktop.
    expect(
      await page.evaluate(
        () => window.matchMedia("(max-width: 390px)").matches,
      ),
    ).toBe(false);

    // The responsive ladder follows the FRAME viewport: 1 track at 390px.
    const frameGrid = page.frameLocator(FRAME).locator("div.grid").first();
    await expect(frameGrid).toBeVisible();
    expect(await trackCount(frameGrid)).toBe(1);

    // The canvas moved out of the parent document, chrome stayed behind.
    // Activity keeps the PREVIOUS route's canvas in the DOM (hidden) — the
    // poll therefore counts VISIBLE main-document canvases only. The portal
    // move lands a tick after the radio click → poll, don't snapshot.
    await expect.poll(() => mainCanvasCount(page)).toBe(0);
    await expect(page.locator("[data-device-frame-label]")).toHaveText(
      SIZE_LABEL,
    );
    await expect(
      page.getByRole(ROLE.button, { name: EDITOR.pick }),
    ).toBeVisible();

    // Back to Responsive: iframe gone, inline rendering restored, `lg:` back.
    await pickPreset(page, DP.responsive);
    await expect(page.locator(FRAME)).toHaveCount(0);
    await expect.poll(() => mainCanvasCount(page)).toBe(1);
    await expect.poll(() => trackCount(inlineGrid)).toBe(5);
  });

  test("pick inside the frame opens the panel outside; Escape bridges realms", async ({
    page,
  }) => {
    await generate(page);
    await pickPreset(page, DP.mobile);
    await expect(page.locator(FRAME)).toBeVisible();

    // Pick inside the frame — hit-testing must run in the frame's document (R3).
    await page
      .getByRole(ROLE.button, { name: EDITOR.pick })
      .filter({ visible: true })
      .click();
    const frame = page.frameLocator(FRAME);
    await expect(frame.locator(".jr-pick-enabled")).toHaveCount(1);
    await frame.locator('input[name="search"]').click();

    // page.locator only matches the TOP document → the panel opened outside.
    const panel = page.locator("[data-editor-panel]");
    await expect(panel).toBeVisible();
    await expect(page.locator(FRAME)).toBeVisible();

    // R3 keyboard bridge: with focus inside the frame, Escape reaches the
    // host handler — the cascade shortcuts.spec pins down (panel first, pick
    // second) now works across the frame realm.
    await frame.locator('input[name="search"]').focus();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(frame.locator(".jr-pick-enabled")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(frame.locator(".jr-pick-enabled")).toHaveCount(0);

    // The frame survives the interaction and Responsive restores the inline canvas.
    await pickPreset(page, DP.responsive);
    await expect(page.locator(FRAME)).toHaveCount(0);
    await expect.poll(() => mainCanvasCount(page)).toBe(1);
  });

  test("the preset persists across reloads", async ({ page }) => {
    await generate(page);
    await pickPreset(page, DP.mobile);
    await expect(page.locator(FRAME)).toBeVisible();

    await page.reload();
    await waitForMsw(page);
    await expect(page.locator(FRAME)).toBeVisible();
    const width = await page
      .locator(FRAME)
      .evaluate((el) => (el as HTMLIFrameElement).contentWindow!.innerWidth);
    expect(width).toBe(390);
  });

  test("Desktop is a fixed 1440×900 artboard the stage scrolls to reach", async ({
    page,
  }) => {
    await generate(page);
    await pickPreset(page, DP.desktop);

    const iframe = page.locator(FRAME);
    await expect(iframe).toBeVisible();
    const viewport = await iframe.evaluate((el) => {
      const win = (el as HTMLIFrameElement).contentWindow!;
      return { width: win.innerWidth, height: win.innerHeight };
    });
    expect(viewport).toEqual({ width: 1440, height: 900 });

    // Fixed ≠ responsive: the artboard ignores the window. Shrinking the
    // parent below `lg:` flips the PARENT's media queries while the frame
    // keeps rendering the 1440px layout (5 tracks) — media queries follow
    // the frame, not the browser window.
    await page.setViewportSize({ width: 900, height: 700 });
    await expect(iframe).toBeVisible();
    const afterResize = await iframe.evaluate(
      (el) => (el as HTMLIFrameElement).contentWindow!.innerWidth,
    );
    expect(afterResize).toBe(1440);
    expect(
      await page.evaluate(
        () => window.matchMedia("(min-width: 1024px)").matches,
      ),
    ).toBe(false);
    const frameGrid = page.frameLocator(FRAME).locator("div.grid").first();
    await expect(frameGrid).toBeVisible();
    expect(await trackCount(frameGrid)).toBe(5);

    // Oversized frame is reachable: the stage scrolls instead of clipping.
    const stage = page.locator("[data-device-frame]");
    await expect(stage).toBeVisible();
    const overflow = await stage.evaluate((el) => ({
      client: el.clientWidth,
      scroll: el.scrollWidth,
    }));
    expect(overflow.scroll).toBeGreaterThan(overflow.client);

    const reach = await stage.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
      el.scrollTop = el.scrollHeight;
      return {
        x: el.scrollLeft,
        maxX: el.scrollWidth - el.clientWidth,
        y: el.scrollTop,
        maxY: el.scrollHeight - el.clientHeight,
      };
    });
    expect(reach.x).toBeGreaterThan(0);
    expect(reach.y).toBeGreaterThan(0);
    expect(reach.x).toBe(reach.maxX);
    expect(reach.y).toBe(reach.maxY);

    // Scrolled to the far corner, the frame's far edges sit inside the
    // stage viewport — every part of the artboard is reachable.
    const stageBox = await stage.boundingBox();
    const frameBox = await iframe.boundingBox();
    expect(stageBox).not.toBeNull();
    expect(frameBox).not.toBeNull();
    expect(frameBox!.x + frameBox!.width).toBeLessThanOrEqual(
      stageBox!.x + stageBox!.width + 1,
    );
    expect(frameBox!.y + frameBox!.height).toBeLessThanOrEqual(
      stageBox!.y + stageBox!.height + 1,
    );

    // Back to the inline default.
    await pickPreset(page, DP.responsive);
    await expect(page.locator(FRAME)).toHaveCount(0);
    await expect.poll(() => mainCanvasCount(page)).toBe(1);
  });
});
