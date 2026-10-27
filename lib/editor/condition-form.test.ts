import { describe, expect, test } from "bun:test";
import type { VisibilityCondition } from "@json-render/core";
import {
  CONDITION_OPERATORS,
  CONDITION_OPERATOR_ORDER,
  NUMERIC_CONDITION_OPERATORS,
  QUERY_MIRROR_FIELDS,
  VALUELESS_CONDITION_OPERATORS,
  parseCondition,
  serializeCondition,
  suggestedStatePaths,
  type ConditionRow,
} from "@/lib/editor/condition-form";

/** parse → serialize must return the exact condition it came from. */
function expectRoundTrip(visible: VisibilityCondition) {
  const parsed = parseCondition(visible);
  if (!parsed.supported) throw new Error("expected a supported condition");
  const result = serializeCondition(parsed.rows, parsed.container);
  if (!result.ok) throw new Error("expected serialization to succeed");
  expect(result.value).toEqual(visible);
}

describe("operator constants", () => {
  test("ORDER covers every operator exactly once", () => {
    expect(CONDITION_OPERATOR_ORDER).toHaveLength(
      Object.keys(CONDITION_OPERATORS).length,
    );
    expect(new Set(CONDITION_OPERATOR_ORDER).size).toBe(
      CONDITION_OPERATOR_ORDER.length,
    );
    for (const [key, value] of Object.entries(CONDITION_OPERATORS)) {
      expect(CONDITION_OPERATOR_ORDER).toContain(value);
      expect(key).toBe(value);
    }
  });

  test("numeric and valueless sets are subsets of ORDER", () => {
    for (const op of NUMERIC_CONDITION_OPERATORS) {
      expect(CONDITION_OPERATOR_ORDER).toContain(op);
    }
    for (const op of VALUELESS_CONDITION_OPERATORS) {
      expect(CONDITION_OPERATOR_ORDER).toContain(op);
    }
    expect(VALUELESS_CONDITION_OPERATORS).toEqual([
      CONDITION_OPERATORS.truthy,
      CONDITION_OPERATORS.not,
    ]);
  });
});

describe("parseCondition", () => {
  test("single comparison becomes one row with its operand type", () => {
    const parsed = parseCondition({ $state: "/page", gt: 0 } as never);
    expect(parsed).toEqual({
      supported: true,
      container: "single",
      rows: [{ path: "/page", operator: "gt", text: "0", kind: "number" }],
    });
  });

  test("string operands keep their type hint", () => {
    const parsed = parseCondition({
      $state: "/queries/pokedexList/status",
      eq: "loading",
    } as never);
    expect(parsed.supported).toBe(true);
    if (!parsed.supported) return;
    expect(parsed.rows[0].kind).toBe("string");
    expect(parsed.rows[0].text).toBe("loading");
  });

  test("an empty-string operand stays untyped (operator-switch placeholder)", () => {
    // Switching truthy → eq commits `eq: ""`; the row must not pin `string`,
    // or a later `true`/`123` the user types would commit as text.
    const parsed = parseCondition({ $state: "/revealed", eq: "" } as never);
    expect(parsed.supported).toBe(true);
    if (!parsed.supported) return;
    expect(parsed.rows[0].kind).toBe("auto");
    // untyped round-trip still reproduces the placeholder byte-exact
    expect(serializeCondition(parsed.rows, parsed.container)).toEqual({
      ok: true,
      value: { $state: "/revealed", eq: "" },
    });
    // …and typing a literal into it coerces
    expect(
      serializeCondition(
        [{ ...parsed.rows[0], text: "true" }],
        parsed.container,
      ),
    ).toEqual({ ok: true, value: { $state: "/revealed", eq: true } });
  });

  test("operator-less conditions map to truthy / not", () => {
    expect(parseCondition({ $state: "/hasNext" } as never)).toMatchObject({
      supported: true,
      rows: [{ operator: "truthy", text: "", kind: "none" }],
    });
    expect(
      parseCondition({ $state: "/hasNext", not: true } as never),
    ).toMatchObject({
      supported: true,
      rows: [{ operator: "not" }],
    });
  });

  test("implicit AND array becomes a multi-row form", () => {
    const parsed = parseCondition([
      { $state: "/queries/pokedexList/count", eq: 0 },
      { $state: "/queries/pokedexList/status", eq: "success" },
    ] as never);
    expect(parsed.supported).toBe(true);
    if (!parsed.supported) return;
    expect(parsed.container).toBe("array");
    expect(parsed.rows).toHaveLength(2);
  });

  test("explicit $and wrapper parses as the same row model", () => {
    // The imported Pokedex uses the $and form for its empty-state condition.
    const parsed = parseCondition({
      $and: [
        { $state: "/queries/pokemonList/count", eq: 0 },
        { $state: "/queries/pokemonList/status", eq: "success" },
      ],
    } as never);
    expect(parsed.supported).toBe(true);
    if (!parsed.supported) return;
    expect(parsed.container).toBe("and");
    expect(parsed.rows).toEqual([
      {
        path: "/queries/pokemonList/count",
        operator: "eq",
        text: "0",
        kind: "number",
      },
      {
        path: "/queries/pokemonList/status",
        operator: "eq",
        text: "success",
        kind: "string",
      },
    ]);
  });

  test("unsupported shapes stay read-only", () => {
    const unsupported = [
      undefined,
      false,
      [],
      { $or: [{ $state: "/a", eq: 1 }] },
      // nested logical wrappers stay read-only (rows must be comparisons)
      { $and: [{ $or: [{ $state: "/a", eq: 1 }] }] },
      { $and: [] },
      { $item: "types" },
      { $index: true },
      // negated comparison — the form has no negation toggle
      { $state: "/page", eq: 1, not: true },
      // multiple operators are ambiguous
      { $state: "/page", eq: 1, gt: 0 },
      // non-primitive operands
      { $state: "/page", gt: { $state: "/limit" } },
      { $state: "/page", eq: null },
      // item-scoped or nested rows inside an array
      [{ $state: "/page", eq: 0 }, { $item: "types" }],
    ];
    for (const condition of unsupported) {
      expect(parseCondition(condition as never)).toEqual({
        supported: false,
      });
    }
  });
});

