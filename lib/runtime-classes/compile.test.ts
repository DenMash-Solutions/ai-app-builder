import { describe, expect, test } from "bun:test";
import { buildForCandidates } from "./compile";
import { findMissingTokens } from "./escape";

describe("buildForCandidates (real Tailwind engine)", () => {
  test("compiles arbitrary values the static safelist never covered", async () => {
    const { css, missing } = await buildForCandidates([
      "aspect-[4/5]",
      "mt-[13px]",
    ]);
    expect(missing).toEqual([]);
    expect(findMissingTokens(css, ["aspect-[4/5]", "mt-[13px]"])).toEqual([]);
    expect(css).toContain("13px");
  });

  test("reports names that are not valid utilities as missing", async () => {
    const { css, missing } = await buildForCandidates(["aspect-portrait"]);
    expect(missing).toEqual(["aspect-portrait"]);
    expect(findMissingTokens(css, ["aspect-portrait"])).toEqual([
      "aspect-portrait",
    ]);
  });

  test("distinguishes near-identical class names (boundary safety)", async () => {
    const onlyWide = await buildForCandidates(["h-48"]);
    expect(onlyWide.missing).toEqual([]);
    expect(findMissingTokens(onlyWide.css, ["h-4"])).toEqual(["h-4"]);
    expect(findMissingTokens(onlyWide.css, ["h-48"])).toEqual([]);

    const fraction = await buildForCandidates(["w-1/2"]);
    expect(fraction.missing).toEqual([]);
    expect(findMissingTokens(fraction.css, ["w-1"])).toEqual(["w-1"]);
    expect(findMissingTokens(fraction.css, ["w-1/2"])).toEqual([]);
  });

  test("resolves project semantic tokens and dark: variants", async () => {
    const { css, missing } = await buildForCandidates([
      "bg-card",
      "text-muted-foreground",
      "dark:bg-blue-500",
      "hover:underline",
    ]);
    expect(missing).toEqual([]);
    expect(findMissingTokens(css, ["bg-card", "dark:bg-blue-500"])).toEqual([]);
  });

  test("handles the leading-digit responsive prefix", async () => {
    const { css, missing } = await buildForCandidates(["2xl:flex"]);
    expect(missing).toEqual([]);
    expect(findMissingTokens(css, ["2xl:flex"])).toEqual([]);
  });
});
