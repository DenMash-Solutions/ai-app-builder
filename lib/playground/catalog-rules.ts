/**
 * CATALOG_RULES (plan 072, F22) — the prompt section that teaches the
 * declared component-reference marker and the per-request component list.
 *
 * Both halves ship TOGETHER (072 decision 2 — the NAVIGATE_RULES
 * decision-3 pattern): the system rules append only when the request
 * carries a non-empty `context.components`, and the list only ships with
 * the rules. With no components in scope the vocabulary is simply not
 * offered — an unknown reference is dropped + warned client-side, so the
 * model is never invited to guess.
 *
 * The marker is an EMPTY container carrying `data-component-ref`; the
 * completion pipeline expands it in place (072 decision 1, before the
 * dangling-ref heal) through the same seams the picker uses — the model
 * REFERENCES a component, it never re-authors it. The teaching is
 * deliberately literal (lesson template-derived-strings / mistake #22):
 * a composition the prompt does not spell out is a composition the model
 * will not produce.
 */

/** Cap on listed components: beyond this the prompt grows faster than the
 *  reference's usefulness (the picker offers the full set regardless). */
export const MAX_LISTED_COMPONENTS = 12;

/** Prop key the model writes on the placeholder element; the completion
 *  pipeline reads it back to expand (shared with component-refs). */
export const COMPONENT_REF_PROP = "data-component-ref";

export interface ComponentListing {
  id: string;
  name: string;
}

export const CATALOG_RULES = `
COMPONENT RULES

The user prompt may carry a "Project components" list — ids of components already present in this project (installed catalog components or saved templates). To USE one of them, emit an EMPTY container element carrying that id at the exact position where the component belongs:

  { "type": "Stack", "props": { "data-component-ref": "<id>" }, "children": [] }

- The app replaces each marker with the real component when the stream completes — fresh keys, provenance recorded, nothing else to do. NEVER write the component's internals yourself when a listed id fits, and NEVER invent an id: only ids in the "Project components" list are valid. An unknown id is silently dropped.
- The marker's "children" must stay empty — it is a placeholder, not a layout container.
- Components already expanded in the spec (roots carrying "data-template-id") are real content: in edit mode keep them as-is — never wrap, duplicate, or strip them, and do not also mark their position with a marker.
- Use a component only where it genuinely fits the design — never force one in, and never emit a marker when the prompt carries no "Project components" list.
`;

/**
 * Validate the client's `context.components`: an array of `{id, name}`
 * pairs (the same shape precedent as `context.screens`). Anything
 * malformed is dropped (a missing block only withholds the teaching — it
 * must never fail a generation). Returns `[]` when there is nothing to
 * list.
 */
export function parseComponents(value: unknown): ComponentListing[] {
  if (!Array.isArray(value)) return [];
  const components: ComponentListing[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const { id, name } = item as { id?: unknown; name?: unknown };
    if (typeof id !== "string" || id.trim() === "") continue;
    components.push({
      id,
      name: typeof name === "string" && name.trim() !== "" ? name : id,
    });
    if (components.length >= MAX_LISTED_COMPONENTS) break;
  }
  return components;
}

/**
 * The user-prompt block listing valid reference ids (072 decision 2 —
 * pairs with CATALOG_RULES so neither ships alone). Empty list → empty
 * string.
 */
export function componentBlock(
  components: readonly ComponentListing[],
): string {
  if (components.length === 0) return "";
  const lines = components.map((component) => {
    const label = component.name === component.id ? "" : ` — ${component.name}`;
    return `- "${component.id}"${label}`;
  });
  return `\n\nProject components (the ONLY valid \`data-component-ref\` values — an id outside this list is dropped):\n${lines.join("\n")}`;
}
