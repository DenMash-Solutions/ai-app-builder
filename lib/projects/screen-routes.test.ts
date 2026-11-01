import { describe, expect, test } from "bun:test";
import type { Spec } from "@json-render/core";
import type { HistoryEntry } from "@/lib/history";
import type { ProjectMembership } from "./memberships";
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

/** A membership row for PROJECT (p1) unless overridden (065: `route` and
 *  `position` live here — the spec no longer carries them). */
function membership(init: {
  screenId: string;
  route?: string | null;
  position?: number;
  createdAt?: number;
  projectId?: string;
  id?: string;
}): ProjectMembership {
  return {
    id: init.id ?? `m-${init.screenId}`,
    projectId: init.projectId ?? PROJECT.id,
    screenId: init.screenId,
    route: init.route ?? null,
    position: init.position ?? 0,
    createdAt: init.createdAt ?? 1,
    updatedAt: init.createdAt ?? 1,
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

describe("resolveProjectRoute (065: membership-driven precedence)", () => {
  const grid = entry({ id: "grid", slug: "catalog", projectId: "p1" });
  const detail = entry({
    id: "detail",
    slug: "pokemon-detail",
    projectId: "p1",
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
  });
  const entries = [grid, detail, settings, foreign];
  // `route` now lives on the membership row (065 decision 1), NOT the spec.
  const rows = [
    membership({ screenId: "grid", position: 0 }),
    membership({ screenId: "detail", route: "{id}", position: 1 }),
    membership({ screenId: "settings", position: 2, createdAt: 9 }),
    membership({ screenId: "foreign", route: "{id}", projectId: "other" }),
  ];

  test("an exact screen slug wins and binds no params", () => {
    expect(resolveProjectRoute(PROJECT, entries, "settings", rows)).toEqual({
      screen: settings,
      params: {},
    });
    expect(resolveProjectRoute(PROJECT, entries, "/catalog/", rows)).toEqual({
      screen: grid,
      params: {},
    });
    // The screen id resolves too (stable ref form).
    expect(resolveProjectRoute(PROJECT, entries, "detail", rows)?.screen).toBe(
      detail,
    );
  });

  test("a dynamic route pattern match binds the segments into params", () => {
    expect(resolveProjectRoute(PROJECT, entries, "4", rows)).toEqual({
      screen: detail,
      params: { id: "4" },
    });
    expect(resolveProjectRoute(PROJECT, entries, "/4/", rows)).toEqual({
      screen: detail,
      params: { id: "4" },
    });
    // v1: a single-placeholder pattern claims ANY single segment — the
    // target screen owns handling a value that turns out invalid (its query
    // errors) rather than the router second-guessing the pattern.
    expect(resolveProjectRoute(PROJECT, entries, "nope", rows)?.screen).toBe(
      detail,
    );
  });

  test("an exact slug beats a pattern claiming the same path", () => {
    const numeric = entry({ id: "num", slug: "4", projectId: "p1" });
    expect(
      resolveProjectRoute(PROJECT, [detail, numeric], "4", [
        membership({ screenId: "detail", route: "{id}", position: 0 }),
        membership({ screenId: "num", position: 1 }),
      ])?.screen,
    ).toBe(numeric);
  });

  test("a static pattern beats a dynamic one claiming the same path", () => {
    const featured = entry({ id: "featured", slug: "featured-home" });
    const generic = entry({ id: "generic", slug: "generic-screen" });
    const order = [
      // Dynamic FIRST by position — static must still win (065 precedence).
      membership({ screenId: "generic", route: "{slug}", position: 0 }),
      membership({ screenId: "featured", route: "featured", position: 1 }),
    ];
    expect(
      resolveProjectRoute(PROJECT, [featured, generic], "featured", order)
        ?.screen,
    ).toBe(featured);
  });

  test("dynamic ties resolve by position order", () => {
    const first = entry({ id: "first", slug: "first-screen" });
    const second = entry({ id: "second", slug: "second-screen" });
    const rowsByPosition = [
      membership({ screenId: "second", route: "{slug}", position: 1 }),
      membership({ screenId: "first", route: "{slug}", position: 0 }),
    ];
    expect(
      resolveProjectRoute(PROJECT, [first, second], "anything", rowsByPosition)
        ?.screen,
    ).toBe(first);
  });

  test("only membership rows resolve — pointers and foreign rows do not", () => {
    // An entry pointing at the project WITHOUT a membership row (removed
    // membership, pointer stale) claims nothing.
    expect(resolveProjectRoute(PROJECT, [settings], "settings", [])).toBeNull();
    // The foreign project's membership never applies here.
    expect(
      resolveProjectRoute(PROJECT, [foreign], "other-app", rows),
    ).toBeNull();
    // A dangling row (screen entry gone) resolves nothing, and unmatchable
    // paths / the empty path stay null.
    expect(
      resolveProjectRoute(PROJECT, entries, "ghost", [
        membership({ screenId: "ghost", route: "{id}" }),
      ]),
    ).toBeNull();
    expect(
      resolveProjectRoute(PROJECT, entries, "settings/extra", rows),
    ).toBeNull();
    expect(resolveProjectRoute(PROJECT, entries, "", rows)).toBeNull();
  });
});

describe("projectHomeScreenId (065 decision 5: explicit home)", () => {
  const home = entry({ id: "home", projectId: "p1" });
  const other = entry({ id: "other-member", projectId: "p1" });
  const rows = [
    membership({ screenId: "home", position: 0 }),
    membership({ screenId: "other-member", position: 1 }),
  ];

  test("the explicit home screen is served when it is a live member", () => {
    expect(
      projectHomeScreenId(
        { ...PROJECT, homeScreenId: "home" },
        [home, other],
        rows,
      ),
    ).toBe("home");
  });

  test("no home → null (the oldest-member rule is gone)", () => {
    // Members exist — but without an explicit pick there is no root.
    expect(projectHomeScreenId(PROJECT, [home, other], rows)).toBeNull();
    expect(
      projectHomeScreenId(
        { ...PROJECT, homeScreenId: null },
        [home, other],
        rows,
      ),
    ).toBeNull();
  });

  test("a home that is not a member (or whose entry is gone) yields null", () => {
    // Removed from the project — the pointer/validation must not serve it.
    expect(
      projectHomeScreenId(
        { ...PROJECT, homeScreenId: "stranger" },
        [home, other],
        rows,
      ),
    ).toBeNull();
    // Dangling id: membership row + home both reference a deleted entry.
    expect(
      projectHomeScreenId(
        { ...PROJECT, homeScreenId: "deleted" },
        [home, other],
        [...rows, membership({ screenId: "deleted", position: 2 })],
      ),
    ).toBeNull();
  });

  test("screens without a project are unaffected (no project id, no home)", () => {
    const loose = entry({ id: "loose" });
    expect(
      projectHomeScreenId(
        PROJECT,
        [loose],
        [membership({ screenId: "loose" })],
      ),
    ).toBeNull();
  });
});
