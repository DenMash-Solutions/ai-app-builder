import { describe, expect, test } from "bun:test";
import { joinClassTokens, toClassTokens } from "./class-tokens";

describe("toClassTokens", () => {
  test("splits a className string on whitespace", () => {
    expect(toClassTokens("w-full h-64 object-cover")).toEqual([
      "w-full",
      "h-64",
      "object-cover",
    ]);
  });

  test("collapses runs of whitespace and drops empties", () => {
    expect(toClassTokens("  p-2   p-4\tmt-1  ")).toEqual([
      "p-2",
      "p-4",
      "mt-1",
    ]);
    expect(toClassTokens("   ")).toEqual([]);
    expect(toClassTokens("")).toEqual([]);
  });

  test("returns [] for null, undefined, and non-strings", () => {
    expect(toClassTokens(null)).toEqual([]);
    expect(toClassTokens(undefined)).toEqual([]);
    expect(toClassTokens(42)).toEqual([]);
    expect(toClassTokens({ $state: "cls" })).toEqual([]);
  });
});

describe("joinClassTokens", () => {
  test("joins with single spaces and trims each token", () => {
    expect(joinClassTokens(["w-full", "h-64", "object-cover"])).toBe(
      "w-full h-64 object-cover",
    );
    expect(joinClassTokens(["  p-2 ", " p-4"])).toBe("p-2 p-4");
  });

  test("drops empty tokens", () => {
    expect(joinClassTokens(["p-2", "", "  ", "p-4"])).toBe("p-2 p-4");
    expect(joinClassTokens([])).toBe("");
    expect(joinClassTokens([""])).toBe("");
  });

  test("round-trips through toClassTokens", () => {
    const value = "tracking-wide text-center";
    expect(joinClassTokens(toClassTokens(value))).toBe(value);
    expect(toClassTokens(joinClassTokens(toClassTokens("  a   b  ")))).toEqual([
      "a",
      "b",
    ]);
  });
});
