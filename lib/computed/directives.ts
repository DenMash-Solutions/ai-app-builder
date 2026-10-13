import {
  defineDirective,
  resolvePropValue,
  type DirectiveDefinition,
} from "@json-render/core";
import { standardDirectives } from "@json-render/directives";
import { z } from "zod";

/**
 * Custom computed directives — the collection / predicate / string gaps that
 * `standardDirectives` (`$count`, `$format`, `$math`, `$concat`, `$truncate`,
 * `$join`, `$pluralize`) does not cover. Each is a `$`-prefixed expression the
 * model can emit in a spec; the Zod schema is auto-described into the generator
 * prompt via `catalog.prompt({ directives })`, and every render site resolves
 * them through `<JSONUIProvider directives={appDirectives}>`.
 *
 * Contract: `docs/plan/computed-directives/plan.md`.
 *
 * Resolvers are defensive — they never throw, because a throw inside a
 * directive would crash the render tree. Bad input coerces to a safe default.
 */

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const isNil = (v: unknown): v is null | undefined =>
  v === null || v === undefined;

/** Coerce any value to an array: arrays pass through, nil → [], scalar → [v]. */
const toArr = (v: unknown): unknown[] =>
  Array.isArray(v) ? v : isNil(v) ? [] : [v];

const toStr = (v: unknown): string => {
  if (isNil(v)) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    try {
      return JSON.stringify(v) ?? "";
    } catch {
      return String(v);
    }
  }
  return String(v);
};

/** Truthiness that treats "", 0, false, [] and nil as falsy. */
const isTruthy = (v: unknown): boolean => {
  if (isNil(v)) return false;
  if (typeof v === "string" || Array.isArray(v)) return v.length > 0;
  if (typeof v === "number" || typeof v === "boolean")
    return v !== 0 && v !== false;
  return true;
};

/** Equality that tolerates type drift (`1` vs `"1"`, `false` vs `"false"`). */
const looseEq = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (isNil(a) || isNil(b)) return false;
  if (typeof a === "object" || typeof b === "object") return a === b;
  return String(a) === String(b);
};

/** Ordering: numeric when both sides are numeric, else locale string compare. */
const cmp = (a: unknown, b: unknown): number => {
  if (isNil(a) && isNil(b)) return 0;
  if (isNil(a)) return -1;
  if (isNil(b)) return 1;
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return toStr(a).localeCompare(toStr(b));
};

const contains = (haystack: unknown, needle: unknown): boolean => {
  if (Array.isArray(haystack)) return haystack.some((x) => looseEq(x, needle));
  return toStr(haystack).includes(toStr(needle));
};

/** Dot-path lookup (`"a.b.c"`); `""`/undefined path returns the whole value. */
const getPath = (obj: unknown, path: string | undefined): unknown => {
  if (isNil(path) || path === "") return obj;
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (isNil(cur) || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
};

/** Stable Set key for de-duplication. */
const keyOf = (v: unknown): string => {
  if (isNil(v)) return "null";
  if (typeof v === "object") {
    try {
      return `obj:${JSON.stringify(v) ?? ""}`;
    } catch {
      return `obj:${String(v)}`;
    }
  }
  return `${typeof v}:${String(v)}`;
};

/** All primitive leaf values of a value (for whole-object text search). */
function flattenValues(input: unknown, out: unknown[] = []): unknown[] {
  if (isNil(input)) return out;
  if (Array.isArray(input)) {
    for (const v of input) flattenValues(v, out);
    return out;
  }
  if (typeof input === "object") {
    for (const v of Object.values(input)) flattenValues(v, out);
    return out;
  }
  out.push(input);
  return out;
}

/* ------------------------------------------------------------------ */
/* Condition matching (shared by $filter / $some / $every)             */
/* ------------------------------------------------------------------ */

export const CONDITION_OPS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "startsWith",
  "endsWith",
  "exists",
  "in",
  "truthy",
  "falsy",
] as const;

export const AGGREGATE_OPS = ["sum", "avg", "min", "max"] as const;

export const SORT_DIRECTIONS = ["asc", "desc"] as const;

