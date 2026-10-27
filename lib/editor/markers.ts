import type { UIElement } from "@json-render/core";

/**
 * Discovery markers (plan 058 step 1): which state-driven fields an element
 * carries. Structure rows and the pick-hover badge surface them so
 * conditional components (e.g. the Pokedex loading state) are findable even
 * while their `visible` condition keeps them out of the DOM.
 */
export const ELEMENT_MARKERS = {
  visible: "visible",
  watch: "watch",
  repeat: "repeat",
} as const;

export type ElementMarker =
  (typeof ELEMENT_MARKERS)[keyof typeof ELEMENT_MARKERS];

/** Stable render order: condition first, then what reacts, then expansion. */
export const ELEMENT_MARKER_ORDER: readonly ElementMarker[] = [
  ELEMENT_MARKERS.visible,
  ELEMENT_MARKERS.watch,
  ELEMENT_MARKERS.repeat,
];

/**
 * Derives an element's markers from the spec (never the DOM — hidden
 * elements have no DOM to read).
 *
 * - `visible`: marked unless literal `true` (unconditional). `visible: false`
 *   IS marked — "never renders" is exactly what the editor must reveal.
 * - `watch`: marked only when at least one watched path exists.
 * - `repeat`: marked on presence.
 */
export function elementMarkers(element: UIElement): ElementMarker[] {
  const markers: ElementMarker[] = [];
  if (element.visible !== undefined && element.visible !== true) {
    markers.push(ELEMENT_MARKERS.visible);
  }
  if (element.watch && Object.keys(element.watch).length > 0) {
    markers.push(ELEMENT_MARKERS.watch);
  }
  if (element.repeat !== undefined) {
    markers.push(ELEMENT_MARKERS.repeat);
  }
  return ELEMENT_MARKER_ORDER.filter((marker) => markers.includes(marker));
}
