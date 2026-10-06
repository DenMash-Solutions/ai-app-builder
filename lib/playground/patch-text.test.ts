import { describe, expect, test } from "bun:test";
import { validatePatchText } from "./patch-text";

const OP = JSON.stringify({
  op: "replace",
  path: "/elements/heading-1/props/text",
  value: "Hello",
});

describe("validatePatchText", () => {
  test("accepts a single valid op", () => {
    expect(validatePatchText(OP)).toEqual({ ok: true, patchCount: 1 });
  });

  test("counts multiple ops and skips comments, blanks, and usage lines", () => {
    const text = [
      "// patch notes",
      "",
      OP,
      "   ",
      JSON.stringify({ __meta: "usage", totalTokens: 42 }),
      JSON.stringify({ op: "add", path: "/elements/card-2", value: {} }),
    ].join("\n");
    expect(validatePatchText(text)).toEqual({ ok: true, patchCount: 2 });
  });

  test("rejects a truncated trailing line after valid ops", () => {
    const text = [OP, '{"op":"replace","path":"/elements/hea'].join("\n");
    const result = validatePatchText(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("line 2");
  });

  test("rejects a single truncated line", () => {
    const result = validatePatchText('{"op":"replace","path":"/ele');
    expect(result.ok).toBe(false);
  });

  test("rejects empty text", () => {
    const result = validatePatchText("");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("no patch lines");
  });

  test("rejects comment-only text", () => {
    const result = validatePatchText("// nothing here\n   \n");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("no patch lines");
  });

  test("rejects usage-only text (no patches)", () => {
    const result = validatePatchText(
      JSON.stringify({ __meta: "usage", totalTokens: 7 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("no patch lines");
  });

  test("rejects an unknown op", () => {
    const result = validatePatchText(
      JSON.stringify({ op: "frobnicate", path: "/x" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("unsupported op");
  });

  test("rejects a missing or empty path", () => {
    const missing = validatePatchText(JSON.stringify({ op: "add" }));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toContain("missing a path");

    const empty = validatePatchText(JSON.stringify({ op: "add", path: "" }));
    expect(empty.ok).toBe(false);
  });

  test("rejects JSON that is not a patch object", () => {
    const result = validatePatchText("42");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("not a patch object");
  });
});
