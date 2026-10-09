import { describe, expect, test } from "bun:test";
import type { Spec, StateModel } from "@json-render/core";
import {
  PROP_TARGET_KINDS,
  analyzePropBinding,
  analyzePropValue,
  chainForKey,
  countKeyInstances,
  mapDomIndexToIndex,
  resolveChainBasePath,
  resolveDataPath,
  resolveInstanceScope,
  resolvePropDisplay,
} from "./instance-path";
import type { InstanceChain } from "./instance-path";

/** Flat spec: one repeat (`/images`) whose item filter hides `hidden` items. */
function makeSpec(): Spec {
  return {
    root: "root",
    elements: {
      root: { type: "Stack", props: {}, children: ["grid"] },
      grid: {
        type: "Grid",
        props: {},
        repeat: { statePath: "/images", key: "id" },
        children: ["item"],
        visible: { $item: "hidden", not: true },
      },
      item: {
        type: "Text",
        props: {
          text: { $item: "title" },
          className: "card",
          badge: { $state: "/badge" },
        },
      },
    },
    state: {
      badge: "New",
      images: [
        { id: "a", title: "Alpha", hidden: true },
        { id: "b", title: "Bravo", hidden: false },
        { id: "c", title: "Charlie", hidden: false },
      ],
    },
  };
}

/** Nested spec: outer `/groups` repeat, inner repeat over `{$item: "items"}`. */
function makeNestedSpec(): Spec {
  return {
    root: "root",
    elements: {
      root: { type: "Stack", props: {}, children: ["groups"] },
      groups: {
        type: "Stack",
        props: {},
        repeat: { statePath: "/groups", key: "id" },
        children: ["inner"],
      },
      inner: {
        type: "Stack",
        props: {},
        repeat: { statePath: { $item: "items" }, key: "id" },
        children: ["row"],
      },
      row: { type: "Text", props: { text: { $item: "name" } } },
    },
    state: {
      groups: [
        {
          id: "g0",
          items: [
            { id: "x", name: "X" },
            { id: "y", name: "Y" },
          ],
        },
        { id: "g1", items: [{ id: "z", name: "Z" }] },
      ],
    },
  };
}

function stateOf(spec: Spec): StateModel {
  return spec.state ?? {};
}

describe("analyzePropValue", () => {
  test("classifies literals as template edits", () => {
    expect(analyzePropValue("hello")).toEqual({
      kind: PROP_TARGET_KINDS.template,
    });
    expect(analyzePropValue(42)).toEqual({
      kind: PROP_TARGET_KINDS.template,
    });
    expect(analyzePropValue(null)).toEqual({
      kind: PROP_TARGET_KINDS.template,
    });
    expect(analyzePropValue({ color: "red" })).toEqual({
      kind: PROP_TARGET_KINDS.template,
    });
    expect(analyzePropValue(undefined)).toEqual({
      kind: PROP_TARGET_KINDS.template,
    });
  });

  test("classifies state and item expressions as data targets", () => {
    expect(analyzePropValue({ $state: "/badge" })).toEqual({
      kind: PROP_TARGET_KINDS.state,
      path: "/badge",
    });
    expect(analyzePropValue({ $bindState: "/name" })).toEqual({
      kind: PROP_TARGET_KINDS.state,
      path: "/name",
    });
    expect(analyzePropValue({ $item: "title" })).toEqual({
      kind: PROP_TARGET_KINDS.item,
      field: "title",
    });
    expect(analyzePropValue({ $bindItem: "title" })).toEqual({
      kind: PROP_TARGET_KINDS.item,
      field: "title",
    });
  });

  test("classifies composites as read-only", () => {
    expect(analyzePropValue({ $template: "Hi ${/badge}" })).toEqual({
      kind: PROP_TARGET_KINDS.readonly,
    });
    expect(
      analyzePropValue({ $cond: { $state: "/x" }, $then: 1, $else: 2 }),
    ).toEqual({ kind: PROP_TARGET_KINDS.readonly });
    expect(analyzePropValue({ $index: true })).toEqual({
      kind: PROP_TARGET_KINDS.readonly,
    });
    expect(analyzePropValue(["a", "b"])).toEqual({
      kind: PROP_TARGET_KINDS.template,
    });
  });
});

