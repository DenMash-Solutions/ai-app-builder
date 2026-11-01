import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  recordRouteParam,
  resolveScreenRef,
  runNavigate,
  screenRoute,
  screenScope,
  screensInScope,
  toScreenListings,
} from "./screen-nav";
import type { ScreenSource } from "./screen-nav";
import type { ProjectMembership } from "./memberships";
import {
  createProject,
  getProjects,
  removeProject,
  setActiveProjectId,
  type Project,
} from "./projects";

const ENTRIES: ScreenSource[] = [
  { id: "aaa", slug: "alpha", name: "Alpha", projectId: "p1" },
  { id: "bbb", slug: "beta", name: "Beta app", projectId: "p1" },
  { id: "ccc", name: "Legacy screen" }, // projectId absent -> bucket null
];

describe("screensInScope", () => {
  test("a project id keeps only that project's screens", () => {
    expect(screensInScope(ENTRIES, "p1").map((screen) => screen.id)).toEqual([
      "aaa",
      "bbb",
    ]);
  });

  test("null is the unprojected bucket — never the project's screens", () => {
    expect(screensInScope(ENTRIES, null).map((screen) => screen.id)).toEqual([
      "ccc",
    ]);
  });

  test("undefined is unscoped: every screen on the device (live fallback)", () => {
    expect(screensInScope(ENTRIES, undefined)).toHaveLength(3);
  });
});

describe("resolveScreenRef", () => {
  const screens = screensInScope(ENTRIES, undefined);

  test("resolves id, then slug, then name (case-insensitive, trimmed)", () => {
    expect(resolveScreenRef("bbb", screens)?.id).toBe("bbb");
    expect(resolveScreenRef("alpha", screens)?.id).toBe("aaa");
    expect(resolveScreenRef("beta app", screens)?.id).toBe("bbb");
    expect(resolveScreenRef("  BETA APP  ", screens)?.id).toBe("bbb");
  });

  test("id wins when another screen uses it as a slug", () => {
    const colliding = [
      { id: "dup", name: "First" },
      { id: "other", slug: "dup", name: "Second" },
    ];
    expect(resolveScreenRef("dup", colliding)?.name).toBe("First");
  });

  test("unknown, empty and non-string refs resolve to null (decision 4)", () => {
    expect(resolveScreenRef("gone", screens)).toBeNull();
    expect(resolveScreenRef("", screens)).toBeNull();
    expect(resolveScreenRef("   ", screens)).toBeNull();
    expect(resolveScreenRef(42, screens)).toBeNull();
    expect(resolveScreenRef(undefined, screens)).toBeNull();
    expect(resolveScreenRef(null, screens)).toBeNull();
  });
});

describe("screenRoute", () => {
  const alpha = { id: "aaa", slug: "alpha", name: "Alpha" };

  test("the editor pushes /ui/[id] (the route resolves id first)", () => {
    expect(screenRoute(alpha, "editor")).toBe("/ui/aaa");
  });

  test("public surfaces push /{locale}/{slug}, falling back to the id", () => {
    expect(screenRoute(alpha, "preview", "en")).toBe("/en/alpha");
    expect(screenRoute({ id: "ccc", name: "Legacy" }, "live", "es")).toBe(
      "/es/ccc",
    );
  });

  test("a public route without a locale is unsafe to build", () => {
    expect(screenRoute(alpha, "preview")).toBeNull();
    expect(screenRoute(alpha, "live", "")).toBeNull();
  });
});

describe("screenScope", () => {
  beforeEach(() => {
    for (const project of getProjects()) removeProject(project.id);
    setActiveProjectId(null);
  });

  afterEach(() => {
    for (const project of getProjects()) removeProject(project.id);
    setActiveProjectId(null);
  });

  test("prefers the current screen's project over the active one", () => {
    const active = createTempProject();
    expect(active).not.toBe("");
    expect(screenScope({ projectId: "other" })).toBe("other");
    // A screen with no project falls back to the active one — the chain
    // prompt, tile and handlers all share.
    expect(screenScope({ projectId: undefined })).toBe(active);
    expect(screenScope(null)).toBe(active);
  });

  test("without a current screen or active project it is the null bucket", () => {
    expect(screenScope(null)).toBeNull();
    expect(screenScope({})).toBeNull();
  });
});

