import { describe, expect, test } from "bun:test";
import type { UIElement } from "@json-render/core";
import {
  collectStatePointers,
  elementStatePaths,
  flattenStateRows,
  isQueryStatusPath,
  splitStateRows,
  statusSelectOptions,
} from "@/lib/editor/state-inspect";

function element(fields: Partial<UIElement>): UIElement {
  return { type: "Text", ...fields } as UIElement;
}

describe("collectStatePointers", () => {
  test("collects a single $state", () => {
    expect(
      collectStatePointers({
        $state: "/queries/pokedexList/status",
        eq: "loading",
      }),
    ).toEqual(["/queries/pokedexList/status"]);
  });

  test("collects through arrays and nested conditions", () => {
    expect(
      collectStatePointers([
        { $state: "/queries/pokedexList/count", eq: 0 },
        { $or: [{ $state: "/page", gt: 0 }, { $state: "/flag" }] },
      ]),
    ).toEqual(["/queries/pokedexList/count", "/page", "/flag"]);
  });

  test("comparison RHS { $state } is collected too", () => {
    expect(
      collectStatePointers({ $state: "/a", eq: { $state: "/b" } }),
    ).toEqual(["/a", "/b"]);
  });

  test("non-condition values yield nothing", () => {
    expect(collectStatePointers("plain")).toEqual([]);
    expect(collectStatePointers({ text: "hi" })).toEqual([]);
  });
});

describe("elementStatePaths", () => {
  test("unconditional element has no paths", () => {
    expect(elementStatePaths(element({}))).toEqual([]);
  });

  test("visible + watch + string repeat merge into one deduped list", () => {
    const paths = elementStatePaths(
      element({
        visible: { $state: "/page", gt: 0 },
        watch: { "/page": { action: "setState", params: {} }, "/limit": [] },
        repeat: { statePath: "/items", key: "id" },
      }),
    );
    expect(paths.sort()).toEqual(["/items", "/limit", "/page"]);
  });

  test("item-scoped repeat paths are skipped", () => {
    expect(
      elementStatePaths(element({ repeat: { statePath: { $item: "types" } } })),
    ).toEqual([]);
  });

  test("visible:true contributes nothing", () => {
    expect(elementStatePaths(element({ visible: true }))).toEqual([]);
  });
});

describe("flattenStateRows", () => {
  test("flattens nested state into sorted pointers with summaries", () => {
    const rows = flattenStateRows({
      page: 0,
      queries: { pokedexList: { status: "success", data: [1, 2, 3] } },
      flag: true,
    });
    expect(rows).toEqual([
      { path: "/flag", display: "true" },
      { path: "/page", display: "0" },
      { path: "/queries/pokedexList/data", display: "[…] 3 items" },
      { path: "/queries/pokedexList/status", display: "success" },
    ]);
  });

  test("empty object collapses to its summary row", () => {
    expect(flattenStateRows({ empty: {} })).toEqual([
      { path: "/empty", display: "{…} 0 keys" },
    ]);
  });

  test("long strings truncate", () => {
    const rows = flattenStateRows({ s: "x".repeat(200) });
    expect(rows[0].display.length).toBeLessThan(130);
    // quoted + ellipsis inside the quotes: "xxxx…"
    expect(rows[0].display.startsWith('"')).toBe(true);
    expect(rows[0].display.endsWith('…"')).toBe(true);
  });
});

describe("isQueryStatusPath", () => {
  test("matches query lifecycle status pointers", () => {
    expect(isQueryStatusPath("/queries/pokedexList/status")).toBe(true);
    expect(isQueryStatusPath("/queries/a-b/status")).toBe(true);
  });

  test("rejects other paths", () => {
    expect(isQueryStatusPath("/queries/pokedexList/count")).toBe(false);
    expect(isQueryStatusPath("/status")).toBe(false);
    expect(isQueryStatusPath("/queries/status")).toBe(false);
    expect(isQueryStatusPath("/queries/list/status/extra")).toBe(false);
    expect(isQueryStatusPath("/page")).toBe(false);
  });
});

describe("statusSelectOptions", () => {
  test("returns the four lifecycle values for in-domain input", () => {
    expect(statusSelectOptions("success")).toEqual([
      "idle",
      "loading",
      "success",
      "error",
    ]);
  });

  test("keeps an out-of-domain current value as an extra option", () => {
    const options = statusSelectOptions("weird");
    expect(options).toEqual(["idle", "loading", "success", "error", "weird"]);
  });

  test("empty current value does not add an option", () => {
    expect(statusSelectOptions("")).toHaveLength(4);
  });
});

describe("splitStateRows", () => {
  const rows = flattenStateRows({
    page: 0,
    limit: 12,
    queries: { pokedexList: { status: "success" } },
  });

  test("partitions rows into used/other preserving order", () => {
    const { used, other } = splitStateRows(rows, [
      "/page",
      "/queries/pokedexList/status",
    ]);
    expect(used.map((r) => r.path)).toEqual([
      "/page",
      "/queries/pokedexList/status",
    ]);
    expect(other.map((r) => r.path)).toEqual(["/limit"]);
  });

  test("no used paths → everything lands in other", () => {
    const { used, other } = splitStateRows(rows, []);
    expect(used).toEqual([]);
    expect(other).toHaveLength(3);
  });

  test("used path missing from the store still gets a row with —", () => {
    const { used, other } = splitStateRows(rows, ["/never/set"]);
    expect(used).toEqual([{ path: "/never/set", display: "—" }]);
    expect(other).toHaveLength(3);
  });

  test("works with a Set as the used-path source", () => {
    const { used } = splitStateRows(rows, new Set(["/limit"]));
    expect(used.map((r) => r.path)).toEqual(["/limit"]);
  });
});
