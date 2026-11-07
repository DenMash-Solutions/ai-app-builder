import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Spec } from "@json-render/core";
import { addEntry, createEntry, getHistory, removeEntry } from "@/lib/history";
import type { HistoryEntry } from "@/lib/history";
import {
  ACTIVE_PROJECT_STORAGE_KEY,
  PROJECT_DELETIONS_STORAGE_KEY,
  PROJECT_STORAGE_KEY,
  slugifyProjectName,
} from "./projects";
import type { Project } from "./projects";

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
        get length() {
          return map.size;
        },
        key: (index: number) => [...map.keys()][index] ?? null,
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
    ls().removeItem(PROJECT_DELETIONS_STORAGE_KEY);
  });

  test("a removed project stays removed until its remote delete lands", () => {
    const created = store.createProject("Discard me");
    expect(created).not.toBeNull();
    const project = created!;

    store.removeProject(project.id);
    expect(store.getProjects().some((row) => row.id === project.id)).toBe(
      false,
    );
    expect(store.isProjectDeletionPending(project.id)).toBe(true);

    // The pull delivers the row again — the guard refuses the adoption.
    store.applyRemoteProject({ ...project, updatedAt: Date.now() });
    expect(store.getProjects().some((row) => row.id === project.id)).toBe(
      false,
    );

    // The delete pass removed it remotely; a later pull may adopt again.
    store.clearProjectDeletions([project.id]);
    expect(store.isProjectDeletionPending(project.id)).toBe(false);
    store.applyRemoteProject({ ...project, updatedAt: Date.now() });
    expect(store.getProjects().some((row) => row.id === project.id)).toBe(true);
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

  test("removeProject purges its own resource rows and keeps another project's", () => {
    // This test needs an ENUMERABLE storage (length + key): other suites may
    // have installed a partial window fake earlier in the same process, and
    // a shared one would make the purge's prefix scan see nothing.
    const scope = globalThis as unknown as {
      window?: { localStorage?: Storage };
    };
    const complete = new Map<string, string>();
    const previous = scope.window?.localStorage;
    const storageFake = {
      get length() {
        return complete.size;
      },
      key: (index: number) => [...complete.keys()][index] ?? null,
      getItem: (key: string) => complete.get(key) ?? null,
      setItem: (key: string, value: string) => {
        complete.set(key, value);
      },
      removeItem: (key: string) => {
        complete.delete(key);
      },
      clear: () => complete.clear(),
    } as unknown as Storage;
    scope.window = { ...(scope.window ?? {}), localStorage: storageFake };

    const doomedProject = store.createProject("Purged");
    const keptProject = store.createProject("Kept");
    const doomed = doomedProject as NonNullable<typeof doomedProject>;
    const kept = keptProject as NonNullable<typeof keptProject>;

    storageFake.setItem(`genui-data:${doomed.id}:cart`, "[1]");
    storageFake.setItem(`genui-data:${doomed.id}:orders`, "[]");
    storageFake.setItem(`genui-data:${kept.id}:cart`, "[2]");

    store.removeProject(doomed.id);

    // 067 decision 4: deletion owns the data, scoped by the project namespace.
    expect(storageFake.getItem(`genui-data:${doomed.id}:cart`)).toBeNull();
    expect(storageFake.getItem(`genui-data:${doomed.id}:orders`)).toBeNull();
    expect(storageFake.getItem(`genui-data:${kept.id}:cart`)).toBe("[2]");

    store.removeProject(kept.id);
    if (previous === undefined) delete scope.window?.localStorage;
    else scope.window = { ...(scope.window ?? {}), localStorage: previous };
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

  test("a real session write bumps updatedAt for the LWW compare (064 d2)", () => {
    const project = store.createProject("Shared clock");
    expect(project).not.toBeNull();
    const created = project as NonNullable<typeof project>;

    // Deterministic advance: the bump must strictly exceed the create stamp.
    const realNow = Date.now;
    let clock = realNow();
    Date.now = () => (clock += 5000);
    try {
      expect(
        store.setSessionState(
          created.id,
          { token: "a" },
          store.stampSessionValue(),
        ),
      ).toBe(true);
      expect(store.getProjects()[0].updatedAt).toBeGreaterThan(
        created.updatedAt,
      );

      const bumped = store.getProjects()[0].updatedAt;
      // Identical content is still the no-op seed echo — no second bump.
      expect(
        store.setSessionState(
          created.id,
          { token: "a" },
          store.stampSessionValue(),
        ),
      ).toBe(false);
      expect(store.getProjects()[0].updatedAt).toBe(bumped);
    } finally {
      Date.now = realNow;
    }
  });

  test("applyRemoteProject adopts the row, stamps the baseline and bumps a local slug holder (064)", () => {
    const local = store.createProject("Pokédex");
    expect(local).not.toBeNull();
    const created = local as NonNullable<typeof local>;

    // A session write stamped BEFORE the adoption must not clobber it.
    const staleStamp = store.stampSessionValue();
    const remote: Project = {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Pokédex",
      slug: "pokedex",
      createdAt: 1000,
      updatedAt: 9000,
      state: { team: ["pikachu"] },
    };
    store.applyRemoteProject(remote);

    const projects = store.getProjects();
    expect(projects).toHaveLength(2);
    expect(projects.find((candidate) => candidate.id === remote.id)).toEqual(
      remote,
    );
    // The local holder yields the slug (constraint truth), never dropped.
    expect(
      projects.find((candidate) => candidate.id === created.id)?.slug,
    ).toBe("pokedex-2");
    expect(
      store.setSessionState(remote.id, { team: ["mew"] }, staleStamp),
    ).toBe(false);
    expect(
      store.getProjects().find((candidate) => candidate.id === remote.id)
        ?.state,
    ).toEqual({ team: ["pikachu"] });

    // Persisted for the next read.
    const stored = JSON.parse(
      ls().getItem(PROJECT_STORAGE_KEY) ?? "[]",
    ) as Project[];
    expect(stored).toHaveLength(2);
    expect(stored.find((candidate) => candidate.id === remote.id)?.slug).toBe(
      "pokedex",
    );
  });

  test("reconcileProjectSlugs bumps local holders against foreign remote ids only (064)", () => {
    const alpha = store.createProject("Alpha");
    expect(alpha).not.toBeNull();
    const alphaProject = alpha as NonNullable<typeof alpha>;
    const beta = store.createProject("Beta");
    expect(beta).not.toBeNull();
    const betaProject = beta as NonNullable<typeof beta>;

    store.reconcileProjectSlugs([
      { id: "remote-1", slug: "alpha" }, // foreign id → bump the local copy
      { id: betaProject.id, slug: "beta" }, // our own row → never bump
      { id: "remote-2", slug: "alpha-2" }, // the suffix must skip it
    ]);

    const projects = store.getProjects();
    expect(
      projects.find((candidate) => candidate.id === alphaProject.id)?.slug,
    ).toBe("alpha-3");
    expect(
      projects.find((candidate) => candidate.id === betaProject.id)?.slug,
    ).toBe("beta");
    const betaUpdatedAt = projects.find(
      (candidate) => candidate.id === betaProject.id,
    )?.updatedAt;

    // No local holder → a no-op: nothing bumped, nothing re-stamped.
    store.reconcileProjectSlugs([{ id: "remote-3", slug: "gamma" }]);
    const after = store.getProjects();
    expect(
      after.find((candidate) => candidate.id === betaProject.id)?.updatedAt,
    ).toBe(betaUpdatedAt);
    expect(after.map((candidate) => candidate.slug)).toContain("alpha-3");
  });

  test("createProject rejects names whose slug is reserved (064)", () => {
    for (const name of ["admin", "  Admin  ", "ui", "login", "SIGNUP"]) {
      expect(store.createProject(name)).toBeNull();
    }
    expect(store.getProjects()).toHaveLength(0);
    expect(ls().getItem(PROJECT_STORAGE_KEY)).toBeNull();

    // "Sign Up" slugifies to "sign-up" — a near-miss that stays allowed.
    const near = store.createProject("Sign Up");
    expect(near?.slug).toBe("sign-up");
  });

  test("renameProject rejects reserved names and keeps the project intact (064)", () => {
    const project = store.createProject("Pokedex") as Project;
    store.renameProject(project.id, "Admin");
    store.renameProject(project.id, "ui");

    const current = store.getProjects().find((c) => c.id === project.id);
    expect(current?.name).toBe("Pokedex");
    expect(current?.slug).toBe("pokedex");

    // A non-reserved rename still re-derives the slug as before.
    store.renameProject(project.id, "Sign Up");
    expect(store.getProjects().find((c) => c.id === project.id)?.slug).toBe(
      "sign-up",
    );
  });

  test("projectNameError flags exactly the reserved segments (064)", () => {
    expect(store.projectNameError("admin")).toBe("reserved");
    expect(store.projectNameError("  Admin  ")).toBe("reserved");
    expect(store.projectNameError("LogIn")).toBe("reserved");
    // Near-misses that merely start with a reserved word are fine: their
    // slugs ("admin-ui", "log-in") are not reserved.
    expect(store.projectNameError("Admin UI")).toBeNull();
    expect(store.projectNameError("Log In")).toBeNull();
    expect(store.projectNameError("Pokédex")).toBeNull();
  });

  test("a stored reserved slug heals through the sanitizer (064)", async () => {
    ls().setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify([
        {
          id: "innocent",
          name: "Innocent",
          slug: "admin-2",
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: "legacy-admin",
          name: "Admin",
          slug: "admin",
          createdAt: 2,
          updatedAt: 2,
        },
      ]),
    );

    const specifier = "./projects.ts?reserved-heal";
    const fresh = (await import(specifier)) as ProjectsModule;
    const slugs = fresh.getProjects().map((candidate) => candidate.slug);
    expect(slugs).toContain("admin-2"); // the innocent holder keeps its slug
    expect(slugs).toContain("admin-3"); // the reserved one bumps past it
    expect(slugs).not.toContain("admin");
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  test("setProjectHomeScreenId sets, clears and re-stamps (065 decision 5)", () => {
    const project = store.createProject("Home test") as Project;
    const homeEntry = createEntry("home screen", makeSpec("home"));
    const otherEntry = createEntry("other screen", makeSpec("other"));
    addEntry(homeEntry);
    addEntry(otherEntry);
    const home = homeEntry.id;
    const other = otherEntry.id;

    // Set: home travels, updatedAt moves (the projects sync compares LWW).
    expect(store.setProjectHomeScreenId(project.id, home)).toBe(true);
    const set = store.getProjects().find((c) => c.id === project.id);
    expect(set?.homeScreenId).toBe(home);
    expect(set?.updatedAt).toBeGreaterThanOrEqual(project.updatedAt);

    // Unchanged value → no-op, no extra stamp.
    expect(store.setProjectHomeScreenId(project.id, home)).toBe(false);

    // Switch + clear are explicit choices — never derived from members.
    expect(store.setProjectHomeScreenId(project.id, other)).toBe(true);
    expect(
      store.getProjects().find((c) => c.id === project.id)?.homeScreenId,
    ).toBe(other);
    expect(store.setProjectHomeScreenId(project.id, null)).toBe(true);
    // In-session the cleared value is an explicit null (a reload normalizes
    // it to absent) — both read as empty through `?? null` (decision 13).
    expect(
      store.getProjects().find((c) => c.id === project.id)?.homeScreenId ??
        null,
    ).toBeNull();

    // Unknown project is a no-op (false, nothing thrown).
    expect(store.setProjectHomeScreenId("nope", home)).toBe(false);
  });

  test("sanitizer keeps a valid home and drops junk (065)", async () => {
    ls().setItem(
      PROJECT_STORAGE_KEY,
      JSON.stringify([
        {
          id: "with-home",
          name: "With home",
          createdAt: 1,
          updatedAt: 1,
          homeScreenId: "screen-9",
        },
        {
          id: "junk-home",
          name: "Junk home",
          createdAt: 2,
          updatedAt: 2,
          homeScreenId: 42,
        },
        {
          id: "null-home",
          name: "Null home",
          createdAt: 3,
          updatedAt: 3,
          homeScreenId: null,
        },
      ]),
    );
    const specifier = "./projects.ts?home-sanitize";
    const fresh = (await import(specifier)) as ProjectsModule;
    const byId = new Map(
      fresh.getProjects().map((candidate) => [candidate.id, candidate]),
    );
    expect(byId.get("with-home")?.homeScreenId).toBe("screen-9");
    expect(byId.get("junk-home")?.homeScreenId).toBeUndefined();
    expect(byId.get("null-home")?.homeScreenId).toBeUndefined();
  });
});
