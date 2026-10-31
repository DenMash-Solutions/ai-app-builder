import { describe, expect, test } from "bun:test";
import { dataNamespaceFor, omitSessionState } from "./session-state";

describe("omitSessionState (061-4, A3 seed side)", () => {
  test("strips session so the provider's diff deletes it on every screen change", () => {
    const base = { locale: "en", session: { stale: "from spec" } };
    const seed = omitSessionState(base);
    expect("session" in seed).toBe(false);
    expect(seed.locale).toBe("en");
  });

  test("returns a copy — the spec's own state is never mutated", () => {
    const base = { draft: "local", session: { token: "t" } };
    const seed = omitSessionState(base);
    expect(seed).not.toBe(base);
    expect(base.session).toEqual({ token: "t" });
    expect(seed).toEqual({ draft: "local" });
  });

  test("a seed without session comes back as a copy", () => {
    const base = { page: 2 };
    const seed = omitSessionState(base);
    expect(seed).not.toBe(base);
    expect(seed).toEqual({ page: 2 });
  });
});

describe("dataNamespaceFor (061-4, A3 data side)", () => {
  test("project screens namespace their records by project id", () => {
    expect(dataNamespaceFor({ projectId: "proj-1" }, "entry-id")).toBe(
      "proj-1",
    );
    // The entry id / slug fallback is ignored whenever a project is present.
    expect(dataNamespaceFor({ projectId: "proj-1" }, "slug")).toBe("proj-1");
  });

  test("project-less screens keep the caller's per-screen fallback (043 D6)", () => {
    expect(dataNamespaceFor({ projectId: null }, "slug")).toBe("slug");
    expect(dataNamespaceFor(null, "slug")).toBe("slug");
    expect(dataNamespaceFor(undefined, "slug")).toBe("slug");
    expect(dataNamespaceFor({}, "entry-id")).toBe("entry-id");
  });
});
