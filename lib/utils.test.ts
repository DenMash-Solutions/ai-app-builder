import { describe, expect, test } from "bun:test";
import { specsEqual } from "./utils";

describe("specsEqual", () => {
  test("ignores key order at every depth", () => {
    expect(
      specsEqual(
        {
          root: "card",
          elements: { a: { type: "text", props: { text: "hi" } } },
        },
        {
          elements: { a: { props: { text: "hi" }, type: "text" } },
          root: "card",
        },
      ),
    ).toBe(true);
  });

  test("detects differing nested props", () => {
    expect(
      specsEqual(
        { elements: { a: { props: { text: "hi" } } } },
        { elements: { a: { props: { text: "bye" } } } },
      ),
    ).toBe(false);
  });

  test("treats array order as significant", () => {
    expect(specsEqual({ children: ["a", "b"] }, { children: ["a", "b"] })).toBe(
      true,
    );
    expect(specsEqual({ children: ["a", "b"] }, { children: ["b", "a"] })).toBe(
      false,
    );
    expect(specsEqual({ children: ["a"] }, { children: ["a", "b"] })).toBe(
      false,
    );
  });

  test("flags a missing key even when the other is undefined", () => {
    expect(specsEqual({ a: 1 }, {})).toBe(false);
    expect(specsEqual({ a: undefined }, {})).toBe(false);
    expect(specsEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  test("compares primitives and nulls by identity", () => {
    expect(specsEqual("spec", "spec")).toBe(true);
    expect(specsEqual(1, 2)).toBe(false);
    expect(specsEqual(null, null)).toBe(true);
    expect(specsEqual(null, {})).toBe(false);
    expect(specsEqual(undefined, null)).toBe(false);
    expect(specsEqual({}, [])).toBe(false);
  });
});
