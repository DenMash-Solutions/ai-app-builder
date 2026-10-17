import { describe, expect, test } from "bun:test";
import {
  getEditableFields,
  PROP_FIELD_KINDS,
  PROP_FIELD_VARIANTS,
} from "../editor";
import {
  examplePropsFor,
  isContainerType,
  pickerItems,
  playgroundCatalog,
} from "./catalog";

interface DefinitionLike {
  props: unknown;
  events?: readonly string[];
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
        variant: PROP_FIELD_VARIANTS.className,
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

describe("playgroundCatalog Icon component", () => {
  test("the model prompt exposes the Icon line with its name union and press event", () => {
    const prompt = playgroundCatalog.prompt({ editModes: ["patch"] });
    const line = prompt
      .split("\n")
      .find((entry) => entry.startsWith("- Icon:"));
    expect(line).toBeDefined();
    expect(line).toContain('"sparkles"');
    expect(line).toContain('"arrow-right"');
    expect(line).toContain("size?");
    expect(line).toContain("[events: press]");
  });

  test("the name prop rejects anything outside the curated set", () => {
    const icon = componentDefinitions().find(([name]) => name === "Icon");
    expect(icon).toBeDefined();
    const props = icon?.[1].props as {
      safeParse: (value: unknown) => { success: boolean };
    };
    // (className/style are required-nullable across every definition today —
    // a pre-existing schema-vs-prompt quirk with no ingest teeth; pass them
    // explicitly to isolate the enum assertion.)
    expect(
      props.safeParse({ name: "sparkles", className: null, style: null })
        .success,
    ).toBe(true);
    expect(
      props.safeParse({
        name: "definitely-not-an-icon",
        className: null,
        style: null,
      }).success,
    ).toBe(false);
  });

  test("insert affordances: leaf with example defaults, listed in the picker", () => {
    expect(isContainerType("Icon")).toBe(false);
    expect(examplePropsFor("Icon")).toEqual({ name: "sparkles" });
    const item = pickerItems().find((entry) => entry.name === "Icon");
    expect(item).toBeDefined();
    expect(item?.description).toContain("Lucide");
    expect(item?.container).toBe(false);
  });
});

describe("playgroundCatalog D5/D7 extensions", () => {
  test("Button declares icon props over the curated enum", () => {
    const definitions = componentDefinitions();
    const button = definitions.find(([name]) => name === "Button")?.[1];
    expect(button).toBeDefined();
    if (!button) throw new Error("Button definition missing");
    const shape = shapeOf(button);
    expect(shape).toHaveProperty("leadingIcon");
    expect(shape).toHaveProperty("trailingIcon");

    const props = button.props as {
      safeParse: (value: unknown) => { success: boolean };
    };
    expect(
      props.safeParse({
        label: "Next",
        variant: "primary",
        disabled: false,
        leadingIcon: "arrow-left",
        trailingIcon: "arrow-right",
        className: null,
        style: null,
      }).success,
    ).toBe(true);
    expect(
      props.safeParse({
        label: "Next",
        leadingIcon: "definitely-not-an-icon",
        className: null,
        style: null,
      }).success,
    ).toBe(false);
  });

  test("Input declares change alongside its upstream events", () => {
    const input = componentDefinitions().find(([name]) => name === "Input");
    expect(input).toBeDefined();
    const events = input?.[1].events;
    expect(events).toContain("change");
    expect(events).toContain("submit");
    expect(events).toContain("focus");
    expect(events).toContain("blur");
  });

  test("pagination functions are registered as catalog functions", () => {
    const data = playgroundCatalog.data as {
      functions?: Record<string, unknown>;
    };
    expect(typeof data.functions?.filterItems).toBe("function");
    expect(typeof data.functions?.stepPage).toBe("function");
    expect(typeof data.functions?.pageLabel).toBe("function");
  });

  test("the model prompt documents the additions", () => {
    const prompt = playgroundCatalog.prompt({ editModes: ["patch"] });
    // Functions are auto-listed by name, in registration order — `add` was
    // dropped (D8r) in favor of $math, and $math increments were superseded
    // by stepPage (D2, docs/plan/responsive-ui).
    expect(prompt).toMatch(
      /Available functions:\s*\n\s*- filterItems\n\s*- sliceItems\n\s*- stepPage\n\s*- pageLabel\b/,
    );
    expect(prompt).not.toMatch(/- filterItems\n\s*- sliceItems\n\s*- add\b/);

    const buttonLine = prompt
      .split("\n")
      .find((entry) => entry.startsWith("- Button:"));
    expect(buttonLine).toBeDefined();
    expect(buttonLine).toContain("leadingIcon?");
    expect(buttonLine).toContain('"arrow-left"');
    expect(buttonLine).toContain("trailingIcon?");

    const inputLine = prompt
      .split("\n")
      .find((entry) => entry.startsWith("- Input:"));
    expect(inputLine).toBeDefined();
    const events = inputLine?.match(/\[events: ([^\]]+)\]/);
    expect(events?.[1]).toContain("change");
  });
});
