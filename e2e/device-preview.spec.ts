import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import en from "@/lib/i18n/locale/en.json";
import {
  ACTIONS,
  EDITOR,
  PATHS,
  PATCH_OP,
  PATCH_PATH,
  PROMPTS,
  ROLE,
  dndGhostLabel,
} from "./constants";
import { FILTER_UI_LINES, SELECT_UI_LINES } from "./msw/fixture";
import {
  generateCalls,
  mockGenerate,
  readHistoryStorage,
  waitForMsw,
} from "./helpers";

const DP = en.playground.devicePreview;

/** Frame label is ICU-templated (`{width} × {height}`) — render it here. The
 * zoom chip (step 2) appends a nondeterministic fit percent, so the size is
 * asserted as a substring and the zoom chip separately. */
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

async function generate(
  page: Page,
  lines: string[] = FILTER_UI_LINES,
): Promise<void> {
  await mockGenerate(page, { lines });
  await page.goto(PATHS.ui);
  await waitForMsw(page);
  await page
    .getByRole(ROLE.button, { name: PROMPTS.signIn })
    .filter({ visible: true })
    .click();
  await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);
}

/** The picker trigger's open state — flips atomically with the popover, unlike
 * the radio count, which stays >0 through the exit animation (a radio counted
 * mid-teardown resolves, then detaches under the click). */
function pickerTrigger(page: Page) {
  const trigger = page
    .getByRole(ROLE.button, { name: DP.open })
    .filter({ visible: true });
  const content = page.locator('[data-slot="popover-content"]');
  return {
    trigger,
    open: async () => {
      if ((await trigger.getAttribute("aria-expanded")) !== "true") {
        await trigger.click();
        await expect(trigger).toHaveAttribute("aria-expanded", "true");
      }
      await expect(content).toBeVisible();
    },
    close: async () => {
      if ((await trigger.getAttribute("aria-expanded")) === "true") {
        await trigger.click();
        await expect(trigger).toHaveAttribute("aria-expanded", "false");
      }
      // Wait out the exit animation so the next open can't race a detaching
      // radio (Radix keeps the content mounted until animate-out finishes).
      await expect(content).toHaveCount(0);
    },
  };
}

async function pickOption(page: Page, name: string): Promise<void> {
  const picker = pickerTrigger(page);
  const radio = page.getByRole("radio", { name, exact: true });
  // The popover does NOT close itself on selection, so open only when the
  // trigger says closed, select, then close and wait for full unmount.
  await picker.open();
  await expect(radio).toBeVisible();
  await radio.click();
  await expect(radio).toBeChecked();
  await picker.close();
}

/**
 * Custom preset committed to an exact viewport. The preset's default
 * (420×900) is taller than the fixture's content, so scroll assertions need a
 * deliberately short height — commit via Enter and wait for the frame to
 * report the new CSS viewport before returning.
 */
async function pickCustom(
  page: Page,
  width: number,
  height: number,
): Promise<void> {
  const picker = pickerTrigger(page);
  await picker.open();
  const custom = page.getByRole("radio", { name: DP.custom, exact: true });
  await custom.click();
  await expect(custom).toBeChecked();

  const content = page.locator('[data-slot="popover-content"]');
  for (const [label, value] of [
    [DP.customWidth, String(width)],
    [DP.customHeight, String(height)],
  ] as const) {
    const input = content.getByLabel(label);
    await input.fill(value);
    await input.press("Enter");
  }
  await picker.close();

  const iframe = page.locator(FRAME);
  await expect(iframe).toBeVisible();
  await expect
    .poll(() =>
      iframe.evaluate((el) => {
        const win = (el as HTMLIFrameElement).contentWindow!;
        return `${win.innerWidth}x${win.innerHeight}`;
      }),
    )
    .toBe(`${width}x${height}`);
}

