import { describe, expect, test } from "bun:test";
import type { Spec } from "@json-render/core";
import { validateSpec } from "@json-render/core";
import { REVISION_LABELS } from "@/lib/history";
import {
  DROP_ZONES,
  MOVE_DIRECTIONS,
  STRUCTURE_OPS,
  duplicateElement,
  findParentKey,
  getAncestorPath,
  insertElement,
  moveElement,
  moveSibling,
  removeElement,
  resolveMoveTarget,
  structureRevisionLabel,
  unwrapElement,
  wrapElement,
} from "./structure";

function makeSpec(): Spec {
  return {
    root: "card-1",
    elements: {
      "card-1": {
        type: "Card",
        props: { title: "Card" },
        children: ["heading", "stack-1"],
      },
      heading: { type: "Heading", props: { text: "Hello", level: "h1" } },
      "stack-1": {
        type: "Stack",
        props: { direction: "vertical" },
        children: ["text-1", "button-1"],
      },
      "text-1": { type: "Text", props: { text: "Body" } },
      "button-1": { type: "Button", props: { label: "Go" } },
    },
  };
}

describe("tree helpers", () => {
  test("findParentKey walks children and slots", () => {
    const spec = makeSpec();
    expect(findParentKey(spec, "heading")).toBe("card-1");
    expect(findParentKey(spec, "text-1")).toBe("stack-1");
    expect(findParentKey(spec, "card-1")).toBeNull();
  });

  test("getAncestorPath returns root to key", () => {
    const spec = makeSpec();
    expect(getAncestorPath(spec, "text-1")).toEqual([
      "card-1",
      "stack-1",
      "text-1",
    ]);
    expect(getAncestorPath(spec, "missing")).toEqual([]);
  });
});

describe("insertElement", () => {
  test("appends a new child and links it", () => {
    const spec = makeSpec();
    const result = insertElement(spec, {
      parentKey: "stack-1",
      type: "Badge",
      props: { label: "New" },
    });

    expect(result).not.toBeNull();
    expect(result!.key).toBe("badge-1");
    expect(spec.elements["badge-1"]).toBeUndefined();
    expect(result!.spec.elements["badge-1"]).toEqual({
      type: "Badge",
      props: { label: "New" },
      children: [],
    });
    expect(result!.spec.elements["stack-1"].children).toEqual([
      "text-1",
      "button-1",
      "badge-1",
    ]);
    expect(validateSpec(result!.spec).issues).toEqual([]);
  });

  test("inserts at a given index and clamps out-of-range", () => {
    const spec = makeSpec();
    const first = insertElement(spec, {
      parentKey: "card-1",
      type: "Text",
      index: 0,
    });
    expect(first!.spec.elements["card-1"]?.children?.[0]).toBe("text-2");

    const clamped = insertElement(spec, {
      parentKey: "card-1",
      type: "Text",
      index: 99,
    });
    const children = clamped!.spec.elements["card-1"].children ?? [];
    expect(children[children.length - 1]).toBe("text-2");
  });

  test("returns null for a missing parent", () => {
    expect(
      insertElement(makeSpec(), { parentKey: "nope", type: "Text" }),
    ).toBeNull();
  });

  test("generates unique keys across repeated inserts", () => {
    let spec = makeSpec();
    const first = insertElement(spec, { parentKey: "stack-1", type: "Text" });
    spec = first!.spec;
    const second = insertElement(spec, { parentKey: "stack-1", type: "Text" });
    expect(first!.key).toBe("text-2");
    expect(second!.key).toBe("text-3");
  });
});

describe("removeElement", () => {
  test("unlinks the node and deletes its subtree", () => {
    const spec = makeSpec();
    const next = removeElement(spec, "stack-1");

    expect(next).not.toBeNull();
    expect(next!.elements["stack-1"]).toBeUndefined();
    expect(next!.elements["text-1"]).toBeUndefined();
    expect(next!.elements["button-1"]).toBeUndefined();
    expect(next!.elements["card-1"].children).toEqual(["heading"]);
    expect(validateSpec(next!).issues).toEqual([]);
  });

  test("refuses to remove the root", () => {
    expect(removeElement(makeSpec(), "card-1")).toBeNull();
  });
});

describe("wrapElement", () => {
  test("replaces the node with a container at the same index", () => {
    const spec = makeSpec();
    const result = wrapElement(spec, "heading", "Stack", {
      direction: "horizontal",
    });

    expect(result).not.toBeNull();
    expect(result!.key).toBe("stack-2");
    const children = result!.spec.elements["card-1"].children ?? [];
    expect(children).toEqual(["stack-2", "stack-1"]);
    expect(result!.spec.elements["stack-2"].children).toEqual(["heading"]);
    expect(validateSpec(result!.spec).issues).toEqual([]);
  });

  test("wrapping the root promotes the container to root", () => {
    const spec = makeSpec();
    const result = wrapElement(spec, "card-1", "Stack");

    expect(result!.spec.root).toBe("stack-2");
    expect(result!.spec.elements["stack-2"].children).toEqual(["card-1"]);
    expect(validateSpec(result!.spec).issues).toEqual([]);
  });
});

