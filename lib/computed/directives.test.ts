import { describe, expect, test } from "bun:test";
import { createDirectiveRegistry, resolvePropValue } from "@json-render/core";
import { playgroundCatalog } from "@/lib/playground/catalog";
import { appDirectives } from "./directives";

type StateModel = Record<string, unknown>;

const ctx = (stateModel: StateModel = {}) => ({
  stateModel,
  directives: createDirectiveRegistry(appDirectives),
});

const resolve = (expr: unknown, stateModel: StateModel = {}) =>
  resolvePropValue(expr, ctx(stateModel));

const TODOS = [
  { id: 1, title: "buy milk", done: false, priority: 3 },
  { id: 2, title: "walk dog", done: true, priority: 1 },
  { id: 3, title: "write code", done: false, priority: 2 },
];

describe("registry", () => {
  test("exposes standard + custom directives", () => {
    const names = appDirectives.map((d) => d.name);
    // Pre-built set.
    expect(names).toContain("$format");
    expect(names).toContain("$count");
    expect(names).toContain("$concat");
    // Custom set.
    expect(names).toContain("$filter");
    expect(names).toContain("$search");
    expect(names).toContain("$agg");
    expect(names).toContain("$coalesce");
  });

  test("every directive is $-prefixed", () => {
    for (const d of appDirectives) expect(d.name.startsWith("$")).toBe(true);
  });
});

describe("$filter", () => {
  test("equality on a field (value present, no op)", () => {
    expect(
      resolve(
        { $filter: { $state: "/todos" }, field: "done", value: false },
        {
          todos: TODOS,
        },
      ),
    ).toEqual([TODOS[0], TODOS[2]]);
  });

  test("truthiness when no value and no op", () => {
    expect(
      resolve(
        { $filter: { $state: "/todos" }, field: "done" },
        { todos: TODOS },
      ),
    ).toEqual([TODOS[1]]);
  });

  test("explicit comparison ops", () => {
    const state = { todos: TODOS };
    expect(
      resolve(
        {
          $filter: { $state: "/todos" },
          field: "priority",
          op: "gte",
          value: 2,
        },
        state,
      ),
    ).toEqual([TODOS[0], TODOS[2]]);
    expect(
      resolve(
        {
          $filter: { $state: "/todos" },
          field: "title",
          op: "contains",
          value: "dog",
        },
        state,
      ),
    ).toEqual([TODOS[1]]);
    expect(
      resolve(
        { $filter: { $state: "/todos" }, field: "id", op: "in", value: [1, 3] },
        state,
      ),
    ).toEqual([TODOS[0], TODOS[2]]);
    expect(
      resolve(
        {
          $filter: { $state: "/todos" },
          field: "done",
          op: "neq",
          value: true,
        },
        state,
      ),
    ).toEqual([TODOS[0], TODOS[2]]);
  });

  test("tolerates type drift on equality", () => {
    expect(
      resolve(
        { $filter: { $state: "/todos" }, field: "id", value: "1" },
        {
          todos: TODOS,
        },
      ),
    ).toEqual([TODOS[0]]);
  });

  test("defensive on null / non-array input", () => {
    expect(resolve({ $filter: { $state: "/missing" }, field: "done" })).toEqual(
      [],
    );
    expect(resolve({ $filter: null, field: "done" })).toEqual([]);
    // A scalar is wrapped as a one-item list and matched by whole-item value.
    expect(resolve({ $filter: 5, value: 5 })).toEqual([5]);
    // A field that doesn't exist on a scalar never matches.
    expect(resolve({ $filter: 5, field: "done", value: 5 })).toEqual([]);
  });
});

