import { describe, expect, test } from "bun:test";
import type { Spec } from "@json-render/core";
import { resolveLiveRoute } from "./live-routes";
import type { ProjectEntryPoint } from "./project-publish";

function makeSpec(heading: string): Spec {
  return {
    root: "root",
    elements: { root: { type: "Card", props: { title: heading } } },
  };
}

function point(route: string, screenId?: string): ProjectEntryPoint {
  return {
    route,
    screenId: screenId ?? `s-${route === "" ? "home" : route}`,
    spec: makeSpec(route === "" ? "home" : route),
  };
}

/** The publish-time order: slug rungs → configured patterns → home. */
const SNAPSHOT: ProjectEntryPoint[] = [
  point("alpha"),
  point("beta"),
  point("items/{id}"),
  point(""),
];

describe("resolveLiveRoute (069 task 4, decision 18/19)", () => {
  test("the bare segment serves the home rung", () => {
    const match = resolveLiveRoute(SNAPSHOT, "");
    expect(match?.entry.route).toBe("");
    expect(match?.params).toEqual({});
  });

  test("the home rung never serves a path", () => {
    expect(resolveLiveRoute([point("")], "anything")).toBeNull();
    expect(resolveLiveRoute([point("")], "a/b")).toBeNull();
  });

  test("a slash-only path IS the bare segment — home serves it", () => {
    expect(resolveLiveRoute([point("")], "/")?.entry.route).toBe("");
  });

  test("an exact rung matches with empty params", () => {
    const match = resolveLiveRoute(SNAPSHOT, "beta");
    expect(match?.entry.route).toBe("beta");
    expect(match?.params).toEqual({});
  });

  test("a dynamic pattern captures the path's params", () => {
    const match = resolveLiveRoute(SNAPSHOT, "items/42");
    expect(match?.entry.route).toBe("items/{id}");
    expect(match?.params).toEqual({ id: "42" });
  });

  test("an unknown path resolves null (the caller 404s, decision 19)", () => {
    expect(resolveLiveRoute(SNAPSHOT, "nope")).toBeNull();
    expect(resolveLiveRoute(SNAPSHOT, "items/4/extra")).toBeNull();
  });

  test("leading/trailing slashes are trimmed before matching", () => {
    expect(resolveLiveRoute(SNAPSHOT, "/items/7/")?.params).toEqual({
      id: "7",
    });
    expect(resolveLiveRoute(SNAPSHOT, "/alpha")?.entry.route).toBe("alpha");
  });

  test("an exact rung beats a dynamic pattern earlier in the rows", () => {
    // Row order can put `items/{id}` first — the literal still owns its URL
    // (same class precedence as resolveProjectRoute: exact before dynamic).
    const rows = [point("items/{id}"), point("items/4")];
    const match = resolveLiveRoute(rows, "items/4");
    expect(match?.entry.route).toBe("items/4");
    expect(match?.params).toEqual({});
  });

  test("within the dynamic class, row order decides", () => {
    const rows = [point("a/{x}"), point("a/{y}")];
    expect(resolveLiveRoute(rows, "a/1")?.entry.route).toBe("a/{x}");
    expect(
      resolveLiveRoute([point("a/{y}"), point("a/{x}")], "a/1")?.entry.route,
    ).toBe("a/{y}");
  });

  test("an empty snapshot resolves nothing", () => {
    expect(resolveLiveRoute([], "")).toBeNull();
    expect(resolveLiveRoute([], "alpha")).toBeNull();
  });
});
