import { afterEach, describe, expect, test } from "bun:test";
import { parseStateInput, stateOverrides } from "@/lib/editor/state-overrides";

afterEach(() => {
  stateOverrides.clear();
});

describe("stateOverrides", () => {
  test("records the first original and reports it", () => {
    expect(stateOverrides.record("/page", 0)).toBe(true);
    expect(stateOverrides.has("/page")).toBe(true);
    expect(stateOverrides.original("/page")).toBe(0);
    expect(stateOverrides.count()).toBe(1);
  });

  test("second record of the same path keeps the first original", () => {
    stateOverrides.record("/page", 0);
    expect(stateOverrides.record("/page", 5)).toBe(false);
    expect(stateOverrides.original("/page")).toBe(0);
    expect(stateOverrides.count()).toBe(1);
  });

  test("records a missing original as undefined-but-present", () => {
    stateOverrides.record("/never", undefined);
    expect(stateOverrides.has("/never")).toBe(true);
    expect(stateOverrides.original("/never")).toBeUndefined();
    expect(stateOverrides.count()).toBe(1);
  });

  test("clear returns all pairs and empties the registry", () => {
    stateOverrides.record("/page", 0);
    stateOverrides.record("/limit", 12);
    const entries = stateOverrides.clear();
    expect(entries.sort()).toEqual([
      ["/limit", 12],
      ["/page", 0],
    ]);
    expect(stateOverrides.count()).toBe(0);
    expect(stateOverrides.has("/page")).toBe(false);
  });

  test("clear on empty registry is a harmless no-op", () => {
    expect(stateOverrides.clear()).toEqual([]);
  });

  test("snapshot identity changes only on mutation (useSyncExternalStore)", () => {
    const first = stateOverrides.getSnapshot();
    expect(stateOverrides.getSnapshot()).toBe(first);
    stateOverrides.record("/page", 0);
    const second = stateOverrides.getSnapshot();
    expect(second).not.toBe(first);
    expect(stateOverrides.getSnapshot()).toBe(second);
  });

  test("subscribers are notified on record and clear, then unsubscribe", () => {
    let calls = 0;
    const unsubscribe = stateOverrides.subscribe(() => {
      calls += 1;
    });
    stateOverrides.record("/page", 0);
    stateOverrides.clear();
    expect(calls).toBe(2);
    unsubscribe();
    stateOverrides.record("/x", 1);
    expect(calls).toBe(2);
  });
});

describe("parseStateInput", () => {
  test("JSON scalars parse to their types", () => {
    expect(parseStateInput("12")).toBe(12);
    expect(parseStateInput("-1.5")).toBe(-1.5);
    expect(parseStateInput("true")).toBe(true);
    expect(parseStateInput("null")).toBe(null);
    expect(parseStateInput('"loading"')).toBe("loading");
  });

  test("objects and arrays parse", () => {
    expect(parseStateInput('{"a":1}')).toEqual({ a: 1 });
    expect(parseStateInput("[1,2]")).toEqual([1, 2]);
  });

  test("plain text falls back to a raw string", () => {
    expect(parseStateInput("loading")).toBe("loading");
    expect(parseStateInput("{broken")).toBe("{broken");
  });

  test("whitespace-padded JSON still parses", () => {
    expect(parseStateInput("  7 ")).toBe(7);
  });
});