describe("$search", () => {
  const people = [
    { name: "Alice", city: "Berlin" },
    { name: "Bob", city: "Madrid" },
    { name: "Carol", city: "Berlin" },
  ];

  test("searches all leaf values when fields omitted", () => {
    expect(
      resolve({ $search: { $state: "/people" }, query: "berlin" }, { people }),
    ).toEqual([people[0], people[2]]);
  });

  test("searches only the given fields", () => {
    expect(
      resolve(
        { $search: { $state: "/people" }, query: "bob", fields: ["name"] },
        { people },
      ),
    ).toEqual([people[1]]);
    // "Berlin" is in city but we only search name → no match for "berlin".
    expect(
      resolve(
        { $search: { $state: "/people" }, query: "berlin", fields: ["name"] },
        { people },
      ),
    ).toEqual([]);
  });

  test("empty query returns everything", () => {
    expect(
      resolve({ $search: { $state: "/people" }, query: "" }, { people }),
    ).toEqual(people);
  });

  test("is case-insensitive", () => {
    expect(
      resolve({ $search: { $state: "/people" }, query: "ALICE" }, { people }),
    ).toEqual([people[0]]);
  });
});

describe("$some / $every", () => {
  const state = { todos: TODOS };

  test("$some is true when any item matches", () => {
    expect(
      resolve(
        { $some: { $state: "/todos" }, field: "done", value: true },
        state,
      ),
    ).toBe(true);
    expect(
      resolve(
        { $some: { $state: "/todos" }, field: "done", value: "nope" },
        state,
      ),
    ).toBe(false);
  });

  test("$every is true only when all match, and vacuously true when empty", () => {
    expect(
      resolve(
        { $every: { $state: "/todos" }, field: "done", value: true },
        state,
      ),
    ).toBe(false);
    expect(
      resolve(
        { $every: { $state: "/todos" }, field: "done", op: "exists" },
        state,
      ),
    ).toBe(true);
    expect(
      resolve({ $every: { $state: "/empty" }, field: "done" }, { empty: [] }),
    ).toBe(true);
  });
});

describe("$agg", () => {
  const state = { todos: TODOS };

  test("sum / avg / min / max over a field", () => {
    expect(
      resolve(
        { $agg: "sum", items: { $state: "/todos" }, field: "priority" },
        state,
      ),
    ).toBe(6);
    expect(
      resolve(
        { $agg: "avg", items: { $state: "/todos" }, field: "priority" },
        state,
      ),
    ).toBe(2);
    expect(
      resolve(
        { $agg: "min", items: { $state: "/todos" }, field: "priority" },
        state,
      ),
    ).toBe(1);
    expect(
      resolve(
        { $agg: "max", items: { $state: "/todos" }, field: "priority" },
        state,
      ),
    ).toBe(3);
  });

  test("works on scalars when field omitted", () => {
    expect(resolve({ $agg: "sum", items: [1, 2, 3] })).toBe(6);
  });

  test("empty list aggregates to 0", () => {
    expect(resolve({ $agg: "sum", items: { $state: "/missing" } })).toBe(0);
    expect(resolve({ $agg: "avg", items: [] })).toBe(0);
  });
});

describe("list ops", () => {
  const state = { todos: TODOS };

  test("$sortBy sorts a copy asc/desc", () => {
    const byId = (expr: unknown) =>
      (resolve(expr, state) as Array<{ id: number }>).map((t) => t.id);
    expect(byId({ $sortBy: { $state: "/todos" }, field: "priority" })).toEqual([
      2, 3, 1,
    ]);
    expect(
      byId({ $sortBy: { $state: "/todos" }, field: "priority", dir: "desc" }),
    ).toEqual([1, 3, 2]);
    // Source is not mutated.
    expect(TODOS.map((t) => t.id)).toEqual([1, 2, 3]);
  });

  test("$unique dedupes by field and by whole item", () => {
    expect(
      resolve(
        { $unique: { $state: "/tags" } },
        { tags: ["a", "b", "a", "c", "b"] },
      ),
    ).toEqual(["a", "b", "c"]);
    expect(
      resolve({ $unique: { $state: "/todos" }, field: "done" }, state),
    ).toEqual([TODOS[0], TODOS[1]]);
  });

  test("$map extracts a field; $join composes", () => {
    expect(
      resolve({ $map: { $state: "/todos" }, field: "title" }, state),
    ).toEqual(["buy milk", "walk dog", "write code"]);
    expect(
      resolve(
        {
          $join: { $map: { $state: "/todos" }, field: "title" },
          separator: " | ",
        },
        state,
      ),
    ).toBe("buy milk | walk dog | write code");
  });

  test("$first / $last return items or null", () => {
    expect(resolve({ $first: { $state: "/todos" } }, state)).toEqual(TODOS[0]);
    expect(resolve({ $last: { $state: "/todos" } }, state)).toEqual(TODOS[2]);
    expect(resolve({ $first: { $state: "/empty" } }, { empty: [] })).toBeNull();
    expect(resolve({ $last: null })).toBeNull();
  });
});

