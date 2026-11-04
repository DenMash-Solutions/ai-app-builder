import { describe, expect, test } from "bun:test";
import type { Spec } from "@json-render/core";
import { createEntry } from "@/lib/history";
import type { HistoryEntry } from "@/lib/history";
import type { ProjectMembership } from "@/lib/projects/memberships";
import type { Project } from "@/lib/projects/projects";
import type { ProjectEntryPoint } from "./project-publish";
import {
  PROJECT_PUBLISH_ISSUES,
  isWellFormedRoutePattern,
  validateProjectPublish,
} from "./validate-project";

function makeSpec(heading: string): Spec {
  return {
    root: "root",
    elements: { root: { type: "Card", props: { title: heading } } },
  };
}

function entry(id: string, slug: string): HistoryEntry {
  const base = createEntry(`screen ${id}`, makeSpec(id));
  return { ...base, id, slug };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    name: "Pokedex",
    slug: "pokedex",
    createdAt: 1,
    updatedAt: 1,
    state: {},
    homeScreenId: null,
    ...overrides,
  };
}

function member(
  id: string,
  screenId: string,
  route: string | null,
  position: number,
  projectId = "proj-1",
): ProjectMembership {
  return {
    id,
    projectId,
    screenId,
    route,
    position,
    createdAt: position + 1,
    updatedAt: position + 1,
  };
}

function rowsFor(entries: readonly HistoryEntry[]): ProjectEntryPoint[] {
  return entries.map((e) => ({ route: e.slug, screenId: e.id, spec: e.spec }));
}

describe("isWellFormedRoutePattern", () => {
  test("accepts literals, single and multi-param patterns", () => {
    expect(isWellFormedRoutePattern("settings")).toBe(true);
    expect(isWellFormedRoutePattern("items/{id}")).toBe(true);
    expect(isWellFormedRoutePattern("{a}/{b}")).toBe(true);
    expect(isWellFormedRoutePattern("")).toBe(true);
  });

  test("rejects stray braces, anonymous and nested placeholders", () => {
    expect(isWellFormedRoutePattern("items/{id")).toBe(false);
    expect(isWellFormedRoutePattern("items/id}")).toBe(false);
    expect(isWellFormedRoutePattern("{}")).toBe(false);
    expect(isWellFormedRoutePattern("{ }")).toBe(false);
    expect(isWellFormedRoutePattern("a{{b}")).toBe(false);
  });
});

describe("validateProjectPublish (decision 20)", () => {
  const entries = [entry("s-home", "home"), entry("s-a", "alpha")];
  const memberships = [
    member("m-home", "s-home", null, 0),
    member("m-a", "s-a", null, 1),
  ];
  const project = makeProject({ homeScreenId: "s-home" });

  test("a complete project validates", () => {
    expect(
      validateProjectPublish(project, entries, memberships, rowsFor(entries)),
    ).toEqual({ ok: true });
  });

  test("no home screen refuses with noHome", () => {
    const result = validateProjectPublish(
      makeProject({ homeScreenId: null }),
      entries,
      memberships,
      rowsFor(entries),
    );
    expect(result.ok).toBe(false);
    expect(result.issue).toBe(PROJECT_PUBLISH_ISSUES.noHome);
  });

  test("a dangling home id refuses with noHome (same as the resolver)", () => {
    const result = validateProjectPublish(
      makeProject({ homeScreenId: "s-deleted" }),
      entries,
      memberships,
      rowsFor(entries),
    );
    expect(result.issue).toBe(PROJECT_PUBLISH_ISSUES.noHome);
  });

  test("a membership whose screen is gone refuses with missingScreen", () => {
    const result = validateProjectPublish(
      project,
      entries,
      [...memberships, member("m-ghost", "s-deleted", null, 2)],
      rowsFor(entries),
    );
    expect(result.issue).toBe(PROJECT_PUBLISH_ISSUES.missingScreen);
    expect(result.detail).toBe("s-deleted");
  });

  test("a malformed configured route refuses with invalidRoute", () => {
    const result = validateProjectPublish(
      project,
      entries,
      [...memberships, member("m-bad", "s-a", "items/{id", 2)],
      rowsFor(entries),
    );
    expect(result.issue).toBe(PROJECT_PUBLISH_ISSUES.invalidRoute);
    expect(result.detail).toBe("items/{id");
  });

  test("a keyless api source refuses with dataConfig (067 gate)", () => {
    const badSpec = {
      ...makeSpec("bad"),
      dataSources: {
        remote: {
          provider: "api",
          config: { baseUrl: "https://api.example.com", itemsPath: "/items" },
        },
      },
      resources: { items: { dataSource: "remote" } },
    } as unknown as Spec;
    const bad: HistoryEntry = {
      ...entry("s-a", "alpha"),
      spec: badSpec,
      revisions: [{ spec: badSpec, label: "r0", createdAt: 1 }],
      head: 0,
    };
    const result = validateProjectPublish(
      project,
      [entries[0], bad],
      memberships,
      rowsFor([entries[0], bad]),
    );
    expect(result.issue).toBe(PROJECT_PUBLISH_ISSUES.dataConfig);
    expect(result.detail).toContain("auth.ref");
  });

  test("memberships of other projects never block this project's publish", () => {
    const result = validateProjectPublish(
      project,
      entries,
      [...memberships, member("m-foreign", "s-gone", "bad{", 9, "proj-2")],
      rowsFor(entries),
    );
    expect(result).toEqual({ ok: true });
  });

  test("checks run in order: home first, then screens, then data", () => {
    const noHome = validateProjectPublish(
      makeProject({ homeScreenId: null }),
      [],
      [member("m-ghost", "s-deleted", "bad{", 0)],
      [],
    );
    expect(noHome.issue).toBe(PROJECT_PUBLISH_ISSUES.noHome);
  });
});
