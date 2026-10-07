import { describe, expect, test } from "bun:test";
import type { Spec } from "@json-render/core";
import {
  COMMON_STYLE_KEYS,
  COMMON_TAILWIND_CLASSES,
  getClassSuggestions,
} from "./suggestions";

function specWithClasses(...classes: (string | null | undefined)[]): Spec {
  const elements = Object.fromEntries(
    classes.map((className, index) => [
      `el-${index}`,
      { type: "div", props: className === undefined ? {} : { className } },
    ]),
  );
  return { elements } as unknown as Spec;
}

describe("getClassSuggestions", () => {
  test("returns the curated set for a null or empty spec", () => {
    const expected = [...COMMON_TAILWIND_CLASSES].sort((a, b) =>
      a.localeCompare(b),
    );
    expect(getClassSuggestions(null)).toEqual(expected);
    expect(getClassSuggestions({ elements: {} } as Spec)).toEqual(expected);
  });

  test("merges spec-used classes, dedupes, and sorts", () => {
    const suggestions = getClassSuggestions(
      specWithClasses("tracking-wide custom-token", "tracking-wide", ""),
    );
    expect(suggestions).toContain("custom-token");
    expect(suggestions).toContain("tracking-wide");
    expect(suggestions).toContain("bg-white");
    expect(
      suggestions.filter((token) => token === "tracking-wide"),
    ).toHaveLength(1);
    expect([...suggestions].sort((a, b) => a.localeCompare(b))).toEqual(
      suggestions,
    );
  });

  test("ignores non-string className values (expressions)", () => {
    const suggestions = getClassSuggestions(
      specWithClasses({ $state: "cls" } as unknown as string),
    );
    expect(suggestions).not.toContain("$state");
    expect(suggestions).toContain("bg-white");
  });
});

describe("curated lists", () => {
  test("are non-empty and unique", () => {
    for (const list of [COMMON_TAILWIND_CLASSES, COMMON_STYLE_KEYS]) {
      expect(list.length).toBeGreaterThan(50);
      expect(new Set(list).size).toBe(list.length);
    }
  });
});
