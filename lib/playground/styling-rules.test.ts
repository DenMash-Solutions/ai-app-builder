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
    expect(STYLING_RULES).toContain("aspect-video");
    expect(STYLING_RULES).toContain("may not exist in the compiled stylesheet");
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
});