test.describe("device preview", () => {
  // Fit (the default zoom) scales the 844px Mobile frame down to the stage,
  // but the scroll-fallback assertions need a stage smaller than the frame
  // — the fixed 1280×720 default is borderline; pin a generous viewport.
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("Mobile preset gives a true CSS viewport; Responsive is inline again", async ({
    page,
  }) => {
    await generate(page);

    // Inline baseline at 1440px: `lg:` applies → 5 tracks.
    const inlineGrid = page.locator("[data-canvas] div.grid").first();
    await expect(inlineGrid).toBeVisible();
    expect(await trackCount(inlineGrid)).toBe(5);

    await pickOption(page, DP.mobile);

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
    await expect(page.locator("[data-device-frame-label]")).toContainText(
      SIZE_LABEL,
    );
    // Default zoom is fit-to-screen — the chip reports the effective scale
    // (nondeterministic: the stage size decides it).
    await expect(page.locator("[data-device-frame-zoom]")).toHaveText(
      /^fit \d+%$/,
    );
    await expect(
      page.getByRole(ROLE.button, { name: EDITOR.pick }),
    ).toBeVisible();

    // Back to Responsive: iframe gone, inline rendering restored, `lg:` back.
    await pickOption(page, DP.responsive);
    await expect(page.locator(FRAME)).toHaveCount(0);
    await expect.poll(() => mainCanvasCount(page)).toBe(1);
    await expect.poll(() => trackCount(inlineGrid)).toBe(5);
  });

  test("pick inside the frame opens the panel outside; Escape bridges realms", async ({
    page,
  }) => {
    await generate(page);
    await pickOption(page, DP.mobile);
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
    await pickOption(page, DP.responsive);
    await expect(page.locator(FRAME)).toHaveCount(0);
    await expect.poll(() => mainCanvasCount(page)).toBe(1);
  });

  test("the preset persists across reloads", async ({ page }) => {
    await generate(page);
    await pickOption(page, DP.mobile);
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
    await pickOption(page, DP.desktop);

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

    // Fit (default) is the first line of defense: scaled to the stage, the
    // artboard needs no scrolling at all (the ResizeObserver lands the new
    // scale after the viewport resize — poll, don't snapshot).
    await expect(page.locator("[data-device-frame-zoom]")).toHaveText(
      /^fit \d+%$/,
    );
    const stage = page.locator("[data-device-frame]");
    await expect(stage).toBeVisible();
    await expect
      .poll(() => stage.evaluate((el) => el.scrollWidth - el.clientWidth))
      .toBeLessThanOrEqual(0);

    // Pin 100%: the documented fallback — the stage scrolls instead of
    // clipping an oversized frame (R5).
    await pickOption(page, "100%");

    // Oversized frame is reachable: the stage scrolls instead of clipping.
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
    await pickOption(page, DP.responsive);
    await expect(page.locator(FRAME)).toHaveCount(0);
    await expect.poll(() => mainCanvasCount(page)).toBe(1);
  });

  test("zoom steps scale the frame without changing its CSS viewport", async ({
    page,
  }) => {
    await generate(page);
    await pickOption(page, DP.mobile);
    const iframe = page.locator(FRAME);
    await expect(iframe).toBeVisible();

    // Visual width = (viewport 390 + 1px border each side) × scale.
    const visualWidth = async () => (await iframe.boundingBox())!.width;
    const cssViewport = () =>
      iframe.evaluate(
        (el) => (el as HTMLIFrameElement).contentWindow!.innerWidth,
      );

    // Fit (default): scaled to the stage, viewport stays exactly 390.
    await expect(page.locator("[data-device-frame-zoom]")).toHaveText(
      /^fit \d+%$/,
    );
    const fitWidth = await visualWidth();
    expect(await cssViewport()).toBe(390);

    // 100% = the unscaled artboard (390 + 2px border).
    await pickOption(page, "100%");
    await expect(page.locator("[data-device-frame-zoom]")).toHaveText("100%");
    await expect.poll(async () => Math.round(await visualWidth())).toBe(392);
    expect(await cssViewport()).toBe(390);

    // 50% halves the surface — the CSS viewport never moves with the zoom
    // (safeguard 4: transform-only scaling, breakpoints stay device-true).
    await pickOption(page, "50%");
    await expect(page.locator("[data-device-frame-zoom]")).toHaveText("50%");
    await expect.poll(async () => Math.round(await visualWidth())).toBe(196);
    expect(await cssViewport()).toBe(390);

    // Back to fit — same stage, same fitted scale.
    await pickOption(page, DP.zoomFit);
    await expect(page.locator("[data-device-frame-zoom]")).toHaveText(
      /^fit \d+%$/,
    );
    await expect
      .poll(async () => Math.round(await visualWidth()))
      .toBe(Math.round(fitWidth));
    expect(await cssViewport()).toBe(390);
  });

  test("transitions preserve selection and scroll; rapid switching never duplicates the frame", async ({
    page,
  }) => {
    await generate(page);

    // --- R1: selection lives ABOVE the portal boundary ---
    // Custom 420×320, not Mobile: the fixture's content doesn't overflow
    // 844px (the surface stretches to min-height:100%), so a scroll offset
    // only exists once the viewport is deliberately shorter than the content.
    await pickCustom(page, 420, 320);
    await pickOption(page, "100%");
    await page
      .getByRole(ROLE.button, { name: EDITOR.pick })
      .filter({ visible: true })
      .click();
    const frame = page.frameLocator(FRAME);
    await frame.locator('input[name="search"]').click();
    const panel = page.locator("[data-editor-panel]");
    await expect(panel).toBeVisible();

    // --- R1: canvas scroll offset survives the frame ↔ inline remount ---
    // The portal move recreates the scroller in the other document; the
    // playground carries scrollTop across (onScroll → ref → restore).
    const scroller = frame.locator(".jr-pick-enabled");
    const before = await scroller.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      return el.scrollTop;
    });
    expect(before).toBeGreaterThan(0);

    await pickOption(page, DP.responsive);
    await expect(page.locator(FRAME)).toHaveCount(0);
    await expect(panel).toBeVisible(); // selection never left

    // Back to the SAME overflowing viewport — Mobile's 844px wouldn't clamp
    // to the saved offset at all (no overflow → scrollTop 0 by definition).
    await pickOption(page, DP.custom);
    await expect
      .poll(() =>
        frame
          .locator(".jr-pick-enabled")
          .evaluate((el) => Math.round(el.scrollTop)),
      )
      .toBe(Math.round(before));
    await expect(panel).toBeVisible();

    // --- R2: switching mid-init never orphans or duplicates a frame ---
    await pickOption(page, DP.responsive);
    await pickOption(page, DP.mobile); // frame still initializing…
    await pickOption(page, DP.responsive); // …immediately torn down
    await pickOption(page, DP.tablet); // …and superseded
    const iframes = page.locator(FRAME);
    await expect.poll(() => iframes.count()).toBe(1);
    const width = await iframes.evaluate(
      (el) => (el as HTMLIFrameElement).contentWindow!.innerWidth,
    );
    expect(width).toBe(768);
    // No half-initialized frame ever reports ready (error state = residue).
    await expect(page.locator("[data-device-frame-error]")).toHaveCount(0);
    await expect(panel).toBeVisible();
  });

  test("R1/R3: an in-flight stream, a typed edit, and hover/drag survive preset switches", async ({
    page,
  }) => {
    await mockGenerate(page, {
      lines: FILTER_UI_LINES,
      // Steer (edit) response: retarget a prop the FILTER fixture actually
      // has — MOCK_EDIT_LINES patches the MOCK key set, not this fixture.
      editLines: [
        JSON.stringify({
          op: PATCH_OP.replace,
          path: `${PATCH_PATH.elements}/filter-input/props/placeholder`,
          value: "Streamed update",
        }),
      ],
    });
    await page.goto(PATHS.ui);
    await waitForMsw(page);
    await page
      .getByRole(ROLE.button, { name: PROMPTS.signIn })
      .filter({ visible: true })
      .click();
    await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);

    // Inline baseline — the steered stream starts HERE, in the parent document.
    await pickOption(page, DP.responsive);
    const frame = page.frameLocator(FRAME);
    const inlineSearch = page
      .locator('input[name="search"]')
      .filter({ visible: true });
    await expect(inlineSearch).toHaveAttribute("placeholder", "Filter by name");

    // --- R1: switch to the frame WHILE the stream is in flight ---
    await page.evaluate(() => {
      // Delay only the upcoming request: the initial generation already
      // completed, and the preset switch must fit inside the flight window.
      (
        window as unknown as { __GENERATE_MOCK__: { delayMs: number } }
      ).__GENERATE_MOCK__.delayMs = 3000;
    });
    await page
      .getByPlaceholder(en.playground.promptPlaceholder)
      .filter({ visible: true })
      .fill("Refresh the search hint");
    await page
      .getByRole(ROLE.button, { name: ACTIONS.steer })
      .filter({ visible: true })
      .click();
    // In flight: the delay guarantees the old spec is still painted…
    await expect(inlineSearch).toHaveAttribute("placeholder", "Filter by name");
    await pickOption(page, DP.mobile); // …mid-stream the canvas moves house
    // …and the stream lands in the FRAME: one request, one completion.
    await expect(frame.locator('input[name="search"]')).toHaveAttribute(
      "placeholder",
      "Streamed update",
    );
    expect(await generateCalls(page)).toBe(2);

    // --- R1: an in-progress edit survives the next switch ---
    await page
      .getByRole(ROLE.button, { name: EDITOR.pick })
      .filter({ visible: true })
      .click();
    await frame.locator('input[name="search"]').click();
    const panel = page.locator("[data-editor-panel]");
    await expect(panel).toBeVisible();
    const draftField = panel.getByLabel("placeholder");
    await expect(draftField).toHaveValue("Streamed update");
    await draftField.fill("Draft edit survives"); // no Enter — blur commits
    await pickOption(page, DP.tablet);
    await expect(panel).toBeVisible(); // selection never left
    await expect(draftField).toHaveValue("Draft edit survives");
    await expect(frame.locator('input[name="search"]')).toHaveAttribute(
      "placeholder",
      "Draft edit survives",
    );

    // --- R3: hover badge inside the 50%-scaled frame ---
    await pickOption(page, "50%");
    await frame.locator('[data-jr-key="filter-input"]').hover();
    const badge = frame.locator("[data-editor-badge]");
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("filter-input");

    // --- R3: drag arms and drops inside the 50%-scaled frame ---
    // Leave pick first so the edit panel can't cover drop targets (as in
    // editor.spec) — and pointerdown must reach the realm-safe dnd handler.
    await page
      .getByRole(ROLE.button, { name: EDITOR.pick })
      .filter({ visible: true })
      .click();
    await expect(page.locator("[data-editor-panel]")).toHaveCount(0);
    await page
      .getByRole(ROLE.button, { name: EDITOR.dragdrop })
      .filter({ visible: true })
      .click();
    await expect(frame.locator(".jr-dnd")).toHaveCount(1);

    // Wrappers paint no box — measure the element child (editor.spec pattern);
    // boundingBox rides Playwright's frame-quad pipeline, same as the clicks
    // that already land at 50%.
    const box = async (key: string) => {
      const bounds = await frame
        .locator(`[data-jr-key="${key}"] > *`)
        .first()
        .boundingBox();
      if (!bounds) throw new Error(`no bounding box for ${key}`);
      return bounds;
    };
    const grid = await box("filter-grid");
    const input = await box("filter-input");
    const start = { x: grid.x + grid.width / 2, y: grid.y + grid.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 10, start.y); // cross the 5px threshold
    await page.mouse.move(
      input.x + input.width / 2,
      input.y + input.height * 0.15,
      { steps: 6 },
    );
    const ghost = frame.locator("[data-dnd-ghost]");
    await expect(ghost).toHaveAttribute(
      "aria-label",
      dndGhostLabel("filter-grid"),
    );
    await expect(frame.locator('[data-dnd-zone="before"]')).toBeAttached();
    await page.mouse.up();
    await expect(ghost).toHaveCount(0);
    // filter-root reordered: the grid now precedes the input — assert the
    // spec contract (editor.spec pattern) and its rendering in document order.
    const entries = await readHistoryStorage(page);
    expect(entries[0].spec.elements["filter-root"]?.children).toEqual([
      "filter-grid",
      "filter-input",
    ]);
    await expect
      .poll(() =>
        frame
          .locator('[data-jr-key="filter-root"]')
          .evaluate((el) =>
            Array.from(
              el.querySelectorAll(
                '[data-jr-key="filter-grid"], [data-jr-key="filter-input"]',
              ),
            ).map((node) => node.getAttribute("data-jr-key")),
          ),
      )
      .toEqual(["filter-grid", "filter-input"]);
  });

  test("pick hit-testing works at every zoom step; frame style/theme parity holds", async ({
    page,
  }) => {
    // Fresh session per step — no selection-state ambiguity across rounds.
    for (const step of ["50%", "100%", "150%"]) {
      await generate(page);
      await pickOption(page, DP.mobile);
      await pickOption(page, step);
      await page
        .getByRole(ROLE.button, { name: EDITOR.pick })
        .filter({ visible: true })
        .click();
      const frame = page.frameLocator(FRAME);
      await expect(frame.locator(".jr-pick-enabled")).toHaveCount(1);
      // Clicks must land inside the TRANSFORMED iframe (R3: rect math and
      // elementFromPoint run in the frame realm — zoom-scaled coordinates).
      await frame.locator('input[name="search"]').click();
      await expect(page.locator("[data-editor-panel]")).toBeVisible();
      await expect(page.locator(FRAME)).toBeVisible();
    }

    // R4 parity: same stylesheet set as the parent head (none missing, no
    // duplicates) and mirrored root theme/lang attributes.
    const parity = () =>
      page.evaluate(() => {
        const iframe = document.querySelector(
          "iframe[data-device-frame-iframe]",
        ) as HTMLIFrameElement;
        const count = (doc: Document) =>
          doc.querySelectorAll('head > style, head > link[rel="stylesheet"]')
            .length;
        const frameDoc = iframe.contentDocument!;
        return {
          parent: count(document),
          frame: count(frameDoc),
          htmlClass:
            document.documentElement.className ===
            frameDoc.documentElement.className,
          bodyClass: document.body.className === frameDoc.body.className,
          lang: document.documentElement.lang === frameDoc.documentElement.lang,
        };
      });
    // The mirror is delta-synced and rAF-coalesced — poll, don't snapshot.
    await expect
      .poll(async () => {
        const p = await parity();
        return p.parent === p.frame && p.htmlClass && p.bodyClass && p.lang;
      })
      .toBe(true);
  });

  test("a11y: frame title, keyboard radios, focus flow; teardown leaves no residue", async ({
    page,
  }) => {
    await generate(page);
    await pickOption(page, DP.mobile);
    const iframe = page.locator(FRAME);
    await expect(iframe).toBeVisible();

    // WCAG frame requirement: every embedded frame carries an accessible name.
    await expect(iframe).toHaveAttribute("title", DP.label);

    // Sane focus flow in: the frame is programmatically focusable (from
    // here, Tab walks into the frame document natively — iframes always
    // expose their nested browsing context to sequential focus).
    const focused = await iframe.evaluate((el) => {
      (el as HTMLIFrameElement).focus();
      return document.activeElement === el;
    });
    expect(focused).toBe(true);

    // Picker is keyboard-operable: arrows walk the native radio group
    // (free keyboard support, plan scope item 5) and the change event
    // actually switches the preset.
    const trigger = page
      .getByRole(ROLE.button, { name: DP.open })
      .filter({ visible: true });
    await trigger.click();
    await page.getByRole("radio", { name: DP.mobile, exact: true }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(
      page.getByRole("radio", { name: DP.tablet, exact: true }),
    ).toBeChecked();
    await expect
      .poll(() =>
        iframe.evaluate(
          (el) => (el as HTMLIFrameElement).contentWindow!.innerWidth,
        ),
      )
      .toBe(768);
    await trigger.click(); // close the popover

    // Teardown stability (safeguard 6): repeated enter/leave — Strict-Mode
    // double-mounts in dev — leaks no frames, overlays, or error nodes.
    for (let i = 0; i < 3; i++) {
      await pickOption(page, DP.mobile);
      await expect(page.locator(FRAME)).toBeVisible();
      await pickOption(page, DP.responsive);
      await expect(page.locator(FRAME)).toHaveCount(0);
    }
    await expect.poll(() => mainCanvasCount(page)).toBe(1);
    const residue = await page.evaluate(
      () =>
        document.querySelectorAll(
          "[data-device-frame], [data-device-frame-error], iframe[data-device-frame-iframe]",
        ).length,
    );
    expect(residue).toBe(0);
  });

  test("known limitation (R6/F16): a spec-driven Select portals into the PARENT document", async ({
    page,
  }) => {
    await generate(page, SELECT_UI_LINES);
    await pickOption(page, DP.mobile);
    const frame = page.frameLocator(FRAME);
    const trigger = frame.getByRole("combobox");
    await expect(trigger).toBeVisible();

    await trigger.click();

    // Documented behavior: Radix resolves its portal container as
    // globalThis.document.body — the PARENT's, always (plan 059 R6).
    // page.locator queries only the main document, so a hit here proves
    // the overlay ESCAPED the frame; a frame-only mount would count 0.
    // This characterization is the living reference for follow-up F16.
    const content = page.locator('[data-slot="select-content"]');
    await expect(content).toBeVisible();
    await expect(content).toHaveCount(1);
    // …while the trigger it belongs to still lives inside the frame.
    await expect(trigger).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(content).toHaveCount(0);
    await pickOption(page, DP.responsive);
    await expect(page.locator(FRAME)).toHaveCount(0);
  });

  test("frame-open timing tripwire reports a bounded first layout (safeguard 2)", async ({
    page,
  }) => {
    await generate(page);
    await pickOption(page, DP.mobile);
    await expect(page.locator(FRAME)).toBeVisible();

    // Dev-only measure: preset activation → first rAF after ready (styles
    // applied; fonts gated separately). Poll briefly — the measure lands
    // one frame after ready.
    const duration = await page.evaluate(async () => {
      for (let i = 0; i < 120; i++) {
        const entries = performance.getEntriesByName(
          "device-frame:open",
          "measure",
        );
        if (entries.length > 0) {
          return entries[entries.length - 1].duration;
        }
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return -1;
    });
    // Present, finite, and inside the regression tripwire (50ms is the CSS-
    // bloat target on dev hardware; 500ms here only catches gross regressions
    // without flaking on CI contention).
    expect(duration).toBeGreaterThan(0);
    expect(duration).toBeLessThan(500);
  });
});
