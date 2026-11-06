import { describe, expect, test } from "bun:test";
import {
  CATALOG_RULES,
  MAX_LISTED_COMPONENTS,
  componentBlock,
  parseComponents,
} from "./catalog-rules";

describe("CATALOG_RULES", () => {
  test("teaches the marker shape verbatim (mistake #22: spell it out)", () => {
    expect(CATALOG_RULES).toContain('"data-component-ref": "<id>"');
    expect(CATALOG_RULES).toContain('"children": []');
    expect(CATALOG_RULES).toContain('"type": "Stack"');
    expect(CATALOG_RULES).toContain("Project components");
  });

  test("pairs with the list — only listed ids are valid, unknown dropped", () => {
    expect(CATALOG_RULES).toContain("Project components");
    expect(CATALOG_RULES).toContain("NEVER invent an id");
    expect(CATALOG_RULES).toContain("silently dropped");
    expect(CATALOG_RULES).toContain('no "Project components" list');
  });

  test("the marker is a placeholder: empty children, never re-authored", () => {
    expect(CATALOG_RULES).toContain("must stay empty");
    expect(CATALOG_RULES).toContain("NEVER write the component's internals");
  });

  test("edit mode keeps already-expanded components untouched", () => {
    expect(CATALOG_RULES).toContain('"data-template-id"');
    expect(CATALOG_RULES).toContain("never wrap, duplicate, or strip");
    expect(CATALOG_RULES).toContain("do not also mark their position");
  });
});

describe("parseComponents", () => {
  test("keeps well-formed pairs and falls back to the id for a blank name", () => {
    expect(
      parseComponents([
        { id: "aaa", name: "Navbar" },
        { id: "bbb", name: "   " },
      ]),
    ).toEqual([
      { id: "aaa", name: "Navbar" },
      { id: "bbb", name: "bbb" },
    ]);
  });

  test("drops non-arrays, junk entries and empty ids (never fails a run)", () => {
    expect(parseComponents(undefined)).toEqual([]);
    expect(parseComponents("aaa")).toEqual([]);
    expect(
      parseComponents([
        null,
        "aaa",
        42,
        { name: "no id" },
        { id: "" },
        { id: "  " },
        { id: "ok", name: "Fine" },
      ]),
    ).toEqual([{ id: "ok", name: "Fine" }]);
  });

  test(`caps the list at ${MAX_LISTED_COMPONENTS} entries`, () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      id: `comp-${index}`,
      name: `Component ${index}`,
    }));
    expect(parseComponents(many)).toHaveLength(MAX_LISTED_COMPONENTS);
    expect(parseComponents(many)[MAX_LISTED_COMPONENTS - 1].id).toBe(
      `comp-${MAX_LISTED_COMPONENTS - 1}`,
    );
  });
});

describe("componentBlock", () => {
  test("lists id — name lines under the Project components header", () => {
    const block = componentBlock([
      { id: "aaa", name: "Navbar" },
      { id: "bbb", name: "Cart button" },
    ]);

    expect(block).toContain("Project components");
    expect(block).toContain("the ONLY valid `data-component-ref` values");
    expect(block).toContain('- "aaa" — Navbar');
    expect(block).toContain('- "bbb" — Cart button');
  });

  test("omits the name when it is the id itself", () => {
    const block = componentBlock([{ id: "aaa", name: "aaa" }]);
    expect(block).toContain('- "aaa"');
    expect(block.endsWith('- "aaa"')).toBe(true);
  });

  test("an empty list renders nothing (the route ships neither half alone)", () => {
    expect(componentBlock([])).toBe("");
  });
});
