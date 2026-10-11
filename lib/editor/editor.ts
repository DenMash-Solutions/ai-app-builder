import type { Spec } from "@json-render/core";
import { REVISION_LABELS } from "@/lib/history";
import type { InstanceChain, InstanceScope } from "./instance-path";
import { countKeyInstances, resolveInstanceScope } from "./instance-path";

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

/** Fields edited as structured lists instead of a single text input. */
export const PROP_FIELD_VARIANTS = {
  className: "classNameTokens",
  style: "stylePairs",
} as const;

export type PropFieldVariant =
  (typeof PROP_FIELD_VARIANTS)[keyof typeof PROP_FIELD_VARIANTS];

export interface PropField {
  name: string;
  kind: PropFieldKind;
  options?: string[];
  variant?: PropFieldVariant;
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
 * are not safely editable as scalars. className/style carry a list-editing
 * variant; other records stay editable as CSS-declaration text.
 */
export function getEditableFields(propsSchema: unknown): PropField[] {
  const shape = getZodDef(propsSchema).shape;
  if (!shape) return [];
  const fields: PropField[] = [];
  for (const [name, field] of Object.entries(shape)) {
    const resolved = resolveFieldKind(field);
    if (!resolved) continue;
    const variant =
      PROP_FIELD_VARIANTS[name as keyof typeof PROP_FIELD_VARIANTS];
    fields.push({ name, ...resolved, ...(variant ? { variant } : {}) });
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
 * A prompt-scope target: element key plus the repeat chain of the picked
 * instance (null = template-level).
 */
export interface PromptScopeTarget {
  key: string;
  chain: InstanceChain | null;
}

/** Stable identity for a scope target: key + JSON-serialized instance chain. */
export function scopeTargetId(target: PromptScopeTarget): string {
  return `${target.key}|${JSON.stringify(target.chain ?? [])}`;
}

function describeTarget(
  key: string,
  type: string,
  scope: InstanceScope | null,
  instanceCount?: number,
): string {
  const base = `element "${key}" (component type "${type}")`;
  if (scope) {
    return `${base}, instance ${scope.itemIndex + 1} of ${scope.count}, state path "${scope.basePath}"`;
  }
  if (instanceCount !== undefined && instanceCount > 1) {
    return `shared template of ${base}, applies to all ${instanceCount} rendered instances`;
  }
  return base;
}

function formatScopedInstruction(
  descriptions: string[],
  instruction: string,
): string {
  const singular = descriptions.length === 1;
  const header = singular
    ? "Edit only this element (leave every other element unchanged):"
    : `Edit only these ${descriptions.length} elements (leave every other element unchanged):`;
  const list = singular
    ? descriptions[0]
    : descriptions.map((line, index) => `${index + 1}) ${line}`).join("\n");
  const tail = singular
    ? "Patch the existing spec in place."
    : "Patch the existing spec in place. Apply each part of the request to the most relevant listed element.";
  return [header, list, "", "User request:", instruction, "", tail].join("\n");
}

/**
 * Wraps a user instruction so the model patches exactly the listed elements
 * — each described with its instance scope (index/count/state path) so
 * repeated instances of the same key stay distinguishable.
 */
export function scopeTargetsInstruction(
  spec: Spec,
  targets: PromptScopeTarget[],
  instruction: string,
): string {
  const state = spec.state ?? {};
  const descriptions = targets.map((target) => {
    const type = spec.elements[target.key]?.type ?? "unknown";
    const scope = resolveInstanceScope(spec, state, target.chain ?? []);
    return describeTarget(
      target.key,
      type,
      scope,
      countKeyInstances(spec, target.key),
    );
  });
  return formatScopedInstruction(descriptions, instruction);
}

/**
 * Wraps a user instruction so the model patches exactly one element.
 * Pass the instance scope (when the selection is repeat-scoped) so the
 * model can tell which instance of a repeated key to edit.
 */
export function scopeInstruction(
  key: string,
  type: string,
  instruction: string,
  scope?: InstanceScope | null,
): string {
  return formatScopedInstruction(
    [describeTarget(key, type, scope ?? null)],
    instruction,
  );
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
