import { describe, expect, test } from "bun:test";
import {
  filterItems,
  PLAYGROUND_FUNCTIONS,
  sliceItems,
} from "@/lib/playground/computed-functions";

const ITEMS = [
  { name: "house", group: "nav" },
  { name: "Star", group: "status" },
  { name: "trash-2", group: "actions" },
];

describe("filterItems", () => {
  test("case-insensitive substring match over the source array", () => {
    expect(filterItems({ source: ITEMS, query: "hous" })).toEqual([
      { name: "house", group: "nav" },
    ]);
    expect(filterItems({ source: ITEMS, query: "STAR" })).toEqual([
      { name: "Star", group: "status" },
    ]);
  });

  test("fields restrict matching to those keys", () => {
    const source = [{ name: "alpha", note: "omega" }];
    expect(filterItems({ source, query: "omega", fields: ["name"] })).toEqual(
      [],
    );
    expect(filterItems({ source, query: "omega", fields: ["note"] })).toEqual(
      source,
    );
  });

  test("without fields every string/number/boolean value is searched", () => {
    expect(
      filterItems({ source: [{ name: "house", count: 42 }], query: "42" }),
    ).toEqual([{ name: "house", count: 42 }]);
    expect(
      filterItems({ source: [{ name: "house", open: true }], query: "tru" }),
    ).toEqual([{ name: "house", open: true }]);
    // A key outside `fields` never matches when fields are given…
    expect(
      filterItems({ source: ITEMS, query: "status", fields: ["name"] }),
    ).toEqual([]);
    // …and plain string entries always match directly.
    expect(filterItems({ source: ["hello", "world"], query: "ell" })).toEqual([
      "hello",
    ]);
  });

  test("an empty or whitespace query returns the source unchanged", () => {
    expect(filterItems({ source: ITEMS, query: "" })).toBe(ITEMS);
    expect(filterItems({ source: ITEMS, query: "   " })).toBe(ITEMS);
    expect(filterItems({ source: ITEMS })).toBe(ITEMS);
  });

  test("non-array sources yield an empty result", () => {
    expect(filterItems({ source: "nope", query: "x" })).toEqual([]);
    expect(filterItems({ query: "x" })).toEqual([]);
    expect(filterItems({})).toEqual([]);
  });

  test("null and non-object entries are skipped", () => {
    const source = [null, 7, { name: "house" }];
    expect(filterItems({ source, query: "house" })).toEqual([
      { name: "house" },
    ]);
    expect(filterItems({ source, query: "7" })).toEqual([]);
  });

  test("the catalog registers the function under its prompt name", () => {
    expect(PLAYGROUND_FUNCTIONS.filterItems).toBe(filterItems);
  });
});

describe("sliceItems (D8 pagination)", () => {
  const ITEMS = ["a", "b", "c", "d", "e"];

  test("returns one page of the source", () => {
    expect(sliceItems({ source: ITEMS, page: 0, limit: 2 })).toEqual([
      "a",
      "b",
    ]);
    expect(sliceItems({ source: ITEMS, page: 1, limit: 2 })).toEqual([
      "c",
      "d",
    ]);
    // Partial last page.
    expect(sliceItems({ source: ITEMS, page: 2, limit: 2 })).toEqual(["e"]);
    expect(sliceItems({ source: ITEMS, page: 0, limit: 5 })).toEqual(ITEMS);
  });

  test("clamps the page into range — edge buttons never blank the list", () => {
    expect(sliceItems({ source: ITEMS, page: 99, limit: 2 })).toEqual(["e"]);
    expect(sliceItems({ source: ITEMS, page: -1, limit: 2 })).toEqual([
      "a",
      "b",
    ]);
    // Non-number pages fall back to the first page.
    expect(sliceItems({ source: ITEMS, page: "next", limit: 2 })).toEqual([
      "a",
      "b",
    ]);
  });

  test("a missing or non-positive limit degrades to the whole source", () => {
    expect(sliceItems({ source: ITEMS, page: 1 })).toEqual(ITEMS);
    expect(sliceItems({ source: ITEMS, page: 0, limit: 0 })).toEqual(ITEMS);
    expect(sliceItems({ source: ITEMS, page: 0, limit: -3 })).toEqual(ITEMS);
    expect(sliceItems({ source: ITEMS, page: 3, limit: "12" })).toEqual(ITEMS);
  });

  test("non-array sources yield an empty page", () => {
    expect(sliceItems({ source: "nope", page: 0, limit: 2 })).toEqual([]);
    expect(sliceItems({ page: 0, limit: 2 })).toEqual([]);
  });

  test("the catalog registers sliceItems under its prompt name", () => {
    expect(PLAYGROUND_FUNCTIONS.sliceItems).toBe(sliceItems);
  });
});
