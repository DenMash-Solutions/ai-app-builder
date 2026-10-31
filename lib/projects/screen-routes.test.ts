import { describe, expect, test } from "bun:test";
import type { Spec } from "@json-render/core";
import type { HistoryEntry } from "@/lib/history";
import type { Project } from "./projects";
import {
  buildRoutePath,
  matchRoutePattern,
  overlayPathState,
  projectHomeScreenId,
  resolveProjectRoute,
  routePatternParams,
  specRoutePattern,
} from "./screen-routes";

const PROJECT: Project = {
  id: "p1",
  name: "Pokédex",
  slug: "pokedex",
  createdAt: 1,
  updatedAt: 1,
  state: {},
};

function entry(init: {
  id: string;
  slug?: string;
  projectId?: string;
  createdAt?: number;
  route?: string;
}): HistoryEntry {
  const spec: Record<string, unknown> = { root: "root", elements: {} };
  if (init.route !== undefined) spec.route = init.route;
  return {
    id: init.id,
    slug: init.slug ?? init.id,
    name: init.slug ?? init.id,
    projectId: init.projectId,
    createdAt: init.createdAt ?? 1,
    updatedAt: init.createdAt ?? 1,
    prompt: "",
    revisions: [],
    head: 0,
    spec: spec as unknown as Spec,
  };
}

describe("specRoutePattern", () => {
  test("reads the top-level route string and trims slashes/whitespace", () => {
    expect(specRoutePattern({ route: "{id}" })).toBe("{id}");
    expect(specRoutePattern({ route: "/ type/{type}/ " })).toBe("type/{type}");
  });

  test("absent, empty and non-string patterns read as null", () => {
    expect(specRoutePattern({})).toBeNull();
    expect(specRoutePattern({ route: "   " })).toBeNull();
    expect(specRoutePattern({ route: 4 })).toBeNull();
    expect(specRoutePattern(null)).toBeNull();
    expect(specRoutePattern(undefined)).toBeNull();
  });
});

describe("routePatternParams / matchRoutePattern", () => {
  test("params lists the placeholders in order", () => {
    expect(routePatternParams("{id}")).toEqual(["id"]);
    expect(routePatternParams("p/{id}/{tab}")).toEqual(["id", "tab"]);
    expect(routePatternParams("settings")).toEqual([]);
  });

  test("a single placeholder captures the segment", () => {
    expect(matchRoutePattern("{id}", "4")).toEqual({ id: "4" });
    expect(matchRoutePattern("{id}", "bulbasaur")).toEqual({ id: "bulbasaur" });
  });

  test("literal segments must equal; placeholders capture positionally", () => {
    expect(matchRoutePattern("type/{type}", "type/fire")).toEqual({
      type: "fire",
    });
    expect(matchRoutePattern("type/{type}", "move/fire")).toBeNull();
    expect(matchRoutePattern("p/{id}/{tab}", "p/4/stats")).toEqual({
      id: "4",
      tab: "stats",
    });
  });

  test("segment-count mismatch and empty patterns never match", () => {
    expect(matchRoutePattern("{id}", "4/extra")).toBeNull();
    expect(matchRoutePattern("{id}", "")).toBeNull();
    expect(matchRoutePattern("", "4")).toBeNull();
  });
});

describe("buildRoutePath", () => {
  test("substitutes params (numbers stringified) and keeps literals", () => {
    expect(buildRoutePath("{id}", { id: 4 })).toBe("4");
    expect(buildRoutePath("type/{type}", { type: "fire" })).toBe("type/fire");
    expect(buildRoutePath("p/{id}/{tab}", { id: 4, tab: "stats" })).toBe(
      "p/4/stats",
    );
  });

  test("a missing, nil or empty param makes the build unbuildable", () => {
    expect(buildRoutePath("{id}", {})).toBeNull();
    expect(buildRoutePath("{id}", { id: null })).toBeNull();
    expect(buildRoutePath("{id}", { id: "" })).toBeNull();
    expect(buildRoutePath("p/{id}/{tab}", { id: 4 })).toBeNull();
    expect(buildRoutePath("{id}", { id: 4, tab: "stats" })).toBeNull();
    expect(buildRoutePath("{id}", { id: { nested: true } })).toBeNull();
    expect(buildRoutePath("", { id: 4 })).toBeNull();
  });
});

