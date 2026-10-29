import { describe, expect, test } from "bun:test";
import {
  MAX_LISTED_SCREENS,
  NAVIGATE_RULES,
  parseScreens,
  siblingScreensBlock,
} from "./navigate-rules";

describe("NAVIGATE_RULES", () => {
  test("teaches the declared action shape with its screen param", () => {
    expect(NAVIGATE_RULES).toContain('"action": "navigate"');
    expect(NAVIGATE_RULES).toContain('"screen": "<ref>"');
    expect(NAVIGATE_RULES).toContain("press");
  });

  test("pairs with the sibling list — never guess a ref, never a path", () => {
    expect(NAVIGATE_RULES).toContain("Sibling screens");
    expect(NAVIGATE_RULES).toContain("never invent a ref");
    expect(NAVIGATE_RULES).toContain("Never write a path");
    expect(NAVIGATE_RULES).toContain("edit mode");
  });
});

describe("parseScreens", () => {
  test("keeps well-formed pairs and falls back to the ref for a blank name", () => {
    expect(
      parseScreens([
        { ref: "aaa", name: "Alpha" },
        { ref: "bbb", name: "   " },
      ]),
    ).toEqual([
      { ref: "aaa", name: "Alpha" },
      { ref: "bbb", name: "bbb" },
    ]);
  });

  test("drops non-arrays, junk entries and empty refs (never fails a run)", () => {
    expect(parseScreens(undefined)).toEqual([]);
    expect(parseScreens("aaa")).toEqual([]);
    expect(
      parseScreens([
        null,
        "aaa",
        42,
        { name: "no ref" },
        { ref: "" },
        { ref: "  " },
        { ref: "ok", name: "Fine" },
      ]),
    ).toEqual([{ ref: "ok", name: "Fine" }]);
  });

  test(`caps the list at ${MAX_LISTED_SCREENS} entries`, () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      ref: `ref-${index}`,
      name: `Screen ${index}`,
    }));
    expect(parseScreens(many)).toHaveLength(MAX_LISTED_SCREENS);
    expect(parseScreens(many)[MAX_LISTED_SCREENS - 1].ref).toBe(
      `ref-${MAX_LISTED_SCREENS - 1}`,
    );
  });
});

describe("siblingScreensBlock", () => {
  test("lists ref — name lines under the Sibling screens header", () => {
    const block = siblingScreensBlock([
      { ref: "aaa", name: "Alpha" },
      { ref: "bbb", name: "Beta app" },
    ]);

    expect(block).toContain("Sibling screens of this project");
    expect(block).toContain("the ONLY valid `navigate` targets");
    expect(block).toContain('- "aaa" — Alpha');
    expect(block).toContain('- "bbb" — Beta app');
  });

  test("omits the name when it is the ref itself", () => {
    const block = siblingScreensBlock([{ ref: "aaa", name: "aaa" }]);
    expect(block).toContain('- "aaa"');
    expect(block.endsWith('- "aaa"')).toBe(true);
  });

  test("an empty list renders nothing (the route ships neither half alone)", () => {
    expect(siblingScreensBlock([])).toBe("");
  });
});
