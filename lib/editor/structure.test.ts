import { describe, expect, test } from "bun:test";
import type { Spec } from "@json-render/core";
import { validateSpec } from "@json-render/core";
import { REVISION_LABELS } from "@/lib/history";
import {
  MOVE_DIRECTIONS,
  STRUCTURE_OPS,
  duplicateElement,
  findParentKey,
  getAncestorPath,
  insertElement,
  moveSibling,
  removeElement,
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
