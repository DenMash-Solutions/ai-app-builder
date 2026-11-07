import { describe, expect, test } from "bun:test";
import type { Spec } from "@json-render/core";
import { isProjectManifest } from "./manifest";

const COMPONENT_A = "b2300000-0000-4000-8000-00000000000a";
const COMPONENT_B = "b2300000-0000-4000-8000-00000000000b";

function screenSpec(slotKey: string | null): Spec {
  const elements: Spec["elements"] = {
    root: {
      type: "Stack",
      props: { direction: "vertical" },
      children: slotKey === null ? [] : [slotKey],
    },
  };
  if (slotKey !== null) {
    elements[slotKey] = { type: "Stack", props: {}, children: [] };
  }
  return { root: "root", elements };
}

function manifest(
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    screens: [
      {
        name: "Home",
        route: null,
        home: true,
        spec: screenSpec("slot-navbar"),
        slots: { "slot-navbar": COMPONENT_A },
      },
      {
        name: "Products",
        route: "products/{id}",
        spec: screenSpec("slot-navbar"),
        slots: { "slot-navbar": COMPONENT_B },
      },
    ],
    components: [COMPONENT_A, COMPONENT_B],
    ...overrides,
  };
}

describe("isProjectManifest (plan 073 decision 1)", () => {
  test("accepts a manifest with screens, routes, a home and slot maps", () => {
    expect(isProjectManifest(manifest())).toBe(true);
  });

  test("accepts route-less screens, first-screen home default and no slots", () => {
    expect(
      isProjectManifest({
        screens: [
          { name: "Home", route: null, spec: screenSpec(null) },
          { name: "Cart", route: "cart", spec: screenSpec(null) },
        ],
        components: [COMPONENT_A],
      }),
    ).toBe(true);
  });

  test("rejects junk, empty screen lists and empty component lists", () => {
    expect(isProjectManifest(null)).toBe(false);
    expect(isProjectManifest("manifest")).toBe(false);
    expect(isProjectManifest({})).toBe(false);
    expect(isProjectManifest({ screens: [], components: [COMPONENT_A] })).toBe(
      false,
    );
    expect(isProjectManifest(manifest({ components: [] }))).toBe(false);
    expect(isProjectManifest(manifest({ components: undefined }))).toBe(false);
  });

  test("rejects a bad screen spec", () => {
    const broken = manifest();
    (broken.screens as Array<Record<string, unknown>>)[0].spec = {
      root: "root",
    };
    expect(isProjectManifest(broken)).toBe(false);
  });

  test("rejects a screen without a usable name", () => {
    const broken = manifest();
    (broken.screens as Array<Record<string, unknown>>)[0].name = "  ";
    expect(isProjectManifest(broken)).toBe(false);
  });

  test("rejects a dangling slot key (not an element of that screen)", () => {
    const broken = manifest();
    (broken.screens as Array<Record<string, unknown>>)[0].slots = {
      "slot-missing": COMPONENT_A,
    };
    expect(isProjectManifest(broken)).toBe(false);
  });

  test("rejects a slot pointing at a component the manifest does not list", () => {
    const broken = manifest();
    (broken.screens as Array<Record<string, unknown>>)[0].slots = {
      "slot-navbar": "b2300000-0000-4000-8000-0000000000ff",
    };
    expect(isProjectManifest(broken)).toBe(false);
  });

  test("rejects duplicate component ids", () => {
    expect(
      isProjectManifest(manifest({ components: [COMPONENT_A, COMPONENT_A] })),
    ).toBe(false);
  });

  test("rejects two home flags", () => {
    const broken = manifest();
    (broken.screens as Array<Record<string, unknown>>)[1].home = true;
    expect(isProjectManifest(broken)).toBe(false);
  });

  test("rejects a non-boolean home flag", () => {
    const broken = manifest();
    (broken.screens as Array<Record<string, unknown>>)[0].home = "yes";
    expect(isProjectManifest(broken)).toBe(false);
  });

  test("rejects a non-string route", () => {
    const broken = manifest();
    (broken.screens as Array<Record<string, unknown>>)[0].route = 7;
    expect(isProjectManifest(broken)).toBe(false);
  });

  test("rejects a slots map that is not a plain object", () => {
    const broken = manifest();
    (broken.screens as Array<Record<string, unknown>>)[0].slots = [COMPONENT_A];
    expect(isProjectManifest(broken)).toBe(false);
  });
});