describe("unwrapElement", () => {
  test("splices children into the parent at the container position", () => {
    const spec = makeSpec();
    const next = unwrapElement(spec, "stack-1");

    expect(next).not.toBeNull();
    expect(next!.elements["stack-1"]).toBeUndefined();
    expect(next!.elements["card-1"].children).toEqual([
      "heading",
      "text-1",
      "button-1",
    ]);
    expect(validateSpec(next!).issues).toEqual([]);
  });

  test("root unwrap requires exactly one child", () => {
    const spec = makeSpec();
    expect(unwrapElement(spec, "card-1")).toBeNull();

    const single: Spec = {
      root: "wrap",
      elements: {
        wrap: { type: "Stack", props: {}, children: ["heading"] },
        heading: { type: "Heading", props: { text: "Hi" } },
      },
    };
    const next = unwrapElement(single, "wrap");
    expect(next!.root).toBe("heading");
    expect(next!.elements["wrap"]).toBeUndefined();
  });
});

describe("moveSibling", () => {
  test("swaps with the adjacent sibling", () => {
    const spec = makeSpec();
    const up = moveSibling(spec, "stack-1", MOVE_DIRECTIONS.up);
    expect(up!.elements["card-1"].children).toEqual(["stack-1", "heading"]);

    const down = moveSibling(spec, "heading", MOVE_DIRECTIONS.down);
    expect(down!.elements["card-1"].children).toEqual(["stack-1", "heading"]);
  });

  test("returns null at the boundaries and for parents", () => {
    const spec = makeSpec();
    expect(moveSibling(spec, "heading", MOVE_DIRECTIONS.up)).toBeNull();
    expect(moveSibling(spec, "stack-1", MOVE_DIRECTIONS.down)).toBeNull();
    expect(moveSibling(spec, "card-1", MOVE_DIRECTIONS.up)).toBeNull();
  });
});

describe("moveElement", () => {
  function makeSlotSpec(): Spec {
    return {
      root: "card-1",
      elements: {
        "card-1": {
          type: "Card",
          props: { title: "Card" },
          children: ["heading"],
          slots: { header: ["caption"] },
        },
        heading: { type: "Heading", props: { text: "Hi", level: "h1" } },
        caption: { type: "Text", props: { text: "Cap" } },
      },
    };
  }

  test("moves a subtree across containers", () => {
    const spec = makeSpec();
    const moved = moveElement(spec, {
      key: "text-1",
      targetParentKey: "card-1",
      index: 0,
    });

    expect(moved).not.toBeNull();
    expect(moved!.elements["card-1"].children).toEqual([
      "text-1",
      "heading",
      "stack-1",
    ]);
    expect(moved!.elements["stack-1"].children).toEqual(["button-1"]);
    // Original spec untouched (immutable primitive)
    expect(spec.elements["card-1"].children).toEqual(["heading", "stack-1"]);
  });

  test("same-parent reorder corrects the pre-removal index", () => {
    const spec = makeSpec();
    // "after stack-1" = index 2 in [heading, stack-1]; heading is removed first
    const moved = moveElement(spec, {
      key: "heading",
      targetParentKey: "card-1",
      index: 2,
    });

    expect(moved!.elements["card-1"].children).toEqual(["stack-1", "heading"]);
  });

  test("dropping at the current position is a no-op", () => {
    const spec = makeSpec();
    // Before stack-1 corrects to its own slot → no change, no revision
    expect(
      moveElement(spec, {
        key: "heading",
        targetParentKey: "card-1",
        index: 1,
      }),
    ).toBeNull();
    expect(
      moveElement(spec, {
        key: "heading",
        targetParentKey: "card-1",
        index: 0,
      }),
    ).toBeNull();
  });

  test("refuses cycles, the root, and unknown keys", () => {
    const spec = makeSpec();
    expect(
      moveElement(spec, {
        key: "stack-1",
        targetParentKey: "stack-1",
        index: 0,
      }),
    ).toBeNull();
    expect(
      moveElement(spec, {
        key: "stack-1",
        targetParentKey: "button-1",
        index: 0,
      }),
    ).toBeNull();
    expect(
      moveElement(spec, {
        key: "card-1",
        targetParentKey: "stack-1",
        index: 0,
      }),
    ).toBeNull();
    expect(
      moveElement(spec, {
        key: "missing",
        targetParentKey: "card-1",
        index: 0,
      }),
    ).toBeNull();
    expect(
      moveElement(spec, {
        key: "text-1",
        targetParentKey: "missing",
        index: 0,
      }),
    ).toBeNull();
  });

  test("clamps out-of-range indices", () => {
    const spec = makeSpec();
    const appended = moveElement(spec, {
      key: "text-1",
      targetParentKey: "card-1",
      index: 99,
    });
    expect(appended!.elements["card-1"].children).toEqual([
      "heading",
      "stack-1",
      "text-1",
    ]);

    const prepended = moveElement(spec, {
      key: "heading",
      targetParentKey: "stack-1",
      index: -5,
    });
    expect(prepended!.elements["stack-1"].children).toEqual([
      "heading",
      "text-1",
      "button-1",
    ]);
  });

  test("moves out of a named slot into children", () => {
    const spec = makeSlotSpec();
    expect(
      moveElement(spec, {
        key: "caption",
        targetParentKey: "stack-1",
        index: 0,
      }),
    ).toBeNull(); // stack-1 does not exist in this spec

    const intoCard = moveElement(spec, {
      key: "caption",
      targetParentKey: "card-1",
      index: 1,
    });
    expect(intoCard!.elements["card-1"].slots).toEqual({ header: [] });
    expect(intoCard!.elements["card-1"].children).toEqual([
      "heading",
      "caption",
    ]);
    expect(intoCard!.elements["caption"].type).toBe("Text");
  });
});

