import { describe, expect, test } from "bun:test";
import { cssEscape, findMissingTokens } from "./escape";

describe("cssEscape", () => {
  test("escapes brackets, slashes and colons like a selector", () => {
    expect(cssEscape("aspect-[4/5]")).toBe("aspect-\\[4\\/5\\]");
    expect(cssEscape("hover:underline")).toBe("hover\\:underline");
    expect(cssEscape("w-1/2")).toBe("w-1\\/2");
  });

  test("escapes leading digits with a hex escape", () => {
    expect(cssEscape("2xl:flex")).toBe("\\32 xl\\:flex");
  });
});

describe("findMissingTokens", () => {
  test("matches its own selector", () => {
    expect(
      findMissingTokens(".aspect-\\[4\\/5\\]{aspect-ratio:4/5}", [
        "aspect-[4/5]",
      ]),
    ).toEqual([]);
    expect(findMissingTokens(".p-4{}", ["p-4"])).toEqual([]);
    expect(findMissingTokens("", ["p-4"])).toEqual(["p-4"]);
  });

  test("does not match a longer sibling class name", () => {
    expect(findMissingTokens(".h-48{height:12rem}", ["h-4"])).toEqual(["h-4"]);
    expect(findMissingTokens(".w-1\\/2{width:50%}", ["w-1"])).toEqual(["w-1"]);
    expect(findMissingTokens(".p-4{} .p-40{}", ["p-4"])).toEqual([]);
  });

  test("matches inside compound and list contexts", () => {
    expect(findMissingTokens(":is(.h-4,.h-48){}", ["h-4", "h-48"])).toEqual([]);
    expect(
      findMissingTokens("@media(min-width:1px){.md\\:p-4{}}", ["md:p-4"]),
    ).toEqual([]);
  });

  test("reads hex-escaped leading digits", () => {
    expect(
      findMissingTokens(".\\32 xl\\:flex{display:flex}", ["2xl:flex"]),
    ).toEqual([]);
  });

  test("keeps input order and duplicates of the missing tokens", () => {
    expect(findMissingTokens(".a{}", ["x", "a", "y", "x"])).toEqual([
      "x",
      "y",
      "x",
    ]);
  });
});
