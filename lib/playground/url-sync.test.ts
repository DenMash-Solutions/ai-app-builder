import { describe, expect, test } from "bun:test";
import {
  overlayUrlState,
  specUrlSync,
  urlSearchAfterStateChange,
} from "./url-sync";

const SEED = { page: 0, limit: 12, theme: "light" };

describe("specUrlSync (declared keys only)", () => {
  test("keeps non-empty top-level keys and drops the rest", () => {
    expect(specUrlSync({ urlSync: ["page", "limit"] })).toEqual([
      "page",
      "limit",
    ]);
    expect(specUrlSync({ urlSync: ["page", "/nested/page", "", 7] })).toEqual([
      "page",
    ]);
    expect(specUrlSync({ urlSync: "page" })).toEqual([]);
    expect(specUrlSync({})).toEqual([]);
    expect(specUrlSync(null)).toEqual([]);
  });
});

describe("overlayUrlState (deep link IN)", () => {
  test("?page=2&limit=6 overlays { page: 1, limit: 6 }", () => {
    expect(overlayUrlState(SEED, "?page=2&limit=6", ["page", "limit"])).toEqual(
      { page: 1, limit: 6, theme: "light" },
    );
  });

  test("page is clamped and non-numeric values keep the seed", () => {
    expect(overlayUrlState(SEED, "?page=0", ["page"])).toEqual(SEED);
    expect(overlayUrlState(SEED, "?page=abc", ["page"])).toEqual(SEED);
    expect(overlayUrlState(SEED, "?page=-4", ["page"])).toEqual(SEED); // → 0 - … clamps at 0 → page 0
    expect(overlayUrlState(SEED, "?page=1", ["page"])).toEqual({
      ...SEED,
      page: 0,
    });
  });

  test("undeclared params and declared-but-absent keys are ignored", () => {
    expect(overlayUrlState(SEED, "?evil=1", ["page"])).toEqual(SEED);
    expect(overlayUrlState(SEED, "?evil=1", [])).toEqual(SEED);
    expect(overlayUrlState(SEED, "", ["page"])).toEqual(SEED);
  });

  test("string-seeded keys pass through as raw strings", () => {
    expect(overlayUrlState(SEED, "?theme=dark", ["theme"])).toEqual({
      ...SEED,
      theme: "dark",
    });
  });
});

describe("urlSearchAfterStateChange (shareable OUT)", () => {
  test("writes /page back as 1-based and preserves other params", () => {
    expect(
      urlSearchAfterStateChange(
        "?limit=6&ref=x",
        [{ path: "/page", value: 1 }],
        ["page", "limit"],
      ),
    ).toBe("?limit=6&ref=x&page=2");
  });

  test("writes /limit literally and skips unchanged values", () => {
    expect(
      urlSearchAfterStateChange(
        "?limit=6",
        [{ path: "/limit", value: 6 }],
        ["limit"],
      ),
    ).toBeNull(); // nothing moved
    expect(
      urlSearchAfterStateChange(
        "?limit=6",
        [{ path: "/limit", value: 9 }],
        ["limit"],
      ),
    ).toBe("?limit=9");
  });

  test("ignores paths outside urlSync and non-scalar values", () => {
    expect(
      urlSearchAfterStateChange(
        "?a=1",
        [{ path: "/theme", value: "dark" }],
        ["page"],
      ),
    ).toBeNull();
    expect(
      urlSearchAfterStateChange(
        "",
        [{ path: "/page", value: { x: 1 } }],
        ["page"],
      ),
    ).toBeNull();
  });

  test("non-page keys never prefix-slash into nested paths", () => {
    expect(
      urlSearchAfterStateChange(
        "",
        [{ path: "/limit/0", value: 3 }],
        ["limit"],
      ),
    ).toBeNull();
  });
});
