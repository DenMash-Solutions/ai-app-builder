/**
 * Dangling child references (plan 054, generation resilience).
 *
 * A streamed spec can reference an element that was never defined — the
 * definition line was dropped (malformed JSON, repaired nowhere) or simply
 * never emitted. The renderer logs `Missing element "x" referenced as
 * child of "y"` and renders nothing for it; for a `repeat` grid that means
 * rows of fetched data with no template → zero cards, no error state. Both
 * live failures of plan 053's verification were this shape.
 *
 * The completion commit uses this to auto-heal ONCE with a targeted steer:
 * only the model knows what the missing element was meant to contain, so
 * the app detects and asks — it never synthesizes design itself.
 */
import type { Spec } from "@json-render/core";

export interface DanglingRef {
  parent: string;
  child: string;
}

/**
 * Every `children` string with no matching element definition. Inline
 * child objects (anonymous elements) are ignored — only named references
 * can dangle.
 */
export function danglingChildRefs(spec: Spec): DanglingRef[] {
  const elements = (spec.elements ?? {}) as Record<
    string,
    { children?: unknown }
  >;
  const defined = new Set(Object.keys(elements));
  const refs: DanglingRef[] = [];
  for (const [parent, element] of Object.entries(elements)) {
    if (!Array.isArray(element?.children)) continue;
    for (const child of element.children) {
      if (typeof child === "string" && !defined.has(child)) {
        refs.push({ parent, child });
      }
    }
  }
  return refs;
}

/** Developer-facing one-line description (`parent → child; …`). */
export function describeDanglingRefs(refs: readonly DanglingRef[]): string {
  return refs.map((ref) => `${ref.parent} → ${ref.child}`).join("; ");
}

/** The one-shot heal instruction sent through the validated edit path. */
export function danglingRefsInstruction(refs: readonly DanglingRef[]): string {
  const list = refs
    .map((ref) => `"${ref.child}" (referenced by "${ref.parent}")`)
    .join(", ");
  return (
    `The previous response references elements that were never defined, so they cannot render: ${list}. ` +
    `Emit ONLY the missing element definitions as JSONL patch ops — one ` +
    `{"op":"add","path":"/elements/<name>","value":{...}} line per missing element, ` +
    `each a complete element with type, props and children, matching the existing ` +
    `visual style. Do not change any other element.`
  );
}
