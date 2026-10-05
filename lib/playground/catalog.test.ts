import { describe, expect, test } from "bun:test";
import { getEditableFields, PROP_FIELD_KINDS } from "../editor";
import { playgroundCatalog } from "./catalog";

interface DefinitionLike {
  props: unknown;
}

function componentDefinitions(): Array<[string, DefinitionLike]> {
  const data = playgroundCatalog.data as {
    components: Record<string, DefinitionLike>;
  };
  return Object.entries(data.components);
}

function shapeOf(definition: DefinitionLike): Record<string, unknown> {
  return (definition.props as { shape: Record<string, unknown> }).shape;
}

describe("playgroundCatalog style props", () => {
  const definitions = componentDefinitions();

  test("exposes className and style on every component", () => {
    expect(definitions.length).toBeGreaterThan(0);
    for (const [name, definition] of definitions) {
      const shape = shapeOf(definition);
      expect(Object.keys(shape), name).toContain("className");
      expect(Object.keys(shape), name).toContain("style");
    }
  });

  test("className is editable as a string field on every component", () => {
    for (const [name, definition] of definitions) {
      const fields = getEditableFields(definition.props);
      expect(fields, name).toContainEqual({
        name: "className",
        kind: PROP_FIELD_KINDS.string,
      });
    }
  });

  test("Button accepts tailwind classes and inline styles", () => {
    const button = definitions.find(([name]) => name === "Button");
    expect(button).toBeDefined();
    const props = button?.[1].props as {
      safeParse: (value: unknown) => { success: boolean };
    };
    const result = props.safeParse({
      label: "Sign In",
      variant: "primary",
      disabled: false,
      className: "w-full bg-blue-400",
      style: { color: "#1e3a8a", width: "100%" },
    });
    expect(result.success).toBe(true);
  });
});
