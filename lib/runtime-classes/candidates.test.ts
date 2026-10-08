import { describe, expect, test } from "bun:test";
import type { Spec } from "@json-render/core";
import {
  MAX_CANDIDATES,
  MAX_CANDIDATE_LENGTH,
  collectSpecClassTokens,
  sanitizeCandidates,
} from "./candidates";

function specWith(...classNames: unknown[]): Spec {
  const elements = Object.fromEntries(
    classNames.map((className, index) => [
      `el-${index}`,
      { type: "div", props: className === undefined ? {} : { className } },
    ]),
  );
  return { elements } as unknown as Spec;
}

describe("collectSpecClassTokens", () => {
  test("collects, dedupes and skips non-string classNames", () => {
    const spec = specWith(
      "p-4 flex",
      "p-4",
      { $state: "cls" },
      undefined,
      "  gap-2  ",
    );
    expect(collectSpecClassTokens(spec).sort()).toEqual([
      "flex",
      "gap-2",
      "p-4",
    ]);
  });

  test("handles null/undefined spec and empty elements", () => {
    expect(collectSpecClassTokens(null)).toEqual([]);
    expect(collectSpecClassTokens(undefined)).toEqual([]);
    expect(collectSpecClassTokens({ elements: {} } as Spec)).toEqual([]);
  });
});

describe("sanitizeCandidates", () => {
  test("rejects non-array payloads and non-string members", () => {
    expect(sanitizeCandidates(undefined)).toBeNull();
    expect(sanitizeCandidates("p-4")).toBeNull();
    expect(sanitizeCandidates({ candidates: [] })).toBeNull();
    expect(sanitizeCandidates(["p-4", 42])).toBeNull();
    expect(sanitizeCandidates([null])).toBeNull();
  });

  test("passes valid tokens through and dedupes", () => {
    const result = sanitizeCandidates(["p-4", "flex", "p-4"]);
    expect(result).not.toBeNull();
    expect(result?.candidates).toEqual(["p-4", "flex"]);
    expect(result?.invalid).toEqual([]);
  });

  test("splits malformed tokens into invalid instead of failing the batch", () => {
    const long = "x".repeat(MAX_CANDIDATE_LENGTH + 1);
    const result = sanitizeCandidates(["p-4", "", "two words", long, "ok"]);
    expect(result).not.toBeNull();
    expect(result?.candidates).toEqual(["p-4", "ok"]);
    expect(result?.invalid).toEqual(["", "two words", long]);
  });

  test("caps the batch at MAX_CANDIDATES; overflow becomes invalid", () => {
    const tokens = Array.from(
      { length: MAX_CANDIDATES + 3 },
      (_, i) => `t${i}`,
    );
    const result = sanitizeCandidates(tokens);
    expect(result?.candidates).toHaveLength(MAX_CANDIDATES);
    expect(result?.invalid).toHaveLength(3);
  });
});
