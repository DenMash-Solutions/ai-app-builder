import { describe, expect, test } from "bun:test";
import { SERVICE_UNAVAILABLE_PATTERN } from "./models";
import { StreamTimeoutError, withDeadline } from "./deadline";

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("withDeadline", () => {
  test("resolves with the value when the promise wins", async () => {
    const result = await withDeadline(
      Promise.resolve("ok"),
      1_000,
      () => new Error("timeout"),
    );
    expect(result).toBe("ok");
  });

  test("rejects with the source error when the promise loses the race", async () => {
    const source = new Promise<string>((_, reject) =>
      setTimeout(() => reject(new Error("boom")), 5),
    );
    await expect(
      withDeadline(source, 1_000, () => new Error("timeout")),
    ).rejects.toThrow("boom");
  });

  test("rejects with onTimeout's error when the deadline wins", async () => {
    const error = new Error("too slow");
    let calls = 0;
    const never = new Promise<string>(() => {});
    await expect(
      withDeadline(never, 10, () => {
        calls += 1;
        return error;
      }),
    ).rejects.toThrow("too slow");
    expect(calls).toBe(1);
  });

  test("a late settlement after the deadline never becomes unhandled", async () => {
    const rejections: unknown[] = [];
    const onUnhandled = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      let rejectLate: (error: Error) => void = () => {};
      const late = new Promise<string>((_, reject) => {
        rejectLate = reject;
      });
      const deadline = withDeadline(late, 10, () => new Error("too slow"));
      await expect(deadline).rejects.toThrow("too slow");
      rejectLate(new Error("late boom"));
      await wait(20);
      expect(rejections).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

describe("StreamTimeoutError", () => {
  test("message classifies as service-unavailable for the failure dialog", () => {
    const error = new StreamTimeoutError("gemini-3.8-flash");
    expect(SERVICE_UNAVAILABLE_PATTERN.test(error.message)).toBe(true);
    expect(error.message).toContain("timed out");
    expect(error.name).toBe("StreamTimeoutError");
  });
});
