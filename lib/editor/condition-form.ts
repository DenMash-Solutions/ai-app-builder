import type { SingleCondition, VisibilityCondition } from "@json-render/core";
import { flattenStateRows } from "./state-inspect";
import { specUrlSync } from "@/lib/playground/url-sync";

/**
 * Structured condition-editor logic (plan 058 step 4): the forms a
 * `visible` condition can take in the editor, and the round-trip between
 * `visible` and the row model the form edits.
 *
 * Supported shapes (every form the repo specs contain):
 * - single `$state` comparison — `{ $state: "/page", gt: 0 }`
 * - valueless checks — `{ $state: "/…/hasNext" }`, `{ $state: "…", not: true }`
 * - implicit AND array — `[{ … }, { … }]` (Pokedex `dex-empty`)
 *
 * Everything else (`$or`, `$and`, `$item`/`$index` scopes, negated
 * comparisons, non-primitive operands) stays read-only JSON — the form never
 * rewrites a shape it cannot express back byte-identical.
 */

/** The element field the condition form edits (revision labels, etc.). */
export const VISIBLE_FIELD = "visible";

/** Object constants — no bare operator literals anywhere else in the editor. */
export const CONDITION_OPERATORS = {
  eq: "eq",
  neq: "neq",
  gt: "gt",
  gte: "gte",
  lt: "lt",
  lte: "lte",
  truthy: "truthy",
  not: "not",
} as const;

export type ConditionOperator =
  (typeof CONDITION_OPERATORS)[keyof typeof CONDITION_OPERATORS];

/** Dropdown order: value comparisons first, truthiness checks last. */
export const CONDITION_OPERATOR_ORDER: readonly ConditionOperator[] = [
  CONDITION_OPERATORS.eq,
  CONDITION_OPERATORS.neq,
  CONDITION_OPERATORS.gt,
  CONDITION_OPERATORS.gte,
  CONDITION_OPERATORS.lt,
  CONDITION_OPERATORS.lte,
  CONDITION_OPERATORS.truthy,
  CONDITION_OPERATORS.not,
];

/** Core `ComparisonOperators` requires a number operand for these. */
export const NUMERIC_CONDITION_OPERATORS: readonly ConditionOperator[] = [
  CONDITION_OPERATORS.gt,
  CONDITION_OPERATORS.gte,
  CONDITION_OPERATORS.lt,
  CONDITION_OPERATORS.lte,
];

/** Core checks (inverted) truthiness for these — there is no operand. */
export const VALUELESS_CONDITION_OPERATORS: readonly ConditionOperator[] = [
  CONDITION_OPERATORS.truthy,
  CONDITION_OPERATORS.not,
];

/** The single comparison key allowed per condition (core evaluates one). */
const COMPARISON_KEYS: ReadonlySet<string> = new Set(
  CONDITION_OPERATOR_ORDER.filter(
    (op) => op !== CONDITION_OPERATORS.truthy && op !== CONDITION_OPERATORS.not,
  ),
);

/**
 * Operand type hint carried from the spec: serialization reuses it so an
 * unchanged field round-trips byte-identical (`"123"` never turns into
 * `123`). `auto` is for rows the user just added, `none` for valueless
 * operators.
 */
export type ConditionValueKind =
  "string" | "number" | "boolean" | "auto" | "none";

export interface ConditionRow {
  path: string;
  operator: ConditionOperator;
  /** Display text of the operand ("" for valueless operators). */
  text: string;
  kind: ConditionValueKind;
}

export type ConditionContainer = "single" | "array" | "and";

export type ConditionParse =
  | { supported: true; rows: ConditionRow[]; container: ConditionContainer }
  | { supported: false };

function parseRow(node: unknown): ConditionRow | null {
  if (typeof node !== "object" || node === null || Array.isArray(node)) {
    return null;
  }
  const entries = Object.entries(node);
  const path = (node as Record<string, unknown>).$state;
  if (typeof path !== "string") return null;

  const comparisons = entries.filter(([key]) => COMPARISON_KEYS.has(key));
  const negated = (node as Record<string, unknown>).not;

  if (comparisons.length > 1) return null; // ambiguous — core takes the first
  if (comparisons.length === 1) {
    // The form has no negation toggle — a negated comparison stays raw JSON.
    if (negated !== undefined) return null;
    const [operator, operand] = comparisons[0];
    const operandType = typeof operand;
    if (
      operandType === "string" ||
      operandType === "number" ||
      operandType === "boolean"
    ) {
      return {
        path,
        operator: operator as ConditionOperator,
        text: String(operand),
        // An empty string is the placeholder an operator switch commits — it
        // pins no type (`inferValue("")` is `""`, so the round-trip still
        // reproduces `eq: ""`), while a non-empty string keeps its kind so
        // `"123"`/`"true"` never flip to number/boolean on an edit.
        kind: operand === "" ? "auto" : operandType,
      };
    }
    return null; // null / `{ $state: … }` / nested objects are not editable
  }

  // No comparison: truthiness, optionally inverted by `not: true`.
  const knownKeys = entries.every(([key]) => key === "$state" || key === "not");
  if (!knownKeys || (negated !== undefined && negated !== true)) return null;
  return {
    path,
    operator:
      negated === true ? CONDITION_OPERATORS.not : CONDITION_OPERATORS.truthy,
    text: "",
    kind: "none",
  };
}

