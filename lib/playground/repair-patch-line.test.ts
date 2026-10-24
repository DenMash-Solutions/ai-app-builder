import { describe, expect, test } from "bun:test";
import { repairPatchLine, repairPatchText } from "./repair-patch-line";

// The exact malformation captured from live generation 98041ba7 (3.5 Lite):
// a JS computed key where JSON demands a quoted key — the whole op line was
// silently discarded by the client parser, erasing the element.
const RUN_98041BA7_LINE = `{"op":"add","path":"/elements/content-stack","value":{"type":"Stack","props":{"direction":"vertical"},[":watch"]:{"/page":{"action":"data_read"}},"children":[]}}`;

describe("repairPatchLine", () => {
  test("repairs the observed computed-key malformation into parseable JSON", () => {
    const result = repairPatchLine(RUN_98041BA7_LINE);
    expect(result.status).toBe("repaired");
    if (result.status !== "repaired") return;
    const parsed = JSON.parse(result.line) as {
      value: { watch?: Record<string, unknown> };
    };
    // The element now carries the intended watch — the op survives.
    expect(parsed.value.watch).toHaveProperty("/page");
    expect(result.line).not.toContain('[":watch"]');
  });

  test("repairs multiple computed keys on one line", () => {
    const result = repairPatchLine(
      `{"op":"add","path":"/elements/x","value":{[":a"]:1,[":b"]:2}}`,
    );
    expect(result.status).toBe("repaired");
    if (result.status !== "repaired") return;
    expect(JSON.parse(result.line)).toEqual({
      op: "add",
      path: "/elements/x",
      value: { a: 1, b: 2 },
    });
  });

  test("valid lines come back untouched", () => {
    const valid = `{"op":"add","path":"/root","value":"main-layout"}`;
    const result = repairPatchLine(valid);
    expect(result).toEqual({ status: "valid", line: valid });
  });

  test("a valid string value that looks like a computed key is never rewritten", () => {
    // Valid JSON → fast path → byte-identical, even though the text
    // contains an unescaped-looking key pattern inside a string.
    const valid = `{"op":"add","path":"/elements/t","value":{"props":{"text":"use [key]: carefully"}}}`;
    expect(repairPatchLine(valid)).toEqual({ status: "valid", line: valid });
  });

  test("escaped-quote strings inside invalid lines are not corrupted", () => {
    // Invalid for an unrelated reason (trailing comma); the escaped
    // `[\"a\"]: ` inside the string must not match the repair regex.
    const invalid = `{"op":"add","path":"/x","value":"use [\\"a\\"]: it",}`;
    const result = repairPatchLine(invalid);
    expect(result.status).toBe("invalid");
  });

  test("unrepairable garbage reports a reason", () => {
    const result = repairPatchLine("{oops");
    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.reason.length).toBeGreaterThan(0);
  });
});

describe("repairPatchText", () => {
  test("keeps valid lines, repairs the computed-key class, reports drops", () => {
    const text = [
      `{"op":"add","path":"/root","value":"main"}`,
      `{"op":"add","path":"/elements/stack","value":{[":watch"]:{"/page":{}}}}`,
      `{broken`,
      ``,
      `// a comment`,
      `{"op":"add","path":"/state/page","value":0}`,
    ].join("\n");
    const result = repairPatchText(text);
    expect(result.repaired).toBe(1);
    expect(result.dropped).toEqual([{ line: 3, prefix: "{broken" }]);
    const lines = result.text.split("\n");
    expect(lines).toHaveLength(5); // the broken line is gone
    expect(
      (JSON.parse(lines[1]!) as { value: { watch?: unknown } }).value.watch,
    ).toBeTruthy();
    // Comments and blanks survive.
    expect(result.text).toContain("// a comment");
  });

  test("an all-valid buffer is unchanged apart from trimming", () => {
    const text = `{"op":"add","path":"/root","value":"main"}`;
    const result = repairPatchText(text);
    expect(result).toEqual({ text, repaired: 0, dropped: [] });
  });
});
