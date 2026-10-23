import { describe, expect, test } from "bun:test";
import {
  filterItems,
  pageLabel,
  PLAYGROUND_FUNCTIONS,
  sliceItems,
  stepPage,
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

describe("stepPage (D2 bounded page increments)", () => {
  const ITEMS = ["a", "b", "c", "d", "e"]; // 3 pages with limit 2

  test("moves the page by delta", () => {
    expect(stepPage({ source: ITEMS, page: 0, limit: 2, delta: 1 })).toBe(1);
    expect(stepPage({ source: ITEMS, page: 1, limit: 2, delta: 1 })).toBe(2);
    expect(stepPage({ source: ITEMS, page: 2, limit: 2, delta: -1 })).toBe(1);
  });

  test("never walks out of range — the state itself is bounded", () => {
    // Previous at the start stays at 0 (the −1 bug).
    expect(stepPage({ source: ITEMS, page: 0, limit: 2, delta: -1 })).toBe(0);
    // Next past the end stays at the last page.
    expect(stepPage({ source: ITEMS, page: 2, limit: 2, delta: 1 })).toBe(2);
    expect(stepPage({ source: ITEMS, page: 99, limit: 2, delta: 1 })).toBe(2);
    // Delta applies to the page the user SEES (the clamped one).
    expect(stepPage({ source: ITEMS, page: 5, limit: 2, delta: -1 })).toBe(1);
  });

  test("non-number page/delta fall back to sane values", () => {
    expect(stepPage({ source: ITEMS, page: "next", limit: 2, delta: 1 })).toBe(
      1,
    );
    expect(stepPage({ source: ITEMS, page: 0, limit: 2, delta: "-1" })).toBe(0);
    // Fractional deltas truncate.
    expect(stepPage({ source: ITEMS, page: 0, limit: 2, delta: 0.7 })).toBe(0);
    expect(stepPage({ source: ITEMS, page: 1, limit: 2, delta: -1.9 })).toBe(0);
  });

  test("falls back to a single page like sliceItems does", () => {
    expect(stepPage({ source: ITEMS, page: 0, limit: 0, delta: 1 })).toBe(0);
    expect(stepPage({ source: ITEMS, page: 0, limit: -3, delta: 1 })).toBe(0);
    expect(stepPage({ source: ITEMS, page: 1, delta: 1 })).toBe(0);
    expect(stepPage({ source: "nope", page: 0, limit: 2, delta: 1 })).toBe(0);
    expect(stepPage({ page: 0, limit: 2, delta: 1 })).toBe(0);
  });

  test("the catalog registers stepPage under its prompt name", () => {
    expect(PLAYGROUND_FUNCTIONS.stepPage).toBe(stepPage);
  });
});

describe("pageLabel (D2 computed position label)", () => {
  const ITEMS = ["a", "b", "c", "d", "e"]; // 3 pages with limit 2

  test("is 1-based with the true page count", () => {
    expect(pageLabel({ source: ITEMS, page: 0, limit: 2 })).toBe("Page 1 of 3");
    expect(pageLabel({ source: ITEMS, page: 1, limit: 2 })).toBe("Page 2 of 3");
    expect(pageLabel({ source: ITEMS, page: 2, limit: 2 })).toBe("Page 3 of 3");
  });

  test("reports the clamped position, never an out-of-range page", () => {
    expect(pageLabel({ source: ITEMS, page: 99, limit: 2 })).toBe(
      "Page 3 of 3",
    );
    expect(pageLabel({ source: ITEMS, page: -1, limit: 2 })).toBe(
      "Page 1 of 3",
    );
    expect(pageLabel({ source: ITEMS, page: "x", limit: 2 })).toBe(
      "Page 1 of 3",
    );
  });

  test("falls back to a single page like sliceItems does", () => {
    expect(pageLabel({ source: ITEMS, page: 0, limit: 0 })).toBe("Page 1 of 1");
    expect(pageLabel({ source: "nope", page: 0, limit: 2 })).toBe(
      "Page 1 of 1",
    );
    expect(pageLabel({ page: 0, limit: 2 })).toBe("Page 1 of 1");
  });

  test("the catalog registers pageLabel under its prompt name", () => {
    expect(PLAYGROUND_FUNCTIONS.pageLabel).toBe(pageLabel);
  });
});

describe("server pagination args (plan 052 — mirror-supplied bounds)", () => {
  test("an explicit numeric maxPage wins over any source bound", () => {
    expect(stepPage({ page: 3, maxPage: 2, delta: 1 })).toBe(2);
    expect(stepPage({ page: 1, maxPage: 4, delta: -1 })).toBe(0);
    expect(pageLabel({ page: 4, maxPage: 8, limit: 12 })).toBe("Page 5 of 9");
    // Explicit bound beats a contradicting source array.
    expect(
      stepPage({ source: ["a", "b"], page: 1, limit: 2, maxPage: 5, delta: 1 }),
    ).toBe(2);
  });

  test("a present-but-null maxPage (API with no total) leaves the top unclamped", () => {
    // Mirror maxPage null → Next is driven by hasNext visibility, not math.
    expect(stepPage({ page: 0, maxPage: null, delta: 1 })).toBe(1);
    expect(stepPage({ page: 7, maxPage: undefined, delta: 2 })).toBe(9);
    // …but the floor still holds (Previous clamps at the first page).
    expect(stepPage({ page: 0, maxPage: null, delta: -1 })).toBe(0);
  });

  test("pageLabel drops the 'of Y' half when the total is unknown", () => {
    expect(pageLabel({ page: 1, maxPage: null })).toBe("Page 2");
    expect(pageLabel({ page: 0, maxPage: undefined })).toBe("Page 1");
  });

  test("omitting maxPage entirely keeps the legacy one-page degradation", () => {
    expect(pageLabel({ page: 0, limit: 2 })).toBe("Page 1 of 1");
    expect(stepPage({ page: 1, delta: 1 })).toBe(0);
  });
});
