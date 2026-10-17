import { describe, expect, test } from "bun:test";
import { STYLING_RULES } from "./styling-rules";

const interactionLine = STYLING_RULES.split("\n").find((line) =>
  line.includes("interaction states"),
);

describe("STYLING_RULES", () => {
  test("requires both light and dark themes", () => {
    expect(STYLING_RULES).toContain("BOTH light and dark themes");
  });

  test("recommends semantic theme tokens for surfaces and text", () => {
    for (const token of [
      "bg-background",
      "bg-card",
      "bg-muted",
      "bg-primary",
      "text-foreground",
      "text-muted-foreground",
      "text-primary-foreground",
      "border-border",
    ]) {
      expect(STYLING_RULES).toContain(token);
    }
  });

  test("requires dark: counterparts for explicit palette colors", () => {
    expect(STYLING_RULES).toContain("dark: counterpart");
    expect(STYLING_RULES).toContain("dark:bg-zinc-900");
  });

  test("bans hardcoded colors in the style prop", () => {
    expect(STYLING_RULES).toContain("Never hardcode colors");
    expect(STYLING_RULES).toContain('"style" prop');
  });

  test("dark: is not misclassified as an interaction state", () => {
    expect(interactionLine).toBeDefined();
    expect(interactionLine).not.toContain("dark:");
    expect(interactionLine).toContain("hover:");
    expect(interactionLine).toContain("focus-visible:");
    expect(interactionLine).toContain("active:");
  });

  test("steers models from arbitrary bracket values to named tokens", () => {
    expect(STYLING_RULES).toContain("named Tailwind tokens");
    expect(STYLING_RULES).toContain("bg-[#hex]");
    expect(STYLING_RULES).toContain("aspect-square");
    expect(STYLING_RULES).toContain("aspect-video");
    expect(STYLING_RULES).toContain("aspect-[3/4]");
    expect(STYLING_RULES).toContain("aspect-[4/3]");
    expect(STYLING_RULES).toContain("aspect-[16/9]");
    expect(STYLING_RULES).toContain("may not exist in the compiled stylesheet");
    expect(STYLING_RULES).not.toContain("aspect-portrait");
    expect(STYLING_RULES).not.toContain("aspect-3/4");
  });

  test("mandates single-row scrollable carousels over wrapping grids", () => {
    expect(STYLING_RULES).toContain("SINGLE non-wrapping row");
    expect(STYLING_RULES).toContain("overflow-x-auto");
    expect(STYLING_RULES).toContain("shrink-0 min-w-64");
    expect(STYLING_RULES).toContain("grid-flow-col");
    expect(STYLING_RULES).toContain("Never use a wrapping grid");
    expect(STYLING_RULES).toContain("named min-w-* / max-w-* card widths");
    // Live generation hedged with flex-wrap + overflow-x-auto (cards wrapped
    // into rows, container never scrolled) — forbid the wrap fallback.
    expect(STYLING_RULES).toContain("NEVER add flex-wrap");
    expect(STYLING_RULES).toContain("not even for small screens");
    // Cross-model test: the Stack renderer injects flex-wrap itself — the
    // rule must teach the counter-class, not just forbid wrapping.
    expect(STYLING_RULES).toContain("injects flex-wrap");
    expect(STYLING_RULES).toContain('"flex-nowrap"');
    expect(STYLING_RULES).toContain("w-full min-w-0");
    // 3.5 Lite put repeat on the card → 8 items stacked inside one card in a
    // 1-child container — repeat must live on the scroll container.
    expect(STYLING_RULES).toContain('"repeat" belongs on the SCROLL CONTAINER');
    expect(STYLING_RULES).toContain('never put "repeat" on the card itself');
  });

  test("documents the search/filter wiring through filterItems (D7)", () => {
    expect(STYLING_RULES).toContain("Search & filter a list live");
    expect(STYLING_RULES).toContain('{"$bindState": "/query"}');
    expect(STYLING_RULES).toContain('"$computed": "filterItems"');
    // The seed rule that fixes the items.map crash: state holds raw arrays,
    // the repeat reads the filtered copy directly, no expressions in state.
    expect(STYLING_RULES).toContain("Seed BOTH /items");
    expect(STYLING_RULES).toContain('never put an expression like {"$search"');
    expect(STYLING_RULES).toContain("case-insensitive substring");
  });

  test("documents the pagination pattern through stepPage + pageLabel + watch (D8/D2)", () => {
    expect(STYLING_RULES).toContain("Paginate a list");
    // Seeds: raw data only — the repeat reads /page-items directly, and the
    // seed must hold the first page's rows (an empty array = empty grid —
    // the organic round-1 failure).
    expect(STYLING_RULES).toContain(
      'the container\'s "repeat" reads /page-items',
    );
    expect(STYLING_RULES).toContain("MUST start non-empty");
    // The two ordered press actions: stepPage writes a clamped page, then
    // sliceItems re-slices from the filtered array (D2 replaced the $math
    // increments, which left /page itself unbounded).
    expect(STYLING_RULES).toContain('"$computed": "stepPage"');
    expect(STYLING_RULES).toContain('"delta": 1');
    expect(STYLING_RULES).toContain('"delta": -1');
    expect(STYLING_RULES).not.toContain('"$math": "add"');
    expect(STYLING_RULES).toContain('"$computed": "sliceItems"');
    expect(STYLING_RULES).toContain('"source": {"$state": "/filtered-items"}');
    expect(STYLING_RULES).toContain("TWO press actions in order");
    expect(STYLING_RULES).toContain("actions run sequentially");
    // Dangling children refs must be caught by the rule (round-1 failure).
    expect(STYLING_RULES).toContain("never defined renders nothing");
    // Search ↔ pagination composition: watch re-pages on /filtered-items.
    expect(STYLING_RULES).toContain('{"watch": {"/filtered-items"');
    expect(STYLING_RULES).toContain("never on initial render");
    // Edges + D5 icon affordance.
    expect(STYLING_RULES).toContain("clamped into range");
    expect(STYLING_RULES).toContain('leadingIcon "chevron-left"');
    // D2: computed 1-based label (a $template cannot compute bounds) and the
    // Previous button hidden at the start.
    expect(STYLING_RULES).toContain('"$computed": "pageLabel"');
    expect(STYLING_RULES).toContain('"Page 1 of 2"');
    expect(STYLING_RULES).toContain('{"$state": "/page", "gt": 0}');
    expect(STYLING_RULES).toContain("Hide the Previous button");
  });

  test("places repeat on the container, never the item element (bug-1 fix)", () => {
    expect(STYLING_RULES).toContain("Repeat placement (all lists");
    expect(STYLING_RULES).toContain("NEVER on the item element itself");
    // The explicit Grid example: repeat on the Grid = one card per row; on
    // the item card = ONE card containing every row (the observed bug).
    expect(STYLING_RULES).toContain(
      '{"repeat": {"statePath": "/page-items"}} on the Grid',
    );
    expect(STYLING_RULES).toContain("renders one card per row");
    expect(STYLING_RULES).toContain("renders ONE card containing every row");
    // The search bullet now points at the container too.
    expect(STYLING_RULES).toContain('the Grid/Stack container\'s "repeat"');
  });

  test("documents responsive layout expectations (D3)", () => {
    expect(STYLING_RULES).toContain("~375 px phone");
    expect(STYLING_RULES).toContain("~1440 px desktop");
    // columns = desktop target; the renderer owns the responsive ladder.
    expect(STYLING_RULES).toContain(
      "grid-cols-1 sm:grid-cols-2 lg:grid-cols-<n>",
    );
    expect(STYLING_RULES).toContain('"columns" prop is the DESKTOP target');
    expect(STYLING_RULES).toContain("never hand-write grid-cols-*");
    // Full-width layout, w-full inputs, responsive size pairs, wrapping
    // control rows (the horizontal Stack wraps by itself).
    expect(STYLING_RULES).toContain('Inputs get "className": "w-full"');
    expect(STYLING_RULES).toContain('"p-4 md:p-6"');
    expect(STYLING_RULES).toContain("the horizontal Stack wraps by itself");
    expect(STYLING_RULES).toContain("max-w-* mx-auto");
  });
});
