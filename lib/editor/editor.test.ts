import { describe, expect, test } from "bun:test";
import type { Spec, UIElement } from "@json-render/core";
import { REVISION_LABELS } from "@/lib/history";
import {
  EDIT_ACTION_KEYS,
  PROP_FIELD_KINDS,
  PROP_FIELD_VARIANTS,
  actionRevisionLabel,
  freeformRevisionLabel,
  getEditableFields,
  navigateBindingOf,
  navigateRecordParamOf,
  navigateRevisionLabel,
  promptRevisionLabel,
  propertyRevisionLabel,
  replaceNavigateBinding,
  replaceProp,
  replaceVisible,
  scopeInstruction,
  scopeTargetsInstruction,
  setNavigateRecordParam,
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

describe("replaceVisible", () => {
  test("sets a condition immutably, leaving other elements untouched", () => {
    const spec = makeSpec();
    const next = replaceVisible(spec, "heading", {
      $state: "/page",
      gt: 0,
    });

    expect(next).not.toBe(spec);
    expect(next.elements.heading.visible).toEqual({ $state: "/page", gt: 0 });
    expect(next.elements.heading.props.text).toBe("Hello");
    expect(next.elements.root).toBe(spec.elements.root);
    expect(spec.elements.heading.visible).toBeUndefined();
  });

  test("undefined removes the condition (element always shown)", () => {
    const spec = makeSpec();
    const conditioned = replaceVisible(spec, "heading", {
      $state: "/page",
      eq: 1,
    });

    const next = replaceVisible(conditioned, "heading", undefined);

    expect("visible" in next.elements.heading).toBe(false);
    expect(next.elements.heading.props.text).toBe("Hello");
  });

  test("returns the spec unchanged for an unknown key", () => {
    const spec = makeSpec();

    expect(replaceVisible(spec, "missing", { $state: "/page", eq: 1 })).toBe(
      spec,
    );
  });
});

describe("navigate bindings (061)", () => {
  function pressSpec(press: NonNullable<UIElement["on"]>["press"]): Spec {
    return {
      root: "root",
      elements: {
        heading: {
          type: "Heading",
          props: { text: "Hello" },
          on: { press },
        },
      },
    };
  }

  test("reads the press binding and writes it immutably", () => {
    const spec = makeSpec();
    expect(navigateBindingOf(spec.elements.heading)).toBeNull();

    const bound = replaceNavigateBinding(spec, "heading", "screen-b");

    expect(navigateBindingOf(bound.elements.heading)).toBe("screen-b");
    expect(bound.elements.heading.on?.press).toEqual({
      action: "navigate",
      params: { screen: "screen-b" },
    });
    // The source spec is untouched (undo relies on it).
    expect(navigateBindingOf(spec.elements.heading)).toBeNull();
  });

  test("retargeting preserves a sibling press binding (array form)", () => {
    const spec = pressSpec({
      action: "data_mutate",
      params: { op: "create", resource: "notes" },
    });

    const bound = replaceNavigateBinding(spec, "heading", "s2");
    expect(bound.elements.heading.on?.press).toEqual([
      { action: "data_mutate", params: { op: "create", resource: "notes" } },
      { action: "navigate", params: { screen: "s2" } },
    ]);

    const retargeted = replaceNavigateBinding(bound, "heading", "s3");
    const press = retargeted.elements.heading.on?.press;
    expect(navigateBindingOf(retargeted.elements.heading)).toBe("s3");
    expect(Array.isArray(press) && press.length).toBe(2);
  });

  test("clearing removes only the navigate binding", () => {
    const spec = pressSpec([
      { action: "data_mutate", params: { op: "create" } },
      { action: "navigate", params: { screen: "s1" } },
    ]);

    const cleared = replaceNavigateBinding(spec, "heading", null);

    expect(cleared.elements.heading.on?.press).toEqual({
      action: "data_mutate",
      params: { op: "create" },
    });
    expect(navigateBindingOf(cleared.elements.heading)).toBeNull();
  });

  test("clearing the only binding removes press but keeps the element", () => {
    const bound = replaceNavigateBinding(makeSpec(), "heading", "s1");
    const cleared = replaceNavigateBinding(bound, "heading", null);

    expect(cleared.elements.heading.on?.press).toBeUndefined();
    expect(cleared.elements.heading.props.text).toBe("Hello");
  });

  test("returns the spec unchanged for an unknown key", () => {
    const spec = makeSpec();
    expect(replaceNavigateBinding(spec, "missing", "s1")).toBe(spec);
  });

  test("the revision label uses the action kind", () => {
    expect(navigateRevisionLabel()).toBe(`${REVISION_LABELS.action}:navigate`);
  });

  describe("record id param (061-3, §C)", () => {
    test("reads the record id only at the param it was written to", () => {
      const spec = replaceNavigateBinding(makeSpec(), "heading", "s1");
      expect(navigateRecordParamOf(spec.elements.heading, "id")).toBe(false);

      const on = setNavigateRecordParam(spec, "heading", "id");

      expect(navigateRecordParamOf(on.elements.heading, "id")).toBe(true);
      expect(navigateRecordParamOf(on.elements.heading, "slug")).toBe(false);
      // The source spec is untouched (undo relies on it).
      expect(navigateRecordParamOf(spec.elements.heading, "id")).toBe(false);
    });

    test("writing preserves the screen param and sibling press bindings", () => {
      const spec = pressSpec([
        { action: "data_mutate", params: { op: "create", resource: "notes" } },
        { action: "navigate", params: { screen: "s1" } },
      ]);

      const next = setNavigateRecordParam(spec, "heading", "id");

      expect(next.elements.heading.on?.press).toEqual([
        { action: "data_mutate", params: { op: "create", resource: "notes" } },
        { action: "navigate", params: { screen: "s1", id: { $item: "id" } } },
      ]);
      expect(navigateRecordParamOf(next.elements.heading, "id")).toBe(true);
    });

    test("clearing drops the record id and keeps the screen param", () => {
      const bound = replaceNavigateBinding(makeSpec(), "heading", "s1");
      const on = setNavigateRecordParam(bound, "heading", "id");

      const off = setNavigateRecordParam(on, "heading", null);

      expect(off.elements.heading.on?.press).toEqual({
        action: "navigate",
        params: { screen: "s1" },
      });
      expect(navigateRecordParamOf(off.elements.heading, "id")).toBe(false);
    });

    test("no-op writes return the same spec so no revision is committed", () => {
      const bound = replaceNavigateBinding(makeSpec(), "heading", "s1");
      const on = setNavigateRecordParam(bound, "heading", "id");
      const off = setNavigateRecordParam(on, "heading", null);

      expect(setNavigateRecordParam(on, "heading", "id")).toBe(on);
      expect(setNavigateRecordParam(off, "heading", null)).toBe(off);
      // Nothing to write or clear on an element that never navigates.
      const plain = makeSpec();
      expect(setNavigateRecordParam(plain, "heading", "id")).toBe(plain);
    });

    test("unknown keys and non-navigate bindings are left alone", () => {
      const spec = replaceNavigateBinding(makeSpec(), "heading", "s1");
      expect(setNavigateRecordParam(spec, "missing", "id")).toBe(spec);

      const other = pressSpec({
        action: "data_mutate",
        params: { op: "create" },
      });
      expect(setNavigateRecordParam(other, "heading", "id")).toBe(other);
      expect(navigateRecordParamOf(other.elements.heading, "id")).toBe(false);
    });
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

  test("describes the instance scope when the selection is repeat-scoped", () => {
    const instruction = scopeInstruction("text", "Text", "Fix the label", {
      basePath: "/images/2",
      itemIndex: 2,
      count: 3,
    });

    expect(instruction).toContain(
      'element "text" (component type "Text"), instance 3 of 3, state path "/images/2"',
    );
    expect(instruction).toContain("Fix the label");
  });
});

/** Repeat spec mirroring instance-path fixtures: `/images` with one hidden item. */
function makeRepeatSpec(): Spec {
  return {
    root: "root",
    elements: {
      root: { type: "Stack", props: {}, children: ["grid"] },
      grid: {
        type: "Grid",
        props: {},
        repeat: { statePath: "/images", key: "id" },
        children: ["image"],
      },
      image: { type: "Image", props: { src: { $item: "src" } } },
    },
    state: {
      images: [
        { id: "a", src: "/a.png" },
        { id: "b", src: "/b.png" },
        { id: "c", src: "/c.png" },
      ],
    },
  };
}

describe("scopeTargetsInstruction", () => {
  test("lists each target with its instance path so repeats stay distinct", () => {
    const instruction = scopeTargetsInstruction(
      makeRepeatSpec(),
      [
        { key: "image", chain: [{ containerKey: "grid", domIndex: 0 }] },
        { key: "image", chain: [{ containerKey: "grid", domIndex: 2 }] },
      ],
      "Fix the first image and replace the third",
    );

    expect(instruction).toContain("Edit only these 2 elements");
    expect(instruction).toContain(
      '1) element "image" (component type "Image"), instance 1 of 3, state path "/images/0"',
    );
    expect(instruction).toContain(
      '2) element "image" (component type "Image"), instance 3 of 3, state path "/images/2"',
    );
    expect(instruction).toContain(
      "User request:\nFix the first image and replace the third",
    );
    expect(instruction).toContain("leave every other element unchanged");
  });

  test("a single template-level target uses the singular format without instance text", () => {
    const instruction = scopeTargetsInstruction(
      makeSpec(),
      [{ key: "heading", chain: null }],
      "Make it pop",
    );

    expect(instruction).toContain("Edit only this element");
    expect(instruction).toContain(
      'element "heading" (component type "Heading")',
    );
    expect(instruction).not.toContain("instance ");
    expect(instruction).toContain("User request:\nMake it pop");
  });

  test("a repeated key with a null chain is described as the shared template", () => {
    const instruction = scopeTargetsInstruction(
      makeRepeatSpec(),
      [{ key: "image", chain: null }],
      "Make every image grayscale",
    );

    expect(instruction).toContain("Edit only this element");
    expect(instruction).toContain(
      'shared template of element "image" (component type "Image"), applies to all 3 rendered instances',
    );
    expect(instruction).not.toContain("state path");
    expect(instruction).toContain("User request:\nMake every image grayscale");
  });

  test("mixes a template target with an unrelated instance target", () => {
    const instruction = scopeTargetsInstruction(
      makeRepeatSpec(),
      [
        { key: "image", chain: null },
        { key: "root", chain: null },
      ],
      "Restyle everything",
    );

    expect(instruction).toContain("Edit only these 2 elements");
    expect(instruction).toContain(
      '1) shared template of element "image" (component type "Image"), applies to all 3 rendered instances',
    );
    expect(instruction).toContain('2) element "root" (component type "Stack")');
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
        className: zodDef({
          type: "nullable",
          innerType: zodDef({ type: "string" }),
        }),
        alt: zodDef({ type: "string" }),
        tags: zodDef({ type: "array" }),
      }),
    );

    expect(fields).toEqual([
      { name: "text", kind: PROP_FIELD_KINDS.string },
      { name: "count", kind: PROP_FIELD_KINDS.number },
      { name: "enabled", kind: PROP_FIELD_KINDS.boolean },
      { name: "level", kind: PROP_FIELD_KINDS.enum, options: ["h1", "h2"] },
      { name: "title", kind: PROP_FIELD_KINDS.string },
      {
        name: "style",
        kind: PROP_FIELD_KINDS.record,
        variant: PROP_FIELD_VARIANTS.style,
      },
      {
        name: "className",
        kind: PROP_FIELD_KINDS.string,
        variant: PROP_FIELD_VARIANTS.className,
      },
      { name: "alt", kind: PROP_FIELD_KINDS.string },
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