describe("runNavigate", () => {
  let warnings: string[] = [];
  let originalWarn: typeof console.warn;

  beforeEach(() => {
    warnings = [];
    originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    console.warn = originalWarn;
  });

  test("resolves inside the scope and pushes the editor route", () => {
    const pushed: string[] = [];
    const ok = runNavigate(
      { screen: "alpha" },
      {
        entries: ENTRIES,
        scope: "p1",
        surface: "editor",
        navigate: (route) => pushed.push(route),
      },
    );

    expect(ok).toBe(true);
    expect(pushed).toEqual(["/ui/aaa"]);
    expect(warnings).toHaveLength(0);
  });

  test("resolves by name on a public surface with the route locale", () => {
    const pushed: string[] = [];
    const ok = runNavigate(
      { screen: "beta app" },
      {
        entries: ENTRIES,
        scope: "p1",
        surface: "preview",
        locale: "es",
        navigate: (route) => pushed.push(route),
      },
    );

    expect(ok).toBe(true);
    expect(pushed).toEqual(["/es/beta"]);
  });

  test("a ref outside the scope warns and does not navigate (decision 4)", () => {
    const pushed: string[] = [];
    const ok = runNavigate(
      { screen: "legacy screen" }, // unprojected, scope is p1
      {
        entries: ENTRIES,
        scope: "p1",
        surface: "editor",
        navigate: (route) => pushed.push(route),
      },
    );

    expect(ok).toBe(false);
    expect(pushed).toEqual([]);
    expect(warnings.join(" ")).toContain("[navigate]");
    expect(warnings.join(" ")).toContain("legacy screen");
  });

  test("a public surface without a locale fails safe", () => {
    const pushed: string[] = [];
    const ok = runNavigate(
      { screen: "alpha" },
      {
        entries: ENTRIES,
        scope: "p1",
        surface: "live",
        navigate: (route) => pushed.push(route),
      },
    );

    expect(ok).toBe(false);
    expect(pushed).toEqual([]);
    expect(warnings.join(" ")).toContain("locale");
  });
});

