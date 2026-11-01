import { describe, expect, test } from "bun:test";
import type { Spec } from "@json-render/core";
import type { HistoryEntry } from "@/lib/history";
import { groupEntriesForDrawer } from "./drawer-groups";
import type { ProjectMembership } from "./memberships";
import type { Project } from "./projects";

const PROJECTS: Project[] = [
  {
    id: "p1",
    name: "Pokédex",
    slug: "pokedex",
    createdAt: 1,
    updatedAt: 1,
    state: {},
  },
  {
    id: "p2",
    name: "Shop",
    slug: "shop",
    createdAt: 2,
    updatedAt: 2,
    state: {},
  },
];

function entry(init: {
  id: string;
  projectId?: string;
  createdAt?: number;
}): HistoryEntry {
  return {
    id: init.id,
    slug: init.id,
    name: init.id,
    projectId: init.projectId,
    createdAt: init.createdAt ?? 1,
    updatedAt: init.createdAt ?? 1,
    prompt: "",
    revisions: [],
    head: 0,
    spec: { root: "root", elements: {} } as unknown as Spec,
  };
}

function member(init: {
  screenId: string;
  projectId?: string;
  position?: number;
  createdAt?: number;
  id?: string;
}): ProjectMembership {
  return {
    id: init.id ?? `m-${init.screenId}`,
    projectId: init.projectId ?? "p1",
    screenId: init.screenId,
    route: null,
    position: init.position ?? 0,
    createdAt: init.createdAt ?? 1,
    updatedAt: init.createdAt ?? 1,
  };
}

describe("groupEntriesForDrawer (065 task 4: membership-driven)", () => {
  test("rows decide membership and order; a pointer alone claims nothing", () => {
    const entries = [
      entry({ id: "m1", projectId: "p1", createdAt: 5 }),
      entry({ id: "m2", projectId: "p1", createdAt: 1 }),
      // Pointer points at p1 but no row — the backfill/healing will add one
      // on the next commit or reload; until then the legacy bucket holds it.
      entry({ id: "pointer-only", projectId: "p1" }),
      entry({ id: "loose" }),
    ];
    const rows = [
      member({ screenId: "m1", position: 1, createdAt: 5, id: "r1" }),
      member({ screenId: "m2", position: 0, createdAt: 1, id: "r2" }),
    ];

    const groups = groupEntriesForDrawer(entries, PROJECTS, rows);
    // p1 lists its members by POSITION, not entry order or createdAt.
    expect(groups[0].project?.id).toBe("p1");
    expect(groups[0].entries.map((e) => e.id)).toEqual(["m2", "m1"]);
    // p2 is screenless but still listed (a fresh project must be visible).
    expect(groups[1].project?.id).toBe("p2");
    expect(groups[1].entries).toEqual([]);
    // Unclaimed entries trail in the legacy bucket, input order kept.
    expect(groups[2].project).toBeNull();
    expect(groups[2].entries.map((e) => e.id)).toEqual([
      "pointer-only",
      "loose",
    ]);
  });

  test("a screen in two projects appears in both groups", () => {
    const entries = [entry({ id: "shared", projectId: "p1" })];
    const rows = [
      member({ screenId: "shared", projectId: "p1", position: 0 }),
      member({ screenId: "shared", projectId: "p2", position: 0, id: "r2" }),
    ];

    const groups = groupEntriesForDrawer(entries, PROJECTS, rows);
    expect(groups[0].entries.map((e) => e.id)).toEqual(["shared"]);
    expect(groups[1].entries.map((e) => e.id)).toEqual(["shared"]);
    // Every entry claimed → no legacy bucket at all.
    expect(groups).toHaveLength(2);
  });

  test("dangling rows and rows of unknown projects claim nothing", () => {
    const entries = [entry({ id: "loose" })];
    const rows = [
      // Screen entry deleted — the row dangles and must not resurrect it.
      member({ screenId: "deleted", position: 0 }),
      // Project no longer exists — its row never moves the entry into p1.
      member({ screenId: "loose", projectId: "gone", position: 0 }),
    ];

    const groups = groupEntriesForDrawer(entries, PROJECTS, rows);
    expect(groups[0].entries).toEqual([]);
    expect(groups[1].entries).toEqual([]);
    expect(groups[2].project).toBeNull();
    expect(groups[2].entries.map((e) => e.id)).toEqual(["loose"]);
  });

  test("position ties break by createdAt then row id (decision 6)", () => {
    const entries = [
      entry({ id: "a", projectId: "p1" }),
      entry({ id: "b", projectId: "p1" }),
      entry({ id: "c", projectId: "p1" }),
    ];
    const rows = [
      member({ screenId: "a", position: 0, createdAt: 9, id: "r-a" }),
      member({ screenId: "b", position: 0, createdAt: 9, id: "r-b" }),
      member({ screenId: "c", position: 0, createdAt: 1, id: "r-c" }),
    ];

    const groups = groupEntriesForDrawer(entries, PROJECTS, rows);
    // c wins on createdAt; a before b on the row id tie-break.
    expect(groups[0].entries.map((e) => e.id)).toEqual(["c", "a", "b"]);
  });
});
