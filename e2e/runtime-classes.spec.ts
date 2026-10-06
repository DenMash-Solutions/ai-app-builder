import { expect, test } from "@playwright/test";

/**
 * Spec classNames only exist at runtime (model output, edit history) —
 * Tailwind's source scan never sees them, so every model-favored utility
 * must be forced via `@source inline(...)` in app/globals.css. This probe
 * asserts the targeted set actually compiles and applies.
 */
test.describe("runtime class coverage", () => {
  test("model-favored utilities compile and apply", async ({ page }) => {
    await page.goto("/");
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
});