describe("mapDomIndexToIndex", () => {
  const state: StateModel = { show: true };

  test("identity-maps when there is no item filter", () => {
    const items = ["a", "b", "c"];
    expect(mapDomIndexToIndex(items, undefined, 1, state)).toBe(1);
    expect(mapDomIndexToIndex(items, undefined, 0, state)).toBe(0);
    expect(mapDomIndexToIndex(items, undefined, 3, state)).toBeNull();
    expect(mapDomIndexToIndex(items, undefined, -1, state)).toBeNull();
  });

  test("remaps through the filter to source indexes", () => {
    const items = ["a", "b", "c", "d"];
    const filter = { $item: "skip", not: true } as const;
    // Source items b and d are visible (a and c skipped).
    const skipped = [
      { skip: true },
      { skip: false },
      { skip: true },
      { skip: false },
    ];
    expect(mapDomIndexToIndex(skipped, filter, 0, state)).toBe(1);
    expect(mapDomIndexToIndex(skipped, filter, 1, state)).toBe(3);
    expect(mapDomIndexToIndex(skipped, filter, 2, state)).toBeNull();
    expect(items).toHaveLength(4);
  });
});

describe("resolveChainBasePath", () => {
  test("resolves the picked item path through a filtered repeat", () => {
    const spec = makeSpec();
    const chain: InstanceChain = [{ containerKey: "grid", domIndex: 1 }];
    expect(resolveChainBasePath(spec, stateOf(spec), chain)).toBe("/images/2");
  });

  test("maps the first DOM slot to the first visible item", () => {
    const spec = makeSpec();
    const chain: InstanceChain = [{ containerKey: "grid", domIndex: 0 }];
    expect(resolveChainBasePath(spec, stateOf(spec), chain)).toBe("/images/1");
  });

  test("returns null for empty, unknown, or out-of-range chains", () => {
    const spec = makeSpec();
    const state = stateOf(spec);
    expect(resolveChainBasePath(spec, state, [])).toBeNull();
    expect(
      resolveChainBasePath(spec, state, [
        { containerKey: "nope", domIndex: 0 },
      ]),
    ).toBeNull();
    expect(
      resolveChainBasePath(spec, state, [
        { containerKey: "grid", domIndex: 9 },
      ]),
    ).toBeNull();
  });

  test("resolves nested repeats via {$item} inner state paths", () => {
    const spec = makeNestedSpec();
    const chain: InstanceChain = [
      { containerKey: "groups", domIndex: 0 },
      { containerKey: "inner", domIndex: 1 },
    ];
    expect(resolveChainBasePath(spec, stateOf(spec), chain)).toBe(
      "/groups/0/items/1",
    );
  });
});

describe("resolveDataPath", () => {
  test("state targets ignore the chain and keep their path", () => {
    const spec = makeSpec();
    expect(
      resolveDataPath(spec, stateOf(spec), [], {
        kind: PROP_TARGET_KINDS.state,
        path: "/badge",
      }),
    ).toBe("/badge");
  });

  test("item targets join the chain base with the field", () => {
    const spec = makeSpec();
    expect(
      resolveDataPath(
        spec,
        stateOf(spec),
        [{ containerKey: "grid", domIndex: 1 }],
        { kind: PROP_TARGET_KINDS.item, field: "title" },
      ),
    ).toBe("/images/2/title");
  });

  test("item targets without a chain are unresolvable", () => {
    const spec = makeSpec();
    expect(
      resolveDataPath(spec, stateOf(spec), [], {
        kind: PROP_TARGET_KINDS.item,
        field: "title",
      }),
    ).toBeNull();
  });
});

describe("resolveInstanceScope", () => {
  test("reports base path, source index, and visible count", () => {
    const spec = makeSpec();
    const scope = resolveInstanceScope(spec, stateOf(spec), [
      { containerKey: "grid", domIndex: 1 },
    ]);
    expect(scope).toEqual({ basePath: "/images/2", itemIndex: 2, count: 2 });
  });

  test("returns null for an empty chain", () => {
    const spec = makeSpec();
    expect(resolveInstanceScope(spec, stateOf(spec), [])).toBeNull();
  });
});