function matchesCondition(
  item: unknown,
  field: string | undefined,
  op: string | undefined,
  operand: unknown,
): boolean {
  const actual = getPath(item, field);
  // `value` present without an explicit op ⇒ equality; otherwise truthiness.
  const operator = op ?? (operand === undefined ? "truthy" : "eq");
  switch (operator) {
    case "eq":
      return looseEq(actual, operand);
    case "neq":
      return !looseEq(actual, operand);
    case "gt":
      return cmp(actual, operand) > 0;
    case "gte":
      return cmp(actual, operand) >= 0;
    case "lt":
      return cmp(actual, operand) < 0;
    case "lte":
      return cmp(actual, operand) <= 0;
    case "contains":
      return contains(actual, operand);
    case "startsWith":
      return toStr(actual).startsWith(toStr(operand));
    case "endsWith":
      return toStr(actual).endsWith(toStr(operand));
    case "exists":
      return !isNil(actual);
    case "in":
      return Array.isArray(operand) && operand.some((v) => looseEq(actual, v));
    case "truthy":
      return isTruthy(actual);
    case "falsy":
      return !isTruthy(actual);
    default:
      return looseEq(actual, operand);
  }
}

/** Resolve the operand only when present (undefined means "not supplied"). */
function resolveMaybe(v: unknown, ctx: Parameters<typeof resolvePropValue>[1]) {
  return v === undefined ? undefined : resolvePropValue(v, ctx);
}

/** Numeric projection of an item list for aggregation. */
function numbersOf(items: unknown[], field: string | undefined): number[] {
  return items
    .map((item) => Number(getPath(item, field)))
    .filter((n) => Number.isFinite(n));
}

/**
 * Read a directive's args from the sibling level, falling back to inside the
 * primary value.
 *
 * Models routinely nest args inside the `$name` value object
 * (`{ "$filter": { "$state": "/todos", "field": "done", "value": false } }`)
 * instead of the canonical sibling form
 * (`{ "$filter": { "$state": "/todos" }, "field": "done", "value": false }`).
 * Accepting both means a stray shape can't silently drop the condition (which
 * would otherwise count every item). We read the RAW, unresolved primary, so a
 * `$state`/`$computed` expression — which never carries literal arg keys — is
 * never mistaken for the nested form.
 */
function directiveArgs<V extends object, K extends keyof V & string>(
  value: V,
  name: string,
  keys: readonly K[],
): { primary: unknown; args: { [P in K]: V[P] } } {
  const record = value as Record<string, unknown>;
  const primary = record[name];
  const nested =
    primary !== null && typeof primary === "object" && !Array.isArray(primary)
      ? (primary as Record<string, unknown>)
      : null;
  const args = {} as { [P in K]: V[P] };
  for (const key of keys) {
    const sibling = record[key];
    args[key] = (sibling !== undefined ? sibling : nested?.[key]) as V[K];
  }
  return { primary, args };
}

/* ------------------------------------------------------------------ */
/* Filtering & search                                                  */
/* ------------------------------------------------------------------ */

export const filterDirective = defineDirective({
  name: "$filter",
  description:
    "Array of the items matching a condition. Defaults to equality when `value` is present, truthiness of `field` when it is not.",
  schema: z.object({
    $filter: z.unknown(),
    field: z
      .string()
      .optional()
      .describe(
        "Dot-path into each item to test; omit to test the item itself",
      ),
    op: z.enum(CONDITION_OPS).optional(),
    value: z.unknown().optional(),
  }),
  resolve(value, ctx) {
    const { primary, args } = directiveArgs(value, "$filter", [
      "field",
      "op",
      "value",
    ]);
    const items = toArr(resolvePropValue(primary, ctx));
    const operand = resolveMaybe(args.value, ctx);
    return items.filter((item) =>
      matchesCondition(item, args.field, args.op, operand),
    );
  },
});

export const searchDirective = defineDirective({
  name: "$search",
  description:
    "Array of the items whose text matches a case-insensitive substring query. Searches the given fields, or every leaf value when `fields` is omitted.",
  schema: z.object({
    $search: z.unknown(),
    query: z.unknown(),
    fields: z
      .array(z.string())
      .optional()
      .describe("Field names to search; omit to search all leaf values"),
  }),
  resolve(value, ctx) {
    const { primary, args } = directiveArgs(value, "$search", [
      "query",
      "fields",
    ]);
    const items = toArr(resolvePropValue(primary, ctx));
    const query = toStr(resolvePropValue(args.query, ctx)).toLowerCase();
    if (!query) return items;
    const fields = Array.isArray(args.fields)
      ? args.fields.map((f) => toStr(f))
      : null;
    return items.filter((item) => {
      if (fields && fields.length > 0) {
        return fields.some((f) =>
          toStr(getPath(item, f)).toLowerCase().includes(query),
        );
      }
      return flattenValues(item).some((v) =>
        toStr(v).toLowerCase().includes(query),
      );
    });
  },
});