describe("serializeCondition", () => {
  const row = (over: Partial<ConditionRow>): ConditionRow => ({
    path: "/page",
    operator: CONDITION_OPERATORS.eq,
    text: "0",
    kind: "auto",
    ...over,
  });

  test("one row serializes to an object, several to an array", () => {
    expect(serializeCondition([row({})])).toEqual({
      ok: true,
      value: { $state: "/page", eq: 0 },
    });
    expect(
      serializeCondition([row({}), row({ path: "/limit", text: "12" })]),
    ).toEqual({
      ok: true,
      value: [
        { $state: "/page", eq: 0 },
        { $state: "/limit", eq: 12 },
      ],
    });
  });

  test("no rows clears the condition", () => {
    expect(serializeCondition([])).toEqual({ ok: true, value: undefined });
  });

  test("container decides the multi-row wrapper, a lone row collapses", () => {
    const two = [row({}), row({ path: "/limit", text: "12" })];
    expect(serializeCondition(two, "array")).toEqual({
      ok: true,
      value: [
        { $state: "/page", eq: 0 },
        { $state: "/limit", eq: 12 },
      ],
    });
    expect(serializeCondition(two, "and")).toEqual({
      ok: true,
      value: {
        $and: [
          { $state: "/page", eq: 0 },
          { $state: "/limit", eq: 12 },
        ],
      },
    });
    expect(serializeCondition([row({})], "and")).toEqual({
      ok: true,
      value: { $state: "/page", eq: 0 },
    });
  });

  test("valueless operators serialize without an operand", () => {
    expect(
      serializeCondition([row({ operator: "truthy", text: "", kind: "none" })]),
    ).toEqual({ ok: true, value: { $state: "/page" } });
    expect(
      serializeCondition([row({ operator: "not", text: "", kind: "none" })]),
    ).toEqual({ ok: true, value: { $state: "/page", not: true } });
  });

  test("kind string never flips to a number, kind number coerces", () => {
    expect(serializeCondition([row({ kind: "string", text: "123" })])).toEqual({
      ok: true,
      value: { $state: "/page", eq: "123" },
    });
    expect(
      serializeCondition([
        row({ kind: "number", text: "12", operator: "gte" }),
      ]),
    ).toEqual({ ok: true, value: { $state: "/page", gte: 12 } });
  });

  test("invalid rows refuse to serialize", () => {
    // empty path
    expect(serializeCondition([row({ path: "" })])).toEqual({ ok: false });
    // number field typed into garbage
    expect(serializeCondition([row({ kind: "number", text: "abc" })])).toEqual({
      ok: false,
    });
    expect(serializeCondition([row({ kind: "number", text: "" })])).toEqual({
      ok: false,
    });
    // core requires a number operand for gt/gte/lt/lte
    expect(
      serializeCondition([row({ operator: "gt", kind: "auto", text: "abc" })]),
    ).toEqual({ ok: false });
  });
});

describe("round-trip", () => {
  test("single conditions survive parse → serialize unchanged", () => {
    expectRoundTrip({ $state: "/queries/pokedexList/status", eq: "loading" });
    expectRoundTrip({ $state: "/page", gt: 0 });
    expectRoundTrip({ $state: "/limit", lte: 12 });
    expectRoundTrip({ $state: "/queries/pokedexList/hasNext" });
    expectRoundTrip({ $state: "/flag", not: true });
    expectRoundTrip({ $state: "/flag", eq: true });
    expectRoundTrip({ $state: "/copy/title", eq: "" });
    // string digits must not turn into numbers
    expectRoundTrip({ $state: "/id", eq: "123" });
  });

  test("the Pokedex array condition survives unchanged", () => {
    expectRoundTrip([
      { $state: "/queries/pokedexList/count", eq: 0 },
      { $state: "/queries/pokedexList/status", eq: "success" },
    ]);
  });

  test("the $and wrapper survives unchanged (imported Pokedex)", () => {
    expectRoundTrip({
      $and: [
        { $state: "/queries/pokemonList/count", eq: 0 },
        { $state: "/queries/pokemonList/status", eq: "success" },
      ],
    });
  });
});

describe("suggestedStatePaths", () => {
  test("combines spec.state pointers, urlSync keys and query mirrors", () => {
    const paths = suggestedStatePaths({
      state: { page: 0, i18n: { es: { title: "hola" } } },
      urlSync: ["page", "limit"],
      queries: { pokedexList: { operation: "list" } },
    });
    expect(paths).toContain("/page");
    expect(paths).toContain("/i18n/es/title");
    expect(paths).toContain("/limit");
    for (const field of Object.values(QUERY_MIRROR_FIELDS)) {
      expect(paths).toContain(`/queries/pokedexList/${field}`);
    }
    expect(paths).toEqual([...paths].sort((a, b) => a.localeCompare(b)));
  });

  test("non-spec input yields no suggestions", () => {
    expect(suggestedStatePaths(null)).toEqual([]);
    expect(suggestedStatePaths("spec")).toEqual([]);
    expect(suggestedStatePaths({})).toEqual([]);
  });
});
