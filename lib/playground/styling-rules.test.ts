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
});