/* ------------------------------------------------------------------ */
/* Predicates                                                          */
/* ------------------------------------------------------------------ */

export const someDirective = defineDirective({
  name: "$some",
  description: "True when at least one item matches the condition.",
  schema: z.object({
    $some: z.unknown(),
    field: z.string().optional(),
    op: z.enum(CONDITION_OPS).optional(),
    value: z.unknown().optional(),
  }),
  resolve(value, ctx) {
    const { primary, args } = directiveArgs(value, "$some", [
      "field",
      "op",
      "value",
    ]);
    const items = toArr(resolvePropValue(primary, ctx));
    const operand = resolveMaybe(args.value, ctx);
    return items.some((item) =>
      matchesCondition(item, args.field, args.op, operand),
    );
  },
});

export const everyDirective = defineDirective({
  name: "$every",
  description:
    "True when every item matches the condition (vacuously true for an empty list).",
  schema: z.object({
    $every: z.unknown(),
    field: z.string().optional(),
    op: z.enum(CONDITION_OPS).optional(),
    value: z.unknown().optional(),
  }),
  resolve(value, ctx) {
    const { primary, args } = directiveArgs(value, "$every", [
      "field",
      "op",
      "value",
    ]);
    const items = toArr(resolvePropValue(primary, ctx));
    const operand = resolveMaybe(args.value, ctx);
    return items.every((item) =>
      matchesCondition(item, args.field, args.op, operand),
    );
  },
});

/* ------------------------------------------------------------------ */
/* Aggregates                                                          */
/* ------------------------------------------------------------------ */

export const aggregateDirective = defineDirective({
  name: "$agg",
  description:
    "Numeric aggregate over a list: sum, average, minimum or maximum.",
  schema: z.object({
    $agg: z.enum(AGGREGATE_OPS),
    items: z.unknown(),
    field: z
      .string()
      .optional()
      .describe("Dot-path into each item to read the number; omit for scalars"),
  }),
  resolve(value, ctx) {
    const { args } = directiveArgs(value, "$agg", ["items", "field"]);
    const items = toArr(resolvePropValue(args.items, ctx));
    const nums = numbersOf(items, args.field);
    switch (value.$agg) {
      case "sum":
        return nums.reduce((a, b) => a + b, 0);
      case "avg":
        return nums.length > 0
          ? nums.reduce((a, b) => a + b, 0) / nums.length
          : 0;
      case "min":
        return nums.length > 0 ? Math.min(...nums) : 0;
      case "max":
        return nums.length > 0 ? Math.max(...nums) : 0;
      default:
        return 0;
    }
  },
});

/* ------------------------------------------------------------------ */
/* List operations                                                     */
/* ------------------------------------------------------------------ */

export const sortByDirective = defineDirective({
  name: "$sortBy",
  description: "Sorted copy of the list (does not mutate the source).",
  schema: z.object({
    $sortBy: z.unknown(),
    field: z.string().optional(),
    dir: z.enum(SORT_DIRECTIONS).optional(),
  }),
  resolve(value, ctx) {
    const { primary, args } = directiveArgs(value, "$sortBy", ["field", "dir"]);
    const items = [...toArr(resolvePropValue(primary, ctx))];
    const factor = args.dir === "desc" ? -1 : 1;
    return items.sort(
      (a, b) => factor * cmp(getPath(a, args.field), getPath(b, args.field)),
    );
  },
});

export const uniqueDirective = defineDirective({
  name: "$unique",
  description: "De-duplicated copy of the list, by `field` or by whole item.",
  schema: z.object({
    $unique: z.unknown(),
    field: z
      .string()
      .optional()
      .describe("Dot-path to dedupe on; omit to dedupe by the whole item"),
  }),
  resolve(value, ctx) {
    const { primary, args } = directiveArgs(value, "$unique", ["field"]);
    const items = toArr(resolvePropValue(primary, ctx));
    const seen = new Set<string>();
    const out: unknown[] = [];
    for (const item of items) {
      const key = keyOf(getPath(item, args.field));
      if (!seen.has(key)) {
        seen.add(key);
        out.push(item);
      }
    }
    return out;
  },
});

