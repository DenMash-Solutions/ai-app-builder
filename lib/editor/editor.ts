import type { Spec } from "@json-render/core";
import { REVISION_LABELS } from "@/lib/history";

export const EDIT_ACTION_KEYS = [
  "bolder",
  "quieter",
  "polish",
  "colorize",
  "distill",
  "layout",
] as const;

export type EditActionKey = (typeof EDIT_ACTION_KEYS)[number];

export const PROP_FIELD_KINDS = {
  string: "string",
  number: "number",
  boolean: "boolean",
  enum: "enum",
  record: "record",
} as const;

export type PropFieldKind =
  (typeof PROP_FIELD_KINDS)[keyof typeof PROP_FIELD_KINDS];

export interface PropField {
  name: string;
  kind: PropFieldKind;
  options?: string[];
}

interface ZodDef {
  type?: string;
  innerType?: unknown;
  entries?: unknown;
  shape?: Record<string, unknown>;
}

function getZodDef(field: unknown): ZodDef {
  if (typeof field !== "object" || field === null) return {};
  const candidate = field as {
    _zod?: { def?: ZodDef };
    _def?: ZodDef;
  };
  return candidate._zod?.def ?? candidate._def ?? {};
}

function resolveFieldKind(field: unknown): {
  kind: PropFieldKind;
  options?: string[];
} | null {
  let current = field;
  for (let depth = 0; depth < 5; depth += 1) {
    const def = getZodDef(current);
    const type = def.type;
    if (
      type === "optional" ||
      type === "nullable" ||
      type === "default" ||
      type === "prefault"
    ) {
      current = def.innerType;
      continue;
    }
    if (
      type === PROP_FIELD_KINDS.string ||
      type === PROP_FIELD_KINDS.number ||
      type === PROP_FIELD_KINDS.boolean ||
      type === PROP_FIELD_KINDS.record
    ) {
      return { kind: type };
    }
    if (type === PROP_FIELD_KINDS.enum) {
      const entries = def.entries;
      const options = Array.isArray(entries)
        ? (entries as string[])
        : Object.values((entries ?? {}) as Record<string, string>);
      return { kind: PROP_FIELD_KINDS.enum, options };
    }
    return null;
  }
  return null;
}

/**
 * Introspects a component's Zod props schema into simple editable field
 * descriptors. Arrays and expression props are intentionally omitted — they
 * are not safely editable as scalars. Records (e.g. style) are editable as
 * CSS-declaration text.
 */
export function getEditableFields(propsSchema: unknown): PropField[] {
  const shape = getZodDef(propsSchema).shape;
  if (!shape) return [];
  const fields: PropField[] = [];
  for (const [name, field] of Object.entries(shape)) {
    const resolved = resolveFieldKind(field);
    if (resolved) fields.push({ name, ...resolved });
  }
  return fields;
}

/**
 * Immutable local patch for a single prop — no LLM round trip.
 */
export function replaceProp(
  spec: Spec,
  key: string,
  prop: string,
  value: unknown,
): Spec {
  const element = spec.elements[key];
  if (!element) return spec;
  return {
    ...spec,
    elements: {
      ...spec.elements,
      [key]: {
        ...element,
        props: { ...(element.props ?? {}), [prop]: value },
      },
    },
  };
}

/**
 * Wraps a user instruction so the model patches exactly one element.
 */
export function scopeInstruction(
  key: string,
  type: string,
  instruction: string,
): string {
  return [
    `Edit only the element "${key}" (component type "${type}"):`,
    instruction,
    "",
    "Patch the existing spec in place and leave every other element unchanged.",
  ].join("\n");
}

export function propertyRevisionLabel(prop: string): string {
  return `${REVISION_LABELS.property}:${prop}`;
}

export function actionRevisionLabel(key: EditActionKey): string {
  return `${REVISION_LABELS.action}:${key}`;
}

export function freeformRevisionLabel(text: string): string {
  return `${REVISION_LABELS.freeform}:${text.slice(0, 60)}`;
}

export function promptRevisionLabel(text: string): string {
  return `${REVISION_LABELS.prompt}:${text.slice(0, 60)}`;
}
