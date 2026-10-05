import { describe, expect, test } from "bun:test";
import type { Spec } from "@json-render/core";
import { REVISION_LABELS } from "@/lib/history";
import {
  EDIT_ACTION_KEYS,
  PROP_FIELD_KINDS,
  actionRevisionLabel,
  freeformRevisionLabel,
  getEditableFields,
  promptRevisionLabel,
  propertyRevisionLabel,
  replaceProp,
  scopeInstruction,
} from "./editor";

function makeSpec(): Spec {
  return {
    root: "root",
    elements: {
      root: { type: "Card", props: { title: "Card" }, children: ["heading"] },
      heading: { type: "Heading", props: { text: "Hello", level: "h1" } },
    },
  };
}

function zodDef(def: Record<string, unknown>): { _zod: { def: unknown } } {
  return { _zod: { def } };
}

function fakeSchema(shape: Record<string, unknown>): unknown {
  return zodDef({ type: "object", shape });
}

describe("replaceProp", () => {
  test("replaces the prop immutably, leaving other elements untouched", () => {
    const spec = makeSpec();
    const next = replaceProp(spec, "heading", "text", "Changed");

    expect(next).not.toBe(spec);
    expect(next.elements.heading.props.text).toBe("Changed");
    expect(next.elements.heading.props.level).toBe("h1");
    expect(next.elements.root).toBe(spec.elements.root);
    expect(spec.elements.heading.props.text).toBe("Hello");
  });

  test("creates props on an element that has none", () => {
    const spec: Spec = {
      root: "only",
      elements: { only: { type: "Badge", props: {} } },
    };
    const next = replaceProp(spec, "only", "variant", "outline");

    expect(next.elements.only.props.variant).toBe("outline");
  });

  test("returns the spec unchanged for an unknown key", () => {
    const spec = makeSpec();

    expect(replaceProp(spec, "missing", "text", "Nope")).toBe(spec);
  });
});

describe("scopeInstruction", () => {
  test("targets exactly one element and forbids other changes", () => {
    const instruction = scopeInstruction("heading-1", "Heading", "Make it pop");

    expect(instruction).toContain('"heading-1"');
    expect(instruction).toContain('"Heading"');
    expect(instruction).toContain("Make it pop");
    expect(instruction).toContain("leave every other element unchanged");
  });
});

describe("revision labels", () => {
  test("prefix labels with their object-based kind", () => {
    expect(propertyRevisionLabel("text")).toBe(
      `${REVISION_LABELS.property}:text`,
    );
    expect(actionRevisionLabel(EDIT_ACTION_KEYS[0])).toBe(
      `${REVISION_LABELS.action}:${EDIT_ACTION_KEYS[0]}`,
    );
    expect(freeformRevisionLabel("short")).toBe(
      `${REVISION_LABELS.freeform}:short`,
    );
  });

  test("truncates long freeform and prompt labels to 60 characters", () => {
    const long = "x".repeat(100);
    expect(promptRevisionLabel(long)).toHaveLength(
      `${REVISION_LABELS.prompt}:`.length + 60,
    );
    expect(freeformRevisionLabel(long)).toHaveLength(
      `${REVISION_LABELS.freeform}:`.length + 60,
    );
  });
});

describe("getEditableFields", () => {
  test("resolves scalar kinds, enum options, and unwraps optionals", () => {
    const fields = getEditableFields(
      fakeSchema({
        text: zodDef({ type: "string" }),
        count: zodDef({ type: "number" }),
        enabled: zodDef({ type: "boolean" }),
        level: zodDef({ type: "enum", entries: { h1: "h1", h2: "h2" } }),
        title: zodDef({
          type: "optional",
          innerType: zodDef({ type: "string" }),
        }),
        style: zodDef({
          type: "nullable",
          innerType: zodDef({ type: "record" }),
        }),
        tags: zodDef({ type: "array" }),
      }),
    );

    expect(fields).toEqual([
      { name: "text", kind: PROP_FIELD_KINDS.string },
      { name: "count", kind: PROP_FIELD_KINDS.number },
      { name: "enabled", kind: PROP_FIELD_KINDS.boolean },
      { name: "level", kind: PROP_FIELD_KINDS.enum, options: ["h1", "h2"] },
      { name: "title", kind: PROP_FIELD_KINDS.string },
      { name: "style", kind: PROP_FIELD_KINDS.record },
    ]);
  });

  test("returns no fields for a non-object or missing schema", () => {
    expect(getEditableFields(undefined)).toEqual([]);
    expect(getEditableFields(zodDef({ type: "string" }))).toEqual([]);
  });
});

describe("EDIT_ACTION_KEYS", () => {
  test("are unique so icon and translation maps stay aligned", () => {
    expect(new Set(EDIT_ACTION_KEYS).size).toBe(EDIT_ACTION_KEYS.length);
    expect(EDIT_ACTION_KEYS.length).toBeGreaterThan(0);
  });
});