describe("$coalesce", () => {
  test("returns the first non-empty candidate", () => {
    expect(resolve({ $coalesce: [null, "", "fallback"] })).toBe("fallback");
    expect(resolve({ $coalesce: [{ $state: "/missing" }, "default"] })).toBe(
      "default",
    );
  });

  test("keeps falsy-but-real values (0)", () => {
    expect(resolve({ $coalesce: [0, 5] })).toBe(0);
  });

  test('returns "" when all candidates are empty', () => {
    expect(resolve({ $coalesce: [null, "", undefined] })).toBe("");
  });
});

describe("strings", () => {
  test("$upper / $lower / $capitalize", () => {
    expect(resolve({ $upper: "hello" })).toBe("HELLO");
    expect(resolve({ $lower: "HeLLo" })).toBe("hello");
    expect(resolve({ $capitalize: "hello world" })).toBe("Hello world");
  });

  test("$replace is literal and replaces all", () => {
    expect(resolve({ $replace: "a.b.c", find: ".", replacement: "/" })).toBe(
      "a/b/c",
    );
    expect(resolve({ $replace: "aaa", find: "a", replacement: "o" })).toBe(
      "ooo",
    );
  });

  test("defensive on null / non-string", () => {
    expect(resolve({ $upper: null })).toBe("");
    expect(resolve({ $capitalize: 42 })).toBe("42");
    expect(resolve({ $replace: null, find: "a", replacement: "b" })).toBe("");
    expect(resolve({ $replace: "abc", find: "", replacement: "x" })).toBe(
      "abc",
    );
  });
});

describe("composition", () => {
  test("counter pattern: $count($filter($state))", () => {
    expect(
      resolve(
        {
          $count: {
            $filter: { $state: "/todos" },
            field: "done",
            value: false,
          },
        },
        { todos: TODOS },
      ),
    ).toBe(2);
  });

  test("args nested inside the directive value still apply (model drift)", () => {
    // Models often write field/value inside the $filter value object rather
    // than as siblings; the condition must not be silently dropped.
    expect(
      resolve(
        {
          $count: {
            $filter: { $state: "/todos", field: "done", value: false },
          },
        },
        { todos: TODOS },
      ),
    ).toBe(2);
  });

  test("$format over a computed value", () => {
    const out = String(
      resolve(
        {
          $format: "currency",
          value: {
            $agg: "sum",
            items: { $state: "/todos" },
            field: "priority",
          },
          currency: "USD",
        },
        { todos: TODOS },
      ),
    );
    expect(out).toContain("6");
  });
});

describe("prompt", () => {
  test("catalog prompt auto-describes every directive", () => {
    const prompt = playgroundCatalog.prompt({ directives: appDirectives });
    expect(prompt).toContain("CUSTOM DYNAMIC VALUES:");
    expect(prompt).toContain("$filter");
    expect(prompt).toContain("$format");
    expect(prompt).toContain("$agg");
    expect(prompt).toContain("Directives compose");
  });
});
