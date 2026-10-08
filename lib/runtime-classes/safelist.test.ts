import { describe, expect, test } from "bun:test";
import {
  expandCandidates,
  expandGlobalSafelist,
  extractInlineSources,
} from "./safelist";

describe("extractInlineSources", () => {
  test("collects directives in order and skips comments", () => {
    const css = `
/* @source inline("commented-out"); */
@source inline("w-full h-4");
@source not "../docs";
@source inline("p-{1,2}");
`;
    expect(extractInlineSources(css)).toEqual(["w-full h-4", "p-{1,2}"]);
  });

  test("throws on a multi-line or unquoted directive", () => {
    expect(() => extractInlineSources("@source inline(w-full);")).toThrow(
      /Unsupported @source inline shape/,
    );
    expect(() => extractInlineSources('@source inline("a"\n  "b");')).toThrow(
      /Unsupported @source inline shape/,
    );
  });

  test("throws on an embedded quote inside the pattern", () => {
    expect(() => extractInlineSources('@source inline("a"b");')).toThrow(
      /Embedded quote/,
    );
  });
});

describe("expandCandidates", () => {
  test("passes literal candidates through", () => {
    expect(expandCandidates("truncate")).toEqual(["truncate"]);
    expect(expandCandidates("w-full h-full")).toEqual(["w-full", "h-full"]);
  });

  test("expands empty alternatives", () => {
    expect(expandCandidates("p{,x,y}-{1,2}")).toEqual([
      "p-1",
      "p-2",
      "px-1",
      "px-2",
      "py-1",
      "py-2",
    ]);
  });

  test("multiplies sequential groups", () => {
    expect(expandCandidates("{,hover:}bg-{red,blue}")).toEqual([
      "bg-red",
      "bg-blue",
      "hover:bg-red",
      "hover:bg-blue",
    ]);
  });

  test("expands slash-opacity groups", () => {
    expect(expandCandidates("text-white/{50,60}")).toEqual([
      "text-white/50",
      "text-white/60",
    ]);
  });

  test("supports negative alternatives", () => {
    expect(expandCandidates("translate-y-{-2,0}")).toEqual([
      "translate-y--2",
      "translate-y-0",
    ]);
  });

  test("throws on stray, unbalanced or nested braces", () => {
    expect(() => expandCandidates("w-4}")).toThrow(/Stray "\}"/);
    expect(() => expandCandidates("w-{4")).toThrow(/Unbalanced/);
    expect(() => expandCandidates("w-{a{b,c}d}")).toThrow(/Nested braces/);
  });
});

describe("expandGlobalSafelist", () => {
  test("expands every directive and dedupes across sources", () => {
    const css = `
@source inline("w-full {p,m}-{1,2}");
@source inline("w-full");
`;
    expect(expandGlobalSafelist(css)).toEqual([
      "w-full",
      "p-1",
      "p-2",
      "m-1",
      "m-2",
    ]);
  });
});
