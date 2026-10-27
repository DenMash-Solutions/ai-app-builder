import { describe, expect, test } from "bun:test";
import type { UIElement } from "@json-render/core";
import { ELEMENT_MARKERS, elementMarkers } from "@/lib/editor/markers";

function element(fields: Partial<UIElement>): UIElement {
  return { type: "Text", ...fields } as UIElement;
}

describe("elementMarkers", () => {
  test("plain element carries no markers", () => {
    expect(elementMarkers(element({}))).toEqual([]);
  });

  test("visible condition marks the element", () => {
    expect(
      elementMarkers(
        element({
          visible: { $state: "/queries/pokedexList/status", eq: "loading" },
        }),
      ),
    ).toEqual([ELEMENT_MARKERS.visible]);
  });

  test("literal visible:true is unconditional — no marker", () => {
    expect(elementMarkers(element({ visible: true }))).toEqual([]);
  });

  test("literal visible:false is marked — never-rendering must be discoverable", () => {
    expect(elementMarkers(element({ visible: false }))).toEqual([
      ELEMENT_MARKERS.visible,
    ]);
  });

  test("array (AND) condition marks the element", () => {
    expect(
      elementMarkers(
        element({
          visible: [
            { $state: "/queries/pokedexList/count", eq: 0 },
            { $state: "/queries/pokedexList/status", eq: "success" },
          ],
        }),
      ),
    ).toEqual([ELEMENT_MARKERS.visible]);
  });

  test("watch with paths marks the element; empty watch does not", () => {
    expect(
      elementMarkers(
        element({
          watch: { "/form/country": { action: "setState", params: {} } },
        }),
      ),
    ).toEqual([ELEMENT_MARKERS.watch]);
    expect(elementMarkers(element({ watch: {} }))).toEqual([]);
  });

  test("repeat marks the element", () => {
    expect(
      elementMarkers(element({ repeat: { statePath: "/todos", key: "id" } })),
    ).toEqual([ELEMENT_MARKERS.repeat]);
  });

  test("all three markers, always in stable order", () => {
    const all = elementMarkers(
      element({
        visible: { $state: "/page", gt: 0 },
        watch: { "/page": { action: "setState", params: {} } },
        repeat: { statePath: "/todos" },
      }),
    );
    expect(all).toEqual([
      ELEMENT_MARKERS.visible,
      ELEMENT_MARKERS.watch,
      ELEMENT_MARKERS.repeat,
    ]);
  });
});
