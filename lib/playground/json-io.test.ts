import { describe, expect, test } from "bun:test";
import { PARSE_SPEC_ERRORS, parseSpecJson } from "./json-io";

const validSpec = {
  root: "page",
  elements: {
    page: { type: "Stack", props: { direction: "vertical" }, children: [] },
    title: { type: "Heading", props: { text: "Hello" } },
  },
};

describe("parseSpecJson", () => {
  test("accepts a valid spec", () => {
    const result = parseSpecJson(JSON.stringify(validSpec));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.spec.root).toBe("page");
      expect(result.spec.elements).toBeDefined();
    }
  });

  test("preserves the state block on round-trip", () => {
    const withState = { ...validSpec, state: { items: [1, 2, 3] } };
    const result = parseSpecJson(JSON.stringify(withState));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.spec as { state?: unknown }).state).toEqual({
        items: [1, 2, 3],
      });
    }
  });

  test("rejects text that is not JSON", () => {
    const result = parseSpecJson("{root: page");
    expect(result).toEqual({
      ok: false,
      error: PARSE_SPEC_ERRORS.invalidJson,
    });
  });

  test("rejects JSON primitives, arrays, and null", () => {
    for (const text of ['"page"', "42", "null", "true", "[]"]) {
      const result = parseSpecJson(text);
      expect(result).toEqual({
        ok: false,
        error: PARSE_SPEC_ERRORS.invalidShape,
      });
    }
  });

  test("rejects a missing or non-string root", () => {
    const noRoot = { elements: validSpec.elements };
    expect(parseSpecJson(JSON.stringify(noRoot))).toEqual({
      ok: false,
      error: PARSE_SPEC_ERRORS.invalidShape,
    });
    const emptyRoot = { ...validSpec, root: "" };
    expect(parseSpecJson(JSON.stringify(emptyRoot))).toEqual({
      ok: false,
      error: PARSE_SPEC_ERRORS.invalidShape,
    });
    const numericRoot = { ...validSpec, root: 7 };
    expect(parseSpecJson(JSON.stringify(numericRoot))).toEqual({
      ok: false,
      error: PARSE_SPEC_ERRORS.invalidShape,
    });
  });

  test("rejects missing, empty, or non-object elements", () => {
    expect(parseSpecJson(JSON.stringify({ root: "page" }))).toEqual({
      ok: false,
      error: PARSE_SPEC_ERRORS.invalidShape,
    });
    expect(
      parseSpecJson(JSON.stringify({ root: "page", elements: {} })),
    ).toEqual({ ok: false, error: PARSE_SPEC_ERRORS.invalidShape });
    expect(
      parseSpecJson(JSON.stringify({ root: "page", elements: "x" })),
    ).toEqual({ ok: false, error: PARSE_SPEC_ERRORS.invalidShape });
  });

  test("rejects when root is not a key of elements", () => {
    const spec = { root: "missing", elements: validSpec.elements };
    expect(parseSpecJson(JSON.stringify(spec))).toEqual({
      ok: false,
      error: PARSE_SPEC_ERRORS.invalidShape,
    });
  });

  test("rejects an element without a string type", () => {
    const spec = {
      root: "page",
      elements: {
        page: { type: "Stack", props: {}, children: [] },
        broken: { props: {} },
      },
    };
    expect(parseSpecJson(JSON.stringify(spec))).toEqual({
      ok: false,
      error: PARSE_SPEC_ERRORS.invalidShape,
    });
  });

  test("rejects misconfigured data sources, carrying the issue details", () => {
    const spec = {
      root: "page",
      elements: {
        page: { type: "Stack", props: {}, children: [] },
      },
      dataSources: { localTodos: { provider: "localStorage", config: {} } },
      resources: { todos: { dataSource: "missing" } },
    };
    const result = parseSpecJson(JSON.stringify(spec));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(PARSE_SPEC_ERRORS.invalidDataSources);
      expect(result.details).toContain('Unknown dataSource "missing"');
    }
  });

  test("preserves well-formed data blocks on round-trip", () => {
    const spec = {
      root: "page",
      elements: {
        page: { type: "Stack", props: {}, children: [] },
      },
      dataSources: { localTodos: { provider: "localStorage", config: {} } },
      resources: {
        todos: {
          dataSource: "localTodos",
          schema: { title: "string", done: "boolean" },
        },
      },
      queries: { todoList: { resource: "todos", operation: "list" } },
    };
    const result = parseSpecJson(JSON.stringify(spec));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const blocks = result.spec as {
        dataSources?: unknown;
        resources?: unknown;
        queries?: unknown;
      };
      expect(blocks.dataSources).toEqual(spec.dataSources);
      expect(blocks.resources).toEqual(spec.resources);
      expect(blocks.queries).toEqual(spec.queries);
    }
  });
});
