import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Spec } from "@json-render/core";
import { addEntry, createEntry, getHistory, removeEntry } from "@/lib/history";
import type { HistoryEntry } from "@/lib/history";
import {
  ACTIVE_PROJECT_STORAGE_KEY,
  PROJECT_STORAGE_KEY,
  slugifyProjectName,
} from "./projects";

type ProjectsModule = typeof import("./projects");

let store: ProjectsModule;

function makeSpec(heading: string): Spec {
  return {
    root: "root",
    elements: { root: { type: "Card", props: { title: heading } } },
  };
}

/** The window's storage — reuses the shared test window or installs one. */
function storage(): Storage {
  const globalWindow = globalThis as { window?: unknown };
  const candidate = globalWindow.window as
    { localStorage?: Storage } | undefined;
  if (!candidate || !candidate.localStorage) {
    const map = new Map<string, string>();
    globalWindow.window = {
      localStorage: {
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => {
          map.set(key, value);
        },
        removeItem: (key: string) => {
          map.delete(key);
        },
      },
    } as unknown as Window & typeof globalThis;
    return (globalWindow.window as { localStorage: Storage }).localStorage;
  }
  return candidate.localStorage;
}

const ls = (): Storage => storage();

describe("project store", () => {
  beforeAll(async () => {
    const local = storage();
    local.setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify([
        { id: "proj-1", name: "Pokedex", createdAt: 1, updatedAt: 1 },
        // Junk the sanitizer must drop: missing name, empty id, non-object.
        { id: "bad", createdAt: 2 },
        { id: "", name: "Empty id", createdAt: 3 },
        "not-an-object",
      ]),
    );
    local.setItem(ACTIVE_PROJECT_STORAGE_KEY, "proj-1");
    // Cache-busted: a fresh module instance reads the seeded storage (another
    // test file may have imported `lib/projects/projects` already).
    const hydratedSpecifier = "./projects.ts?hydrated";
    store = (await import(hydratedSpecifier)) as ProjectsModule;
  });

  beforeEach(() => {
    // Reset through the store's own API so cache and storage agree.
    for (const project of [...store.getProjects()]) {
      store.removeProject(project.id);
    }
    ls().removeItem(PROJECT_STORAGE_KEY);
    ls().removeItem(ACTIVE_PROJECT_STORAGE_KEY);
  });

  test("hydration keeps only valid projects and resolves the active id", async () => {
    const local = storage();
    local.setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify([
        { id: "proj-1", name: "Pokedex", createdAt: 1, updatedAt: 1 },
        { id: "bad", createdAt: 2 },
      ]),
    );
    local.setItem(ACTIVE_PROJECT_STORAGE_KEY, "proj-1");

    const hydrationSpecifier = "./projects.ts?hydration";
    const fresh = (await import(hydrationSpecifier)) as ProjectsModule;

    expect(fresh.getProjects().map((project) => project.id)).toEqual([
      "proj-1",
    ]);
    expect(fresh.getActiveProjectId()).toBe("proj-1");
    expect(fresh.getServerProjects()).toEqual([]);
    expect(fresh.getServerActiveProjectId()).toBeNull();
  });

  test("an active id pointing at a missing project reads as none", async () => {
    const local = storage();
    local.setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify([{ id: "proj-1", name: "Kept", createdAt: 1 }]),
    );
    local.setItem(ACTIVE_PROJECT_STORAGE_KEY, "gone");

    const staleSpecifier = "./projects.ts?stale";
    const fresh = (await import(staleSpecifier)) as ProjectsModule;

    expect(fresh.getActiveProjectId()).toBeNull();
  });

  test("createProject trims, activates and persists; empty names are rejected", () => {
    let notified = 0;
    const unsubscribe = store.subscribeProjects(() => {
      notified += 1;
    });

    expect(store.createProject("   ")).toBeNull();
    const project = store.createProject("  Pokedex app  ");

    expect(project).not.toBeNull();
    const created = project as NonNullable<typeof project>;
    expect(created.name).toBe("Pokedex app");
    expect(store.getActiveProjectId()).toBe(created.id);
    expect(store.getProjects().map((entry) => entry.id)).toContain(created.id);
    expect(JSON.parse(ls().getItem(PROJECT_STORAGE_KEY) ?? "[]")).toHaveLength(
      1,
    );
    expect(ls().getItem(ACTIVE_PROJECT_STORAGE_KEY)).toBe(created.id);
    expect(notified).toBeGreaterThan(0);

    unsubscribe();
  });

  test("renameProject trims and no-ops on empty, unchanged and unknown ids", () => {
    const project = store.createProject("First");
    expect(project).not.toBeNull();
    const created = project as NonNullable<typeof project>;

    store.renameProject(created.id, "   ");
    expect(store.getProjects()[0].name).toBe("First");

    store.renameProject("nope", "Ghost");
    expect(store.getProjects()).toHaveLength(1);

    store.renameProject(created.id, "First");
    expect(store.getProjects()[0].updatedAt).toBe(created.createdAt);

    store.renameProject(created.id, "  Second  ");
    expect(store.getProjects()[0].name).toBe("Second");
    expect(store.getProjects()[0].id).toBe(created.id);
  });

  test("removeProject deactivates itself and ungroups its entries", () => {
    const project = store.createProject("Doomed");
    expect(project).not.toBeNull();
    const doomed = project as NonNullable<typeof project>;

    const entry: HistoryEntry = createEntry(
      "screen",
      makeSpec("v0"),
      doomed.id,
    );
    // The history store is shared across test files — add ours, clean it up.
    addEntry(entry);
    expect(
      getHistory().find((candidate) => candidate.id === entry.id)?.projectId,
    ).toBe(doomed.id);

    store.removeProject(doomed.id);

    expect(store.getProjects()).toHaveLength(0);
    expect(store.getActiveProjectId()).toBeNull();
    expect(
      getHistory().find((candidate) => candidate.id === entry.id)?.projectId,
    ).toBeUndefined();

    removeEntry(entry.id);
    // Unknown id is a no-op.
    store.removeProject("nope");
    expect(store.getProjects()).toHaveLength(0);
  });

  test("setActiveProjectId rejects unknown ids and accepts null", () => {
    const project = store.createProject("Only");
    expect(project).not.toBeNull();
    const created = project as NonNullable<typeof project>;

    store.setActiveProjectId("ghost");
    expect(store.getActiveProjectId()).toBe(created.id);

    store.setActiveProjectId(null);
    expect(store.getActiveProjectId()).toBeNull();
    expect(ls().getItem(ACTIVE_PROJECT_STORAGE_KEY)).toBeNull();

    store.setActiveProjectId(created.id);
    expect(store.getActiveProjectId()).toBe(created.id);
  });

  test("corrupt stored JSON falls back to an empty list", async () => {
    const local = storage();
    local.setItem(PROJECT_STORAGE_KEY, "not json at all");
    local.setItem(ACTIVE_PROJECT_STORAGE_KEY, "proj-1");

    const corruptSpecifier = "./projects.ts?corrupt";
    const fresh = (await import(corruptSpecifier)) as ProjectsModule;

    expect(fresh.getProjects()).toEqual([]);
    expect(fresh.getActiveProjectId()).toBeNull();
    // And a write still works over the corrupt value.
    const created = fresh.createProject("Recovered");
    expect(created).not.toBeNull();
    expect(JSON.parse(local.getItem(PROJECT_STORAGE_KEY) ?? "[]")).toHaveLength(
      1,
    );
  });

  test("slugifyProjectName strips diacritics, collapses junk, never empties", () => {
    expect(slugifyProjectName("Pokédex")).toBe("pokedex");
    expect(slugifyProjectName("  Pokédex App v2!! ")).toBe("pokedex-app-v2");
    expect(slugifyProjectName("Ñoño & Co")).toBe("nono-co");
    expect(slugifyProjectName("")).toBe("project");
    expect(slugifyProjectName("???")).toBe("project");
  });

  test("a legacy record backfills its slug from the name; rename re-derives it", async () => {
    const local = storage();
    local.setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify([
        { id: "legacy", name: "Pokédex app v2", createdAt: 1, updatedAt: 1 },
      ]),
    );

    const slugSpecifier = "./projects.ts?slug";
    const fresh = (await import(slugSpecifier)) as ProjectsModule;

    expect(fresh.getProjects()[0].slug).toBe("pokedex-app-v2");
    expect(fresh.projectBySlug("pokedex-app-v2")?.id).toBe("legacy");
    expect(fresh.projectBySlug("")).toBeNull();
    expect(fresh.projectBySlug("ghost")).toBeNull();

    // The namespace follows the project rename (decision 9).
    fresh.renameProject("legacy", "Pokédex");
    expect(fresh.getProjects()[0].slug).toBe("pokedex");
    expect(fresh.projectBySlug("pokedex")?.id).toBe("legacy");
  });

  test("colliding names get unique slugs — create and rename never steal a namespace", () => {
    const first = store.createProject("Pokédex");
    const second = store.createProject("Pokedex");
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    const a = first as NonNullable<typeof first>;
    const b = second as NonNullable<typeof second>;

    expect(a.slug).toBe("pokedex");
    expect(b.slug).toBe("pokedex-2");

    // Renaming b to a colliding name keeps it on its (already unique) slug.
    store.renameProject(b.id, "Pokédex");
    expect(
      store.getProjects().find((project) => project.id === b.id)?.slug,
    ).toBe("pokedex-2");

    const third = store.createProject("Pokédex");
    expect(third).not.toBeNull();
    expect((third as NonNullable<typeof third>).slug).toBe("pokedex-3");
  });

  test("getSessionState reads the shared value and misses null/unknown ids", () => {
    expect(store.getSessionState(null)).toBeUndefined();
    expect(store.getSessionState(undefined)).toBeUndefined();
    expect(store.getSessionState("ghost")).toBeUndefined();

    const project = store.createProject("Shared");
    expect(project).not.toBeNull();
    const created = project as NonNullable<typeof project>;
    // Fresh projects start with an empty (but present) session object.
    expect(store.getSessionState(created.id)).toEqual({});
  });

  test("setSessionState writes objects through, persists them, and ignores everything else", () => {
    const project = store.createProject("Shared");
    expect(project).not.toBeNull();
    const created = project as NonNullable<typeof project>;

    store.setSessionState(
      created.id,
      { token: "shared-42", count: 2 },
      store.stampSessionValue(),
    );
    expect(store.getSessionState(created.id)).toEqual({
      token: "shared-42",
      count: 2,
    });
    const stored = JSON.parse(ls().getItem(PROJECT_STORAGE_KEY) ?? "[]") as {
      id: string;
      state?: unknown;
    }[];
    expect(stored.find((entry) => entry.id === created.id)?.state).toEqual({
      token: "shared-42",
      count: 2,
    });

    // Object-shaped by design: arrays and primitives never persist.
    store.setSessionState(created.id, ["array"], store.stampSessionValue());
    store.setSessionState(created.id, "scalar", store.stampSessionValue());
    store.setSessionState(created.id, null, store.stampSessionValue());
    store.setSessionState(created.id, undefined, store.stampSessionValue());
    expect(store.getSessionState(created.id)).toEqual({
      token: "shared-42",
      count: 2,
    });

    // Unknown ids are a no-op.
    store.setSessionState("ghost", { x: 1 }, store.stampSessionValue());
    expect(store.getProjects()).toHaveLength(1);
  });

  test("rewriting identical session content writes nothing (the post-mount seed echo)", () => {
    const project = store.createProject("Echo");
    expect(project).not.toBeNull();
    const created = project as NonNullable<typeof project>;
    store.setSessionState(
      created.id,
      { token: "shared-42" },
      store.stampSessionValue(),
    );

    const local = storage();
    const original = local.setItem;
    const countWritesWhile = (run: () => void): number => {
      let writes = 0;
      local.setItem = function (this: Storage, key: string, value: string) {
        writes += 1;
        original.call(this, key, value);
      };
      try {
        run();
      } finally {
        local.setItem = original;
      }
      return writes;
    };

    // Same content (stringify equality, how it round-trips through storage).
    expect(
      countWritesWhile(() => {
        store.setSessionState(
          created.id,
          { token: "shared-42" },
          store.stampSessionValue(),
        );
      }),
    ).toBe(0);
    // A real change writes exactly once.
    expect(
      countWritesWhile(() => {
        store.setSessionState(
          created.id,
          { token: "changed" },
          store.stampSessionValue(),
        );
      }),
    ).toBe(1);
    expect(store.getSessionState(created.id)).toEqual({ token: "changed" });
  });

  test("stale stamps are rejected — only strictly newer writes land (061-4 Activity race)", () => {
    const project = store.createProject("Recency");
    expect(project).not.toBeNull();
    const created = project as NonNullable<typeof project>;

    const first = store.stampSessionValue();
    expect(store.setSessionState(created.id, { token: "a" }, first)).toBe(true);
    const second = store.stampSessionValue();
    expect(store.setSessionState(created.id, { token: "b" }, second)).toBe(
      true,
    );

    // A stale hidden instance flushing the OLD value with its OLD stamp:
    // rejected whatever its content — the store keeps the fresher value.
    expect(store.setSessionState(created.id, { token: "a" }, first)).toBe(
      false,
    );
    expect(store.getSessionState(created.id)).toEqual({ token: "b" });

    // Equal stamps never overwrite; a genuinely newer one regains the store.
    expect(store.setSessionState(created.id, { token: "c" }, second)).toBe(
      false,
    );
    const third = store.stampSessionValue();
    expect(store.setSessionState(created.id, { token: "c" }, third)).toBe(true);
    expect(store.getSessionState(created.id)).toEqual({ token: "c" });
  });

  test("a stored project without (or with junk) shared state backfills to {}", async () => {
    const local = storage();
    local.setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify([
        { id: "legacy", name: "Pre-061-4", createdAt: 1, updatedAt: 1 },
        {
          id: "junk",
          name: "Junk state",
          createdAt: 2,
          updatedAt: 2,
          state: ["array"],
        },
        {
          id: "scalar",
          name: "Scalar state",
          createdAt: 3,
          updatedAt: 3,
          state: "nope",
        },
      ]),
    );

    const sessionSpecifier = "./projects.ts?session-hydration";
    const fresh = (await import(sessionSpecifier)) as ProjectsModule;

    expect(fresh.getProjects().map((candidate) => candidate.state)).toEqual([
      {},
      {},
      {},
    ]);
    // And the backfilled shape is writable like any other project.
    fresh.setSessionState("legacy", { token: "t" }, fresh.stampSessionValue());
    expect(fresh.getSessionState("legacy")).toEqual({ token: "t" });
  });

  test("createProjectEntry stamps the active project (generation and import seam)", () => {
    store.setActiveProjectId(null);
    const loose = store.createProjectEntry("Loose screen", makeSpec("v0"));
    expect(loose.projectId).toBeUndefined();

    const project = store.createProject("Grouped");
    expect(project).not.toBeNull();
    const created = project as NonNullable<typeof project>;
    const grouped = store.createProjectEntry("Grouped screen", makeSpec("v1"));
    expect(grouped.projectId).toBe(created.id);

    // The history store is shared across test files — clean up both.
    removeEntry(loose.id);
    removeEntry(grouped.id);
  });
});