describe("analyzePropBinding", () => {
  test("item props write the instance data path with a resolved display", () => {
    const spec = makeSpec();
    const binding = analyzePropBinding(
      spec,
      stateOf(spec),
      [{ containerKey: "grid", domIndex: 1 }],
      { $item: "title" },
    );
    expect(binding.dataPath).toBe("/images/2/title");
    expect(binding.readonly).toBe(false);
    expect(binding.displayValue).toBe("Charlie");
  });

  test("item props without a chain are read-only and show the raw value", () => {
    const spec = makeSpec();
    const raw = { $item: "title" };
    const binding = analyzePropBinding(spec, stateOf(spec), [], raw);
    expect(binding.dataPath).toBeNull();
    expect(binding.readonly).toBe(true);
    expect(binding.displayValue).toBe(raw);
  });

  test("literal props stay template edits", () => {
    const spec = makeSpec();
    const binding = analyzePropBinding(
      spec,
      stateOf(spec),
      [{ containerKey: "grid", domIndex: 1 }],
      "card",
    );
    expect(binding.dataPath).toBeNull();
    expect(binding.readonly).toBe(false);
    expect(binding.displayValue).toBe("card");
  });

  test("state props write their absolute path regardless of chain", () => {
    const spec = makeSpec();
    const binding = analyzePropBinding(
      spec,
      stateOf(spec),
      [{ containerKey: "grid", domIndex: 1 }],
      { $state: "/badge" },
    );
    expect(binding.dataPath).toBe("/badge");
    expect(binding.displayValue).toBe("New");
    expect(binding.readonly).toBe(false);
  });

  test("composite expressions are read-only", () => {
    const spec = makeSpec();
    const binding = analyzePropBinding(spec, stateOf(spec), [], {
      $cond: { $state: "/badge" },
      $then: "yes",
      $else: "no",
    });
    expect(binding.readonly).toBe(true);
    expect(binding.dataPath).toBeNull();
  });
});

describe("resolvePropDisplay", () => {
  test("resolves $template against state", () => {
    const spec = makeSpec();
    expect(
      resolvePropDisplay(spec, stateOf(spec), [], {
        $template: "Badge: ${/badge}",
      }),
    ).toBe("Badge: New");
  });

  test("literal values pass through untouched", () => {
    const spec = makeSpec();
    expect(resolvePropDisplay(spec, stateOf(spec), [], "card")).toBe("card");
  });
});

describe("chainForKey", () => {
  test("keeps the level while the target sits below its container", () => {
    const spec = makeSpec();
    const chain: InstanceChain = [{ containerKey: "grid", domIndex: 1 }];
    expect(chainForKey(spec, chain, "item")).toEqual(chain);
  });

  test("drops the level when the target is the container itself", () => {
    const spec = makeSpec();
    const chain: InstanceChain = [{ containerKey: "grid", domIndex: 1 }];
    expect(chainForKey(spec, chain, "grid")).toBeNull();
  });

  test("drops every level when the target leaves the repeat subtree", () => {
    const spec = makeSpec();
    const chain: InstanceChain = [{ containerKey: "grid", domIndex: 1 }];
    expect(chainForKey(spec, chain, "root")).toBeNull();
  });

  test("empty chains stay empty", () => {
    const spec = makeSpec();
    expect(chainForKey(spec, [], "item")).toBeNull();
  });
});

describe("countKeyInstances", () => {
  test("counts rendered instances through a filtered repeat", () => {
    const spec = makeSpec();
    // 3 images, one hidden by the item filter.
    expect(countKeyInstances(spec, "item")).toBe(2);
    expect(countKeyInstances(spec, "grid")).toBe(2);
    expect(countKeyInstances(spec, "root")).toBe(1);
  });

  test("multiplies nested repeats", () => {
    const spec = makeNestedSpec();
    expect(countKeyInstances(spec, "row")).toBe(3);
    // The inner container is itself repeated: 2 items in g0 + 1 in g1.
    expect(countKeyInstances(spec, "inner")).toBe(3);
    expect(countKeyInstances(spec, "groups")).toBe(2);
  });

  test("unknown keys count zero", () => {
    expect(countKeyInstances(makeSpec(), "missing")).toBe(0);
  });
});