describe("overlayPathState", () => {
  test("overlays captures with numeric coercion for whole-number segments", () => {
    expect(overlayPathState({ id: "", page: 1 }, { id: "4" })).toEqual({
      id: 4,
      page: 1,
    });
  });

  test("numeric-looking but distinct values stay strings", () => {
    expect(overlayPathState({ id: "" }, { id: "007" })).toEqual({
      id: "007",
    });
    expect(overlayPathState({ id: "" }, { id: "4x" })).toEqual({ id: "4x" });
    expect(overlayPathState({ slug: "" }, { slug: "bulbasaur" })).toEqual({
      slug: "bulbasaur",
    });
  });

  test("no params (or only undefined values) returns the state unchanged", () => {
    const state = { id: "" };
    expect(overlayPathState(state, null)).toBe(state);
    expect(overlayPathState(state, undefined)).toBe(state);
    expect(overlayPathState(state, { id: undefined })).toBe(state);
  });
});

describe("resolveProjectRoute", () => {
  const grid = entry({ id: "grid", slug: "catalog", projectId: "p1" });
  const detail = entry({
    id: "detail",
    slug: "pokemon-detail",
    projectId: "p1",
    route: "{id}",
  });
  const settings = entry({
    id: "settings",
    slug: "settings",
    projectId: "p1",
    createdAt: 9,
  });
  const foreign = entry({
    id: "foreign",
    slug: "other-app",
    projectId: "other",
    route: "{id}",
  });
  const entries = [grid, detail, settings, foreign];

  test("an exact screen slug wins and binds no params", () => {
    expect(resolveProjectRoute(PROJECT, entries, "settings")).toEqual({
      screen: settings,
      params: {},
    });
    expect(resolveProjectRoute(PROJECT, entries, "/catalog/")).toEqual({
      screen: grid,
      params: {},
    });
  });

  test("a route pattern match binds the segments into params", () => {
    expect(resolveProjectRoute(PROJECT, entries, "4")).toEqual({
      screen: detail,
      params: { id: "4" },
    });
    expect(resolveProjectRoute(PROJECT, entries, "/4/")).toEqual({
      screen: detail,
      params: { id: "4" },
    });
    // v1: a single-placeholder pattern claims ANY single segment — the
    // target screen owns handling a value that turns out invalid (its query
    // errors) rather than the router second-guessing the pattern.
    expect(resolveProjectRoute(PROJECT, entries, "nope")?.screen).toBe(detail);
  });

  test("an exact slug beats a pattern claiming the same path", () => {
    const numeric = entry({ id: "num", slug: "4", projectId: "p1" });
    expect(resolveProjectRoute(PROJECT, [detail, numeric], "4")?.screen).toBe(
      numeric,
    );
  });

  test("only the project's own members resolve; unmatchable paths are null", () => {
    // The foreign screen's pattern never applies — it isn't a member.
    expect(resolveProjectRoute(PROJECT, [foreign], "other-app")).toBeNull();
    // A multi-segment path claims nothing (no pattern contains a slash) and
    // the empty path has nothing to resolve against.
    expect(resolveProjectRoute(PROJECT, entries, "settings/extra")).toBeNull();
    expect(resolveProjectRoute(PROJECT, entries, "")).toBeNull();
  });
});

describe("projectHomeScreenId", () => {
  test("the oldest member entry is the home screen", () => {
    const older = entry({ id: "older", projectId: "p1", createdAt: 1 });
    const newer = entry({ id: "newer", projectId: "p1", createdAt: 5 });
    // Order in the array is irrelevant — createdAt decides.
    expect(
      projectHomeScreenId(PROJECT, [newer, older, entry({ id: "x" })]),
    ).toBe("older");
  });

  test("no member entry yields null", () => {
    expect(projectHomeScreenId(PROJECT, [])).toBeNull();
    expect(
      projectHomeScreenId(PROJECT, [entry({ id: "x", projectId: "other" })]),
    ).toBeNull();
  });
});