describe("toScreenListings", () => {
  test("maps screens to the pairs prompt and tile offer, with the route pattern", () => {
    expect(toScreenListings(screensInScope(ENTRIES, "p1"))).toEqual([
      { ref: "aaa", name: "Alpha", route: null },
      { ref: "bbb", name: "Beta app", route: null },
    ]);
  });

  test("carries the spec-level route pattern the record-id toggle reads", () => {
    const listings = toScreenListings([
      { id: "detail", name: "Detail", spec: { route: "{id}" } },
      { id: "bare", name: "Bare", spec: { elements: {} } },
    ]);

    expect(listings.map((listing) => listing.route)).toEqual(["{id}", null]);
  });

  test("membership context supplies routes and the home marker (065)", () => {
    const listings = toScreenListings(
      [
        { id: "detail", name: "Detail", projectId: "p1" },
        { id: "flat", name: "Flat" },
      ],
      {
        memberships: [
          {
            id: "m-detail",
            projectId: "p1",
            screenId: "detail",
            route: "{id}",
            position: 0,
            createdAt: 1,
            updatedAt: 1,
          },
          {
            // Another project's row must never claim the flat screen.
            id: "m-flat",
            projectId: "other",
            screenId: "flat",
            route: "{x}",
            position: 0,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        homeScreenId: "detail",
      },
    );

    expect(listings).toEqual([
      { ref: "detail", name: "Detail", route: "{id}", home: true },
      // No row for its own project → spec-level fallback (no pattern here).
      { ref: "flat", name: "Flat", route: null },
    ]);
  });
});

describe("recordRouteParam", () => {
  const listings = toScreenListings([
    { id: "detail", name: "Detail", spec: { route: "{id}" } },
    { id: "flat", name: "Flat", spec: {} },
  ]);

  test("first placeholder of the selected target's pattern", () => {
    expect(recordRouteParam(listings, "detail")).toBe("id");
  });

  test("null for no target, an unknown ref, or a target without a pattern", () => {
    expect(recordRouteParam(listings, null)).toBeNull();
    expect(recordRouteParam(listings, "missing")).toBeNull();
    expect(recordRouteParam(listings, "flat")).toBeNull();
  });
});

describe("runNavigate (061-3 params + project namespace)", () => {
  let warnings: string[] = [];
  let originalWarn: typeof console.warn;

  beforeEach(() => {
    warnings = [];
    originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    console.warn = originalWarn;
  });

  const PROJECTS: Project[] = [
    {
      id: "p1",
      name: "Pokédex",
      slug: "pokedex",
      createdAt: 1,
      updatedAt: 1,
      state: {},
      // Explicit home (065 decision 5) — resolves through the membership
      // rows below, never by creation order.
      homeScreenId: "grid",
    },
  ];
  const MEMBERSHIPS: ProjectMembership[] = [
    {
      id: "m-grid",
      projectId: "p1",
      screenId: "grid",
      route: null,
      position: 0,
      createdAt: 1,
      updatedAt: 1,
    },
    {
      id: "m-detail",
      projectId: "p1",
      screenId: "detail",
      route: null,
      position: 1,
      createdAt: 2,
      updatedAt: 2,
    },
  ];
  const GRID: ScreenSource = {
    id: "grid",
    slug: "catalog",
    name: "Catalog",
    projectId: "p1",
    createdAt: 1,
  };
  const DETAIL: ScreenSource = {
    id: "detail",
    slug: "pokemon-detail",
    name: "Detail",
    projectId: "p1",
    createdAt: 2,
    spec: { route: "{id}" },
  };
  const STATE = {
    queries: { pokemonList: { data: [{ id: 1 }, { id: 4 }] } },
  };

  test("the editor appends the built path for any screen", () => {
    const pushed: string[] = [];
    const ok = runNavigate(
      { screen: "detail", id: 4 },
      {
        entries: [GRID, DETAIL],
        scope: "p1",
        surface: "editor",
        projects: PROJECTS,
        navigate: (route) => pushed.push(route),
      },
    );

    expect(ok).toBe(true);
    expect(pushed).toEqual(["/ui/detail/4"]);
    expect(warnings).toHaveLength(0);
  });

  test("$item path params deref against the state snapshot", () => {
    const pushed: string[] = [];
    const ok = runNavigate(
      { screen: "detail", id: "/queries/pokemonList/data/1/id" },
      {
        entries: [GRID, DETAIL],
        scope: "p1",
        surface: "editor",
        projects: PROJECTS,
        state: STATE,
        navigate: (route) => pushed.push(route),
      },
    );

    expect(ok).toBe(true);
    expect(pushed).toEqual(["/ui/detail/4"]);
    expect(warnings).toHaveLength(0);
  });

  test("a project target with buildable params skips its screen slug", () => {
    const pushed: string[] = [];
    const ok = runNavigate(
      { screen: "detail", id: 4 },
      {
        entries: [GRID, DETAIL],
        scope: "p1",
        surface: "preview",
        locale: "en",
        projects: PROJECTS,
        navigate: (route) => pushed.push(route),
      },
    );

    expect(ok).toBe(true);
    expect(pushed).toEqual(["/en/pokedex/4"]);
    expect(warnings).toHaveLength(0);
  });

  test("the home screen serves the bare namespace; siblings keep their slug", () => {
    const pushed: string[] = [];
    const navigate = (route: string) => pushed.push(route);
    const base = {
      entries: [GRID, DETAIL],
      scope: "p1",
      surface: "preview",
      locale: "en",
      projects: PROJECTS,
      memberships: MEMBERSHIPS,
      navigate,
    } as const;

    runNavigate({ screen: "grid" }, base);
    runNavigate({ screen: "detail" }, base);

    expect(pushed).toEqual(["/en/pokedex", "/en/pokedex/pokemon-detail"]);
    expect(warnings).toHaveLength(0);
  });

  test("no project keeps the flat route (+ built path when a pattern exists)", () => {
    const flat: ScreenSource = {
      id: "flat",
      slug: "flat-screen",
      name: "Flat",
      spec: { route: "{id}" },
    };
    const pushed: string[] = [];
    const navigate = (route: string) => pushed.push(route);

    runNavigate(
      { screen: "flat", id: 9 },
      {
        entries: [flat],
        scope: null,
        surface: "preview",
        locale: "en",
        navigate,
      },
    );
    runNavigate(
      { screen: "flat" },
      {
        entries: [flat],
        scope: null,
        surface: "preview",
        locale: "en",
        navigate,
      },
    );

    expect(pushed).toEqual(["/en/flat-screen/9", "/en/flat-screen"]);
    expect(warnings).toHaveLength(0);
  });

  test("unbuildable params warn loudly and navigate bare", () => {
    const pushed: string[] = [];
    const navigate = (route: string) => pushed.push(route);

    // Params to a screen with no route pattern.
    runNavigate(
      { screen: "grid", id: 4 },
      {
        entries: [GRID, DETAIL],
        scope: "p1",
        surface: "preview",
        locale: "en",
        projects: PROJECTS,
        memberships: MEMBERSHIPS,
        navigate,
      },
    );
    // A path param that does not resolve against the snapshot.
    runNavigate(
      { screen: "detail", id: "/queries/pokemonList/data/9/id" },
      {
        entries: [GRID, DETAIL],
        scope: "p1",
        surface: "preview",
        locale: "en",
        projects: PROJECTS,
        memberships: MEMBERSHIPS,
        state: STATE,
        navigate,
      },
    );

    expect(pushed).toEqual(["/en/pokedex", "/en/pokedex/pokemon-detail"]);
    expect(warnings.join(" ")).toContain("do not build");
    expect(warnings).toHaveLength(2);
  });

  test("an unresolvable path param without a snapshot never leaks the path", () => {
    const pushed: string[] = [];
    const ok = runNavigate(
      { screen: "detail", id: "/queries/list/data/0/id" },
      {
        entries: [GRID, DETAIL],
        scope: "p1",
        surface: "preview",
        locale: "en",
        projects: PROJECTS,
        navigate: (route) => pushed.push(route),
      },
    );

    expect(ok).toBe(true);
    expect(pushed).toEqual(["/en/pokedex/pokemon-detail"]);
    expect(pushed.join(" ")).not.toContain("/queries");
    expect(warnings).toHaveLength(1);
  });
});

/** Creates a throwaway project (createProject auto-activates it). */
function createTempProject(): string {
  const project = createProject("scope-test");
  return project?.id ?? "";
}