export const mapDirective = defineDirective({
  name: "$map",
  description: "Array of one field's value from each item (pair with $join).",
  schema: z.object({
    $map: z.unknown(),
    field: z.string(),
  }),
  resolve(value, ctx) {
    const { primary, args } = directiveArgs(value, "$map", ["field"]);
    const items = toArr(resolvePropValue(primary, ctx));
    return items.map((item) =>
      resolvePropValue(getPath(item, args.field), ctx),
    );
  },
});

export const firstDirective = defineDirective({
  name: "$first",
  description: "First item of the list, or null when empty.",
  schema: z.object({ $first: z.unknown() }),
  resolve(value, ctx) {
    const items = toArr(resolvePropValue(value.$first, ctx));
    return items.length > 0 ? items[0] : null;
  },
});

export const lastDirective = defineDirective({
  name: "$last",
  description: "Last item of the list, or null when empty.",
  schema: z.object({ $last: z.unknown() }),
  resolve(value, ctx) {
    const items = toArr(resolvePropValue(value.$last, ctx));
    return items.length > 0 ? items[items.length - 1] : null;
  },
});

/* ------------------------------------------------------------------ */
/* Fallback                                                            */
/* ------------------------------------------------------------------ */

export const coalesceDirective = defineDirective({
  name: "$coalesce",
  description:
    'First value that is not null, undefined or empty string — a defaulting fallback. Returns "" when every candidate is empty.',
  schema: z.object({ $coalesce: z.array(z.unknown()) }),
  resolve(value, ctx) {
    const candidates = Array.isArray(value.$coalesce)
      ? value.$coalesce
      : [value.$coalesce];
    for (const candidate of candidates) {
      const resolved = resolvePropValue(candidate, ctx);
      if (isNil(resolved) || resolved === "") continue;
      return resolved;
    }
    return "";
  },
});

/* ------------------------------------------------------------------ */
/* Strings                                                             */
/* ------------------------------------------------------------------ */

export const upperDirective = defineDirective({
  name: "$upper",
  description: "Upper-cased text.",
  schema: z.object({ $upper: z.unknown() }),
  resolve(value, ctx) {
    return toStr(resolvePropValue(value.$upper, ctx)).toUpperCase();
  },
});

export const lowerDirective = defineDirective({
  name: "$lower",
  description: "Lower-cased text.",
  schema: z.object({ $lower: z.unknown() }),
  resolve(value, ctx) {
    return toStr(resolvePropValue(value.$lower, ctx)).toLowerCase();
  },
});

export const capitalizeDirective = defineDirective({
  name: "$capitalize",
  description: "Text with its first letter upper-cased.",
  schema: z.object({ $capitalize: z.unknown() }),
  resolve(value, ctx) {
    const text = toStr(resolvePropValue(value.$capitalize, ctx));
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  },
});

export const replaceDirective = defineDirective({
  name: "$replace",
  description:
    "Text with every literal occurrence of `find` replaced by `replacement` (not a regex).",
  schema: z.object({
    $replace: z.unknown(),
    find: z.string(),
    replacement: z.string(),
  }),
  resolve(value, ctx) {
    const { primary, args } = directiveArgs(value, "$replace", [
      "find",
      "replacement",
    ]);
    const text = toStr(resolvePropValue(primary, ctx));
    if (!args.find) return text;
    return text.split(toStr(args.find)).join(toStr(args.replacement));
  },
});

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

/** Custom directives only (collection / predicate / string gaps). */
export const customDirectives = [
  filterDirective,
  searchDirective,
  someDirective,
  everyDirective,
  aggregateDirective,
  sortByDirective,
  uniqueDirective,
  mapDirective,
  firstDirective,
  lastDirective,
  coalesceDirective,
  upperDirective,
  lowerDirective,
  capitalizeDirective,
  replaceDirective,
] as const;

/**
 * Every directive available app-wide: the official pre-built set plus our
 * custom ones. Stable module constant — the directive registry is memoized on
 * array identity, so a fresh array each render would rebuild it every render.
 */
export const appDirectives: DirectiveDefinition[] = [
  ...standardDirectives,
  ...customDirectives,
];