describe("resolveMoveTarget", () => {
  test("before/after anchor on the hovered sibling's parent", () => {
    const spec = makeSpec();
    expect(
      resolveMoveTarget(spec, {
        key: "text-1",
        hoverKey: "stack-1",
        zone: DROP_ZONES.before,
      }),
    ).toEqual({ key: "text-1", targetParentKey: "card-1", index: 1 });
    expect(
      resolveMoveTarget(spec, {
        key: "text-1",
        hoverKey: "stack-1",
        zone: DROP_ZONES.after,
      }),
    ).toEqual({ key: "text-1", targetParentKey: "card-1", index: 2 });
  });

  test("inside appends into the hovered container", () => {
    const spec = makeSpec();
    expect(
      resolveMoveTarget(spec, {
        key: "text-1",
        hoverKey: "stack-1",
        zone: DROP_ZONES.inside,
      }),
    ).toEqual({ key: "text-1", targetParentKey: "stack-1", index: 2 });
    // Leaves cannot contain
    expect(
      resolveMoveTarget(spec, {
        key: "stack-1",
        hoverKey: "heading",
        zone: DROP_ZONES.inside,
      }),
    ).toBeNull();
  });

  test("slot children and the root have no before/after anchor", () => {
    const spec: Spec = {
      root: "card-1",
      elements: {
        "card-1": {
          type: "Card",
          props: {},
          children: ["heading"],
          slots: { header: ["caption"] },
        },
        heading: { type: "Heading", props: {} },
        caption: { type: "Text", props: {} },
      },
    };
    expect(
      resolveMoveTarget(spec, {
        key: "heading",
        hoverKey: "caption",
        zone: DROP_ZONES.before,
      }),
    ).toBeNull();
    expect(
      resolveMoveTarget(spec, {
        key: "caption",
        hoverKey: "card-1",
        zone: DROP_ZONES.after,
      }),
    ).toBeNull();
  });

  test("rejects cycles and unknown keys", () => {
    const spec = makeSpec();
    expect(
      resolveMoveTarget(spec, {
        key: "stack-1",
        hoverKey: "stack-1",
        zone: DROP_ZONES.inside,
      }),
    ).toBeNull();
    expect(
      resolveMoveTarget(spec, {
        key: "stack-1",
        hoverKey: "text-1",
        zone: DROP_ZONES.before,
      }),
    ).toBeNull();
    expect(
      resolveMoveTarget(spec, {
        key: "missing",
        hoverKey: "stack-1",
        zone: DROP_ZONES.inside,
      }),
    ).toBeNull();
  });
});

describe("duplicateElement", () => {
  test("copies the subtree with fresh keys after the original", () => {
    const spec = makeSpec();
    const result = duplicateElement(spec, "stack-1");

    expect(result).not.toBeNull();
    expect(result!.key).toBe("stack-2");
    expect(result!.spec.elements["stack-2"].children).toEqual([
      "text-2",
      "button-2",
    ]);
    expect(result!.spec.elements["card-1"].children).toEqual([
      "heading",
      "stack-1",
      "stack-2",
    ]);
    expect(result!.spec.elements["text-2"].props.text).toBe("Body");
    expect(validateSpec(result!.spec).issues).toEqual([]);
  });

  test("refuses to duplicate the root", () => {
    expect(duplicateElement(makeSpec(), "card-1")).toBeNull();
  });
});

describe("structureRevisionLabel", () => {
  test("uses the structure revision prefix", () => {
    expect(structureRevisionLabel(STRUCTURE_OPS.insert, "Stack")).toBe(
      `${REVISION_LABELS.structure}:insert:Stack`,
    );
    expect(structureRevisionLabel(STRUCTURE_OPS.remove)).toBe(
      `${REVISION_LABELS.structure}:remove`,
    );
  });
});
