import { describe, expect, test } from "bun:test";
import type { Spec } from "@json-render/core";
import {
  danglingChildRefs,
  danglingRefsInstruction,
  describeDanglingRefs,
} from "./dangling-refs";

// The exact failure shape from the second live Pokédex run (plan 053
// verification): the grid's repeat template and the page label were
// referenced but never defined — 12 fetched rows, zero cards rendered.
const BROKEN_SPEC = {
  root: "main",
  elements: {
    main: { type: "Stack", children: ["pagination-bar"] },
    "pagination-bar": {
      type: "Stack",
      children: ["prev-button", "page-info", "next-button"],
    },
    "prev-button": { type: "Button", children: [] },
    "next-button": { type: "Button", children: [] },
    grid: {
      type: "Grid",
      repeat: { statePath: "/queries/q/data", key: "name" },
      children: ["card"],
    },
  },
} as unknown as Spec;

describe("danglingChildRefs", () => {
  test("reports every referenced-but-undefined child with its parent", () => {
    expect(danglingChildRefs(BROKEN_SPEC)).toEqual([
      { parent: "pagination-bar", child: "page-info" },
      { parent: "grid", child: "card" },
    ]);
  });

  test("a complete spec has none", () => {
    const complete = {
      root: "main",
      elements: {
        main: { type: "Stack", children: ["card"] },
        card: { type: "Card", children: [] },
      },
    } as unknown as Spec;
    expect(danglingChildRefs(complete)).toEqual([]);
  });

  test("inline child objects are ignored — only named refs can dangle", () => {
    const inline = {
      root: "main",
      elements: {
        main: { type: "Stack", children: [{ type: "Text", props: {} }] },
      },
    } as unknown as Spec;
    expect(danglingChildRefs(inline)).toEqual([]);
  });

  test("a spec without elements does not throw", () => {
    expect(danglingChildRefs({ root: "x" } as unknown as Spec)).toEqual([]);
  });
});

describe("describeDanglingRefs", () => {
  test("renders the developer-facing arrow list", () => {
    expect(describeDanglingRefs(danglingChildRefs(BROKEN_SPEC))).toBe(
      "pagination-bar → page-info; grid → card",
    );
  });
});

describe("danglingRefsInstruction", () => {
  test("names each missing element, its referrer, and the patch-op shape", () => {
    const instruction = danglingRefsInstruction(danglingChildRefs(BROKEN_SPEC));
    expect(instruction).toContain(
      '"page-info" (referenced by "pagination-bar")',
    );
    expect(instruction).toContain('"card" (referenced by "grid")');
    expect(instruction).toContain(
      '{"op":"add","path":"/elements/<name>","value":{...}}',
    );
    expect(instruction).toContain("Do not change any other element");
  });
});
