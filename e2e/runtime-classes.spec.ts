import { expect, test } from "@playwright/test";
import {
  COMPONENT,
  EDITOR,
  MOCK_KEYS,
  PATCH_OP,
  PATCH_PATH,
  PATHS,
  PROMPTS,
  ROLE,
  UI,
} from "./constants";
import { mockGenerate, waitForMsw } from "./helpers";

/**
 * Spec classNames only exist at runtime (model output, edit history) —
 * Tailwind's source scan never sees them, so every model-favored utility
 * must be forced via `@source inline(...)` in app/globals.css. This probe
 * asserts the targeted set actually compiles and applies.
 */
test.describe("runtime class coverage", () => {
  test("model-favored utilities compile and apply", async ({ page }) => {
    await page.goto(PATHS.ui);
    await page.waitForLoadState("networkidle");

    const failures = await page.evaluate(() => {
      const results: string[] = [];
      const style = (el: Element): Record<string, string> =>
        getComputedStyle(el) as unknown as Record<string, string>;
      const probe = (className: string): HTMLElement => {
        const el = document.createElement("div");
        el.className = className;
        document.body.appendChild(el);
        return el;
      };
      const expectValue = (
        label: string,
        className: string,
        property: string,
        expected: string,
      ): void => {
        const el = probe(className);
        const actual = style(el)[property];
        el.remove();
        if (actual !== expected) {
          results.push(
            `${label}: ${property} = "${actual}", want "${expected}"`,
          );
        }
      };
      const expectContains = (
        label: string,
        className: string,
        property: string,
        needle: string,
      ): void => {
        const el = probe(className);
        const actual = style(el)[property];
        el.remove();
        if (!actual.includes(needle)) {
          results.push(`${label}: ${property} = "${actual}", want "${needle}"`);
        }
      };
      const expectDiffers = (
        label: string,
        className: string,
        baselineClass: string,
        property: string,
      ): void => {
        const withClass = probe(className);
        const baseline = probe(baselineClass);
        const actual = style(withClass)[property];
        const base = style(baseline)[property];
        withClass.remove();
        baseline.remove();
        if (actual === base) {
          results.push(
            `${label}: ${property} = "${actual}", same as baseline "${base}"`,
          );
        }
      };

      expectValue("h-48", "h-48", "height", "192px");
      expectValue("h-64", "h-64", "height", "256px");
      expectValue("h-80", "h-80", "height", "320px");
      expectValue("min-h-40", "min-h-40", "minHeight", "160px");
      expectValue("min-h-64", "min-h-64", "minHeight", "256px");
      expectValue("object-cover", "object-cover", "objectFit", "cover");
      expectValue("object-contain", "object-contain", "objectFit", "contain");
      expectValue("top-0", "absolute top-0", "top", "0px");
      expectValue("bottom-0", "absolute bottom-0", "bottom", "0px");
      expectValue("left-0", "absolute left-0", "left", "0px");
      expectValue("right-0", "absolute right-0", "right", "0px");
      // fit-content on an empty probe is 0px (no content), so assert against
      // the block baseline instead of a fixed width.
      expectDiffers("w-fit", "w-fit", "", "width");
      expectContains(
        "backdrop-blur-sm",
        "backdrop-blur-sm",
        "backdropFilter",
        "blur",
      );
      // A bare bg-gradient-to-* resolves to none without color stops, so the
      // probe pairs it with from/to — exactly how the model emits it.
      expectContains(
        "bg-gradient-to-t",
        "bg-gradient-to-t from-black/80 to-transparent",
        "backgroundImage",
        "linear-gradient",
      );
      expectContains(
        "bg-gradient-to-l",
        "bg-gradient-to-l from-white/80 to-transparent",
        "backgroundImage",
        "linear-gradient",
      );
      expectDiffers(
        "gradient color stops",
        "bg-gradient-to-t from-black/80 to-transparent",
        "bg-gradient-to-t",
        "backgroundImage",
      );
      expectDiffers("text-white/80", "text-white/80", "", "color");
      expectDiffers("text-black/50", "text-black/50", "", "color");
      expectDiffers("bg-white/20", "bg-white/20", "", "backgroundColor");
      expectDiffers("bg-black/50", "bg-black/50", "", "backgroundColor");

      return results;
    });

    expect(failures).toEqual([]);
  });

  test("semantic tokens and dark: variants compile and apply", async ({
    page,
  }) => {
    await page.goto(PATHS.ui);
    await page.waitForLoadState("networkidle");

    const failures = await page.evaluate(() => {
      const results: string[] = [];
      const style = (el: Element): Record<string, string> =>
        getComputedStyle(el) as unknown as Record<string, string>;
      const root = document.documentElement;
      const hadDark = root.classList.contains("dark");
      root.classList.remove("dark");

      const probe = (className: string, parent?: Element): HTMLElement => {
        const el = document.createElement("div");
        el.className = className;
        (parent ?? document.body).appendChild(el);
        return el;
      };
      const cleanups: HTMLElement[] = [];
      const tracked = (className: string, parent?: Element): HTMLElement => {
        const el = probe(className, parent);
        cleanups.push(el);
        return el;
      };
      const expectDiffers = (
        label: string,
        className: string,
        property: string,
        baselineClass: string,
      ): void => {
        const withClass = tracked(className);
        const baseline = tracked(baselineClass);
        const actual = style(withClass)[property];
        const base = style(baseline)[property];
        if (actual === base) {
          results.push(
            `${label}: ${property} = "${actual}", same as baseline "${base}"`,
          );
        }
      };
      const expectValue = (
        label: string,
        el: HTMLElement,
        property: string,
        expected: string,
      ): void => {
        const actual = style(el)[property];
        if (actual !== expected) {
          results.push(
            `${label}: ${property} = "${actual}", want "${expected}"`,
          );
        }
      };

      try {
        // Semantic theme utilities: model picks that were not present in any
        // scanned source file must still compile via @source inline.
        expectDiffers(
          "border-primary",
          "border border-primary",
          "borderColor",
          "border",
        );
        expectDiffers(
          "bg-destructive",
          "bg-destructive",
          "backgroundColor",
          "",
        );
        expectDiffers("text-accent", "text-accent", "color", "");
        expectDiffers("bg-input", "bg-input", "backgroundColor", "");

        // dark: palette variants compile and gate on a .dark ancestor.
        // blue-500 is oklch in Tailwind v4 and serializes as lab(...) in
        // Chrome — assert applied-vs-transparent instead of an exact string.
        const darkWrap = document.createElement("div");
        darkWrap.className = "dark";
        document.body.appendChild(darkWrap);
        const inDark = tracked("dark:bg-blue-500", darkWrap);
        const outDark = tracked("dark:bg-blue-500");
        const inValue = style(inDark)["backgroundColor"];
        if (inValue === "rgba(0, 0, 0, 0)" || inValue === "transparent") {
          results.push(
            `dark:bg-blue-500 inside .dark: backgroundColor = "${inValue}", want a color`,
          );
        }
        expectValue(
          "dark:bg-blue-500 outside .dark",
          outDark,
          "backgroundColor",
          "rgba(0, 0, 0, 0)",
        );
        cleanups.push(darkWrap);

        return results;
      } finally {
        for (const el of cleanups) el.remove();
        if (hadDark) root.classList.add("dark");
      }
    });

    expect(failures).toEqual([]);
  });

  test("responsive, slash-opacity and typography utilities compile and apply", async ({
    page,
  }) => {
    await page.goto(PATHS.ui);
    await page.waitForLoadState("networkidle");

    const failures = await page.evaluate(() => {
      const results: string[] = [];
      const style = (el: Element): Record<string, string> =>
        getComputedStyle(el) as unknown as Record<string, string>;
      const probe = (className: string, parent?: Element): HTMLElement => {
        const el = document.createElement("div");
        el.className = className;
        (parent ?? document.body).appendChild(el);
        return el;
      };

      // Responsive: the default Playwright viewport (1280px) matches sm/md/lg,
      // so a compiled lg:grid-cols-4 must split a fixed-width probe into tracks.
      const grid = probe("grid lg:grid-cols-4");
      grid.style.width = "800px";
      const tracks = style(grid)
        ["gridTemplateColumns"].split(" ")
        .filter(Boolean);
      if (tracks.length !== 4) {
        results.push(`lg:grid-cols-4: ${tracks.length} tracks, want 4`);
      }
      grid.remove();

      const mdText = probe("md:text-5xl");
      const mdSize = style(mdText)["fontSize"];
      mdText.remove();
      if (mdSize !== "48px") {
        results.push(`md:text-5xl: fontSize = "${mdSize}", want "48px"`);
      }

      // Slash-opacity palette forms (subtle surfaces + dark: pairings).
      const opaque = probe("bg-stone-100/50");
      const opaqueValue = style(opaque)["backgroundColor"];
      opaque.remove();
      if (opaqueValue === "rgba(0, 0, 0, 0)") {
        results.push(`bg-stone-100/50: backgroundColor is transparent`);
      }

      const darkWrap = probe("dark");
      const inDark = probe("dark:bg-stone-900/90", darkWrap);
      const outDark = probe("dark:bg-stone-900/90");
      const inValue = style(inDark)["backgroundColor"];
      const outValue = style(outDark)["backgroundColor"];
      inDark.remove();
      outDark.remove();
      darkWrap.remove();
      if (inValue === "rgba(0, 0, 0, 0)") {
        results.push(`dark:bg-stone-900/90 inside .dark: transparent`);
      }
      if (outValue !== "rgba(0, 0, 0, 0)") {
        results.push(
          `dark:bg-stone-900/90 outside .dark: "${outValue}", want transparent`,
        );
      }

      // Typography / misc observed in real model output.
      const serif = probe("font-serif");
      const serifFamily = style(serif)["fontFamily"];
      serif.remove();
      if (!serifFamily.includes("serif")) {
        results.push(`font-serif: fontFamily = "${serifFamily}", want serif`);
      }

      const italicEl = probe("italic");
      const italicValue = style(italicEl)["fontStyle"];
      italicEl.remove();
      if (italicValue !== "italic") {
        results.push(`italic: fontStyle = "${italicValue}", want italic`);
      }

      const opacityEl = probe("opacity-85");
      const opacityValue = style(opacityEl)["opacity"];
      opacityEl.remove();
      if (opacityValue !== "0.85") {
        results.push(`opacity-85: opacity = "${opacityValue}", want 0.85`);
      }

      const aspectEl = probe("aspect-[3/4]");
      const aspectValue = style(aspectEl)["aspectRatio"];
      aspectEl.remove();
      if (aspectValue !== "0.75" && aspectValue !== "3 / 4") {
        results.push(`aspect-[3/4]: aspectRatio = "${aspectValue}", want 0.75`);
      }

      // aspect-[4/5] is the carousel spec's image ratio — added to the
      // safelist after it silently no-opped (incident 2026-10-08).
      const aspectFourFive = probe("aspect-[4/5]");
      const aspectFourFiveValue = style(aspectFourFive)["aspectRatio"];
      aspectFourFive.remove();
      if (aspectFourFiveValue !== "0.8" && aspectFourFiveValue !== "4 / 5") {
        results.push(
          `aspect-[4/5]: aspectRatio = "${aspectFourFiveValue}", want 0.8`,
        );
      }

      const itemsEl = probe("items-stretch");
      const itemsValue = style(itemsEl)["alignItems"];
      itemsEl.remove();
      if (itemsValue !== "stretch") {
        results.push(
          `items-stretch: alignItems = "${itemsValue}", want stretch`,
        );
      }

      const trackEl = probe("tracking-[0.25em]");
      const trackBase = probe("");
      const trackValue = style(trackEl)["letterSpacing"];
      const trackBaseline = style(trackBase)["letterSpacing"];
      trackEl.remove();
      trackBase.remove();
      if (trackValue === trackBaseline) {
        results.push(
          `tracking-[0.25em]: letterSpacing = "${trackValue}", same as baseline`,
        );
      }

      return results;
    });

    expect(failures).toEqual([]);
  });

  test("single-row scrollable carousel pattern compiles and applies", async ({
    page,
  }) => {
    await page.goto(PATHS.ui);
    await page.waitForLoadState("networkidle");

    const failures = await page.evaluate(() => {
      const results: string[] = [];
      const style = (el: Element): Record<string, string> =>
        getComputedStyle(el) as unknown as Record<string, string>;

      // 8 fixed-width cards in the prompt-mandated scroll container, narrower
      // than the cards so the row must overflow and scroll.
      const container = document.createElement("div");
      container.className = "flex flex-nowrap gap-4 overflow-x-auto snap-x";
      container.style.width = "600px";
      const cards: HTMLElement[] = [];
      for (let i = 0; i < 8; i++) {
        const card = document.createElement("div");
        card.className = "shrink-0 snap-start min-w-64";
        card.style.height = "100px";
        card.textContent = `Card ${i}`;
        container.appendChild(card);
        cards.push(card);
      }
      document.body.appendChild(container);

      try {
        const containerStyle = style(container);
        if (!containerStyle["overflowX"].includes("auto")) {
          results.push(
            `overflow-x-auto: overflowX = "${containerStyle["overflowX"]}"`,
          );
        }
        if (containerStyle["scrollSnapType"] === "none") {
          results.push(
            `snap-x: scrollSnapType = "${containerStyle["scrollSnapType"]}"`,
          );
        }
        // flex-nowrap's computed value equals the initial value (nowrap), so
        // probe the stylesheet for the rule itself instead (recurse into
        // @layer blocks where v4 utilities live).
        let hasFlexNowrapRule = false;
        const scanRules = (rules: CSSRuleList): void => {
          for (const rule of rules) {
            const selector = (rule as { selectorText?: string }).selectorText;
            if (selector?.includes(".flex-nowrap")) {
              hasFlexNowrapRule = true;
            }
            if ("cssRules" in rule) {
              scanRules((rule as { cssRules: CSSRuleList }).cssRules);
            }
          }
        };
        for (const sheet of document.styleSheets) {
          try {
            scanRules(sheet.cssRules);
          } catch {
            continue;
          }
        }
        if (!hasFlexNowrapRule) {
          results.push("flex-nowrap: no rule found in any stylesheet");
        }

        const rects = cards.map((card) => card.getBoundingClientRect());
        const firstY = rects[0].y;
        if (!rects.every((r) => Math.abs(r.y - firstY) < 1)) {
          results.push(
            `cards wrapped into multiple rows: y = ${rects.map((r) => r.y).join(", ")}`,
          );
        }
        if (container.scrollWidth <= container.clientWidth) {
          results.push(
            `not scrollable: scrollWidth ${container.scrollWidth} <= clientWidth ${container.clientWidth}`,
          );
        }
        if (rects[7].right <= container.getBoundingClientRect().right) {
          results.push("8th card is not hidden beyond the container edge");
        }

        const cardStyle = style(cards[0]);
        if (cardStyle["flexShrink"] !== "0") {
          results.push(`shrink-0: flexShrink = "${cardStyle["flexShrink"]}"`);
        }
        if (cardStyle["minWidth"] !== "256px") {
          results.push(
            `min-w-64: minWidth = "${cardStyle["minWidth"]}", want "256px"`,
          );
        }
        // Lite paired min-w-72 max-w-72 for fixed cards; only min-w covered
        // then — max-w named spacing scale must compile too.
        const maxProbe = document.createElement("div");
        maxProbe.className = "max-w-72";
        document.body.appendChild(maxProbe);
        const maxWidth = style(maxProbe)["maxWidth"];
        maxProbe.remove();
        if (maxWidth !== "288px") {
          results.push(`max-w-72: maxWidth = "${maxWidth}", want "288px"`);
        }
        if (cardStyle["scrollSnapAlign"] !== "start") {
          results.push(
            `snap-start: scrollSnapAlign = "${cardStyle["scrollSnapAlign"]}"`,
          );
        }

        // grid-flow-col variant of the same pattern + observed arbitrary width.
        // Snapshot computed values before remove(): getComputedStyle returns a
        // live object that reads "" once the element is detached.
        const gridRow = document.createElement("div");
        gridRow.className =
          "grid grid-flow-col auto-cols-min overflow-x-auto min-w-[260px]";
        document.body.appendChild(gridRow);
        const gridFlow = style(gridRow)["gridAutoFlow"];
        const gridAutoCols = style(gridRow)["gridAutoColumns"];
        const gridMinWidth = style(gridRow)["minWidth"];
        gridRow.remove();
        // Chrome serializes the keyword "col" as "column".
        if (gridFlow !== "col" && gridFlow !== "column") {
          results.push(
            `grid-flow-col: gridAutoFlow = "${gridFlow}", want "col"`,
          );
        }
        if (gridAutoCols === "auto") {
          results.push(`auto-cols-min: gridAutoColumns = "${gridAutoCols}"`);
        }
        if (gridMinWidth !== "260px") {
          results.push(
            `min-w-[260px]: minWidth = "${gridMinWidth}", want "260px"`,
          );
        }
      } finally {
        container.remove();
      }

      return results;
    });

    expect(failures).toEqual([]);
  });

  test("on-demand compile endpoint returns css and reports missing", async ({
    page,
  }) => {
    // MSW only mocks */api/generate (onUnhandledFrame bypass), so this hits
    // the real /api/tailwind route.
    const response = await page.request.post("/api/tailwind", {
      data: {
        candidates: ["aspect-[4/5]", "mt-[13px]", "aspect-portrait"],
      },
    });
    expect(response.ok()).toBe(true);
    const body = (await response.json()) as { css: string; missing: string[] };
    expect(body.css).toContain("aspect-\\[4\\/5\\]");
    expect(body.css).toContain("13px");
    expect(body.missing).toEqual(["aspect-portrait"]);
  });

  test("on-demand compile endpoint rejects malformed payloads", async ({
    page,
  }) => {
    const response = await page.request.post("/api/tailwind", {
      data: { candidates: "p-4" },
    });
    expect(response.status()).toBe(400);
  });

  test("layered injection keeps the chrome row layout with the drawer open", async ({
    page,
  }) => {
    // Regression: a spec carrying `flex-col` used to inject an UNLAYERED
    // .flex-col rule that beat the layered .sm:flex-row on <main> — flex
    // direction flipped to column, the full-height drawer squeezed the
    // canvas column to 0px, and overflow-y-auto clipped all spec content.
    const layerLines = [
      JSON.stringify({
        op: PATCH_OP.add,
        path: PATCH_PATH.root,
        value: MOCK_KEYS.card,
      }),
      JSON.stringify({
        op: PATCH_OP.add,
        path: `${PATCH_PATH.elements}/${MOCK_KEYS.card}`,
        value: {
          type: COMPONENT.card,
          props: {
            title: "Layer probe",
            className: "flex flex-col gap-2 p-4",
          },
          children: [MOCK_KEYS.heading],
        },
      }),
      JSON.stringify({
        op: PATCH_OP.add,
        path: `${PATCH_PATH.elements}/${MOCK_KEYS.heading}`,
        value: {
          type: COMPONENT.heading,
          props: { text: UI.mockHeading, level: "h1" },
          children: [],
        },
      }),
    ];
    await mockGenerate(page, { lines: layerLines });
    await page.goto(PATHS.ui);
    await waitForMsw(page);
    await page.getByRole(ROLE.button, { name: PROMPTS.signIn }).click();
    await expect(page.getByText(UI.mockHeading)).toBeVisible();
    // Generation redirects to /ui/[id] (remount) — sync before tool clicks
    await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/);

    // Injected utilities must live in the `components` cascade layer (below
    // the static build's `utilities`) so collisions like flex-col lose.
    await page.waitForFunction(
      () =>
        document
          .getElementById("runtime-tailwind-css")
          ?.textContent?.includes("@layer components") === true,
    );

    await page.getByRole(ROLE.button, { name: EDITOR.pick }).click();
    await page.getByText(UI.mockHeading).click();
    await expect(page.locator("[data-editor-panel]")).toBeVisible();

    const layout = await page.evaluate(() => {
      const main = document.querySelector("main");
      const scroller = document.querySelector("main .overflow-y-auto");
      return {
        direction: main ? getComputedStyle(main).flexDirection : null,
        scrollerHeight: scroller ? scroller.getBoundingClientRect().height : 0,
      };
    });
    expect(layout.direction).toBe("row");
    expect(layout.scrollerHeight).toBeGreaterThan(0);
  });
});
