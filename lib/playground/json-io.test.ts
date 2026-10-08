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
});
