import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  resolveScreenRef,
  runNavigate,
  screenRoute,
  screenScope,
  screensInScope,
  toScreenListings,
} from "./screen-nav";
import type { ScreenSource } from "./screen-nav";
import {
  createProject,
  getProjects,
  removeProject,
  setActiveProjectId,
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
  test("maps screens to the {ref, name} pairs prompt and tile offer", () => {
    expect(toScreenListings(screensInScope(ENTRIES, "p1"))).toEqual([
      { ref: "aaa", name: "Alpha" },
      { ref: "bbb", name: "Beta app" },
    ]);
  });
});

/** Creates a throwaway project (createProject auto-activates it). */
function createTempProject(): string {
  const project = createProject("scope-test");
  return project?.id ?? "";
}