export function parseCondition(
  visible: VisibilityCondition | undefined,
): ConditionParse {
  if (Array.isArray(visible)) {
    if (visible.length === 0) return { supported: false };
    const rows = visible.map(parseRow);
    if (rows.some((row) => row === null)) return { supported: false };
    return {
      supported: true,
      rows: rows as ConditionRow[],
      container: "array",
    };
  }
  if (typeof visible === "object" && visible !== null) {
    // Explicit AND wrapper — same row model as the implicit array form.
    const entries = Object.entries(visible);
    const clauses =
      entries.length === 1 && entries[0][0] === "$and" ? entries[0][1] : null;
    if (Array.isArray(clauses)) {
      const rows = clauses.map(parseRow);
      if (rows.length === 0 || rows.some((row) => row === null)) {
        return { supported: false };
      }
      return {
        supported: true,
        rows: rows as ConditionRow[],
        container: "and",
      };
    }
    const row = parseRow(visible);
    return row
      ? { supported: true, rows: [row], container: "single" }
      : { supported: false };
  }
  // `undefined` (no condition) and booleans (`false` = never) stay read-only.
  return { supported: false };
}

const AUTO_NUMBER = /^-?\d+(?:\.\d+)?$/;

/** Type inference for freshly typed text (`auto`/edited `boolean` kinds). */
function inferValue(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (AUTO_NUMBER.test(trimmed)) return Number(trimmed);
  return text;
}

function coerceValue(row: ConditionRow): unknown {
  switch (row.kind) {
    case "string":
      return row.text;
    case "number": {
      const trimmed = row.text.trim();
      const value = Number(trimmed);
      return trimmed === "" || Number.isNaN(value) ? null : value;
    }
    case "boolean": {
      const trimmed = row.text.trim();
      if (trimmed === "true") return true;
      if (trimmed === "false") return false;
      return inferValue(row.text);
    }
    case "auto":
      return inferValue(row.text);
    case "none":
      return undefined;
  }
}

function serializeRow(row: ConditionRow): SingleCondition | null {
  const path = row.path.trim();
  if (row.operator === CONDITION_OPERATORS.truthy) {
    return path === "" ? null : { $state: path };
  }
  if (row.operator === CONDITION_OPERATORS.not) {
    return path === "" ? null : { $state: path, not: true };
  }
  const value = coerceValue(row);
  if (value === null) return null; // number field typed into garbage
  if (
    NUMERIC_CONDITION_OPERATORS.includes(row.operator) &&
    typeof value !== "number"
  ) {
    return null; // core requires a number for gt/gte/lt/lte
  }
  if (path === "") return null;
  return { $state: path, [row.operator]: value } as SingleCondition;
}

export type ConditionSerializeResult =
  /** `undefined` value = the last row was removed → drop the condition. */
  { ok: true; value: VisibilityCondition | undefined } | { ok: false };

/**
 * Serializes rows back into a condition. One row always collapses to the
 * single-object form; several reproduce the source container (`$and`
 * wrapper vs. implicit array) so an unchanged condition round-trips intact.
 */
export function serializeCondition(
  rows: readonly ConditionRow[],
  container: ConditionContainer = "array",
): ConditionSerializeResult {
  if (rows.length === 0) return { ok: true, value: undefined };
  const serialized = rows.map(serializeRow);
  if (serialized.some((row) => row === null)) return { ok: false };
  const list = serialized as SingleCondition[];
  if (list.length === 1) return { ok: true, value: list[0] };
  return { ok: true, value: container === "and" ? { $and: list } : list };
}

/** Sub-paths the query manager mirrors under `/queries/<name>/…`. */
export const QUERY_MIRROR_FIELDS = {
  status: "status",
  data: "data",
  count: "count",
  error: "error",
  maxPage: "maxPage",
  hasNext: "hasNext",
} as const;

/**
 * Suggested state paths for the path field: every pointer in `spec.state`,
 * each `urlSync` key, and the mirror fields of every declared query.
 */
export function suggestedStatePaths(spec: unknown): string[] {
  if (typeof spec !== "object" || spec === null) return [];
  const state = (spec as { state?: Record<string, unknown> }).state ?? {};
  const queries = (spec as { queries?: Record<string, unknown> }).queries ?? {};
  const out = new Set<string>();
  for (const row of flattenStateRows(state)) out.add(row.path);
  for (const key of specUrlSync(spec)) out.add(`/${key}`);
  for (const name of Object.keys(queries)) {
    for (const field of Object.values(QUERY_MIRROR_FIELDS)) {
      out.add(`/queries/${name}/${field}`);
    }
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}
