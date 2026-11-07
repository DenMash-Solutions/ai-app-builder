import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Spec } from "@json-render/core";
import {
  addEntry,
  createEntry,
  getHistory,
  replaceEntrySpec,
} from "@/lib/history";
import {
  ACTIVE_PROJECT_STORAGE_KEY,
  PROJECT_STORAGE_KEY,
  createProject,
  getProjects,
  removeProject,
  setProjectHomeScreenId,
} from "./projects";
import type { Project } from "./projects";
import { MEMBERSHIP_STORAGE_KEY, getServerMemberships } from "./memberships";
import type { ProjectMembership } from "./memberships";

type MembershipsModule = typeof import("./memberships");

let store: MembershipsModule;

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

/**
 * Seed a project through the CANONICAL store — `memberships.ts` reads the
 * canonical `@/lib/projects/projects` instance (static import), so seeding a
 * cache-busted twin would be invisible to its backfill.
 */
function seedProject(name: string): Project {
  const project = createProject(name);
  if (!project) throw new Error(`seedProject(${name}) failed`);
  return project;
}

/** Seed a history entry stamped with a project (the 061/062 pointer). */
function seedEntry(name: string, projectId?: string): string {
  const entry = createEntry(name, makeSpec(name), projectId);
  addEntry(entry);
  return entry.id;
}

function row(
  id: string,
  projectId: string,
  screenId: string,
  extra: Partial<ProjectMembership> = {},
): ProjectMembership {
  return {
    id,
    projectId,
    screenId,
    route: null,
    position: 0,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  };
}

describe("membership store", () => {
  beforeAll(async () => {
    const local = storage();
    local.setItem(MEMBERSHIP_STORAGE_KEY, JSON.stringify([]));
    // Cache-busted: a fresh memberships instance reads the seeded storage
    // (another test file may have imported the module already). It still
    // observes the CANONICAL history/projects stores.
    // Cache-busted specifier via a variable — tsc can't resolve `?query`
    // literals (same pattern as projects.test.ts).
    const specifier = "./memberships.ts?m-memberships";
    store = (await import(specifier)) as MembershipsModule;
  });

  beforeEach(() => {
    // Reset through the stores' own APIs so cache and storage agree. Removing
    // every project also strips `projectId` from history entries
    // (clearProjectFromEntries), so backfill has nothing to seed until a test
    // explicitly creates a project + stamped entry.
    for (const membership of [...store.getMemberships()]) {
      store.removeScreenFromProject(membership.projectId, membership.screenId);
    }
    for (const project of [...getProjects()]) {
      removeProject(project.id);
    }
    ls().removeItem(MEMBERSHIP_STORAGE_KEY);
    ls().removeItem(PROJECT_STORAGE_KEY);
    ls().removeItem(ACTIVE_PROJECT_STORAGE_KEY);
  });

  test("server snapshot is empty (SSR-safe)", () => {
    expect(getServerMemberships()).toEqual([]);
  });

  test("sanitizer drops junk and restores the two uniqueness invariants", async () => {
    const local = storage();
    local.setItem(
      MEMBERSHIP_STORAGE_KEY,
      JSON.stringify([
        row("m-1", "p-1", "s-1", { route: "settings", position: 3 }),
        // Duplicate (project, screen) — dropped entirely.
        row("m-2", "p-1", "s-1"),
        // Duplicate (project, route) — membership kept, route cleared.
        row("m-3", "p-1", "s-2", { route: "/settings/" }),
        // Another project may hold the same route freely.
        row("m-4", "p-2", "s-3", { route: "settings" }),
        // Junk: missing screenId, non-object, negative position, string pos.
        { id: "m-5", projectId: "p-1", createdAt: 1 },
        "not-a-row",
        row("m-6", "p-1", "s-4", { position: -7 }),
        row("m-7", "p-1", "s-5", { position: 2.7 }),
      ]),
    );
    const specifier = "./memberships.ts?sanitizer";
    const fresh = (await import(specifier)) as MembershipsModule;
    // Scoped to the synthetic project ids — backfill can only add rows for
    // real (uuid) projects, so p-1/p-2 rows are exactly what was seeded.
    const rows = fresh
      .getMemberships()
      .filter((r) => r.projectId === "p-1" || r.projectId === "p-2");
    expect(rows.map((r) => r.id)).toEqual(["m-1", "m-3", "m-4", "m-6", "m-7"]);
    expect(rows[0].route).toBe("settings");
    expect(rows[1].route).toBeNull(); // colliding route cleared, not dropped
    expect(rows[2].route).toBe("settings"); // other project unaffected
    expect(rows[3].position).toBe(0); // clamped
    expect(rows[4].position).toBe(2); // truncated
  });

  test("backfill turns projectId pointers into memberships, skipping dangling ids", async () => {
    const project = seedProject("Backfill");
    const a = seedEntry("screen-a", project.id);
    const b = seedEntry("screen-b", project.id);
    seedEntry("loose"); // no project at all
    seedEntry("dangling", "proj-does-not-exist");

    const specifier = "./memberships.ts?backfill";
    const fresh = (await import(specifier)) as MembershipsModule;
    expect(fresh.getMembership(project.id, a)).not.toBeNull();
    expect(fresh.getMembership(project.id, b)).not.toBeNull();
    // Positions append deterministically in entry order.
    const members = fresh.getProjectMemberships(project.id);
    expect(members.map((m) => m.screenId)).toEqual([a, b]);
    expect(members.map((m) => m.position)).toEqual([0, 1]);
    // Only this project's rows exist — dangling ids and loose entries never
    // gained rows.
    expect(
      fresh.getMemberships().filter((m) => m.projectId === project.id).length,
    ).toBe(2);
    expect(
      fresh.getMemberships().some((m) => m.projectId === "proj-does-not-exist"),
    ).toBe(false);
  });

  test("backfill is idempotent and preserves explicit ordering", async () => {
    const project = seedProject("Idempotent");
    const a = seedEntry("a", project.id);
    const b = seedEntry("b", project.id);
    const specifier = "./memberships.ts?idempotent";
    const fresh = (await import(specifier)) as MembershipsModule;
    expect(fresh.getProjectMemberships(project.id).length).toBe(2);
    // Explicitly reorder; then re-read — order (and the stored rows) hold.
    expect(fresh.reorderProjectMembers(project.id, [b])).toBe(true);
    expect(
      fresh.getProjectMemberships(project.id).map((m) => m.screenId),
    ).toEqual([b, a]);
    // Re-reading from the same rows adds nothing (idempotent backfill).
    expect(fresh.getProjectMemberships(project.id).length).toBe(2);
  });

  test("add: appends at the tail, rejects duplicates and route collisions", () => {
    const project = seedProject("Add");
    const other = seedProject("Other");
    const s1 = seedEntry("s1");
    const s2 = seedEntry("s2");
    const s3 = seedEntry("s3");

    const first = store.addScreenToProject(project.id, s1);
    expect(first).not.toBeNull();
    expect(first?.position).toBe(0);

    const second = store.addScreenToProject(project.id, s2, "detail/{id}");
    expect(second?.position).toBe(1);

    // Same (project, screen) again — no-op.
    expect(store.addScreenToProject(project.id, s1)).toBeNull();
    // Same route in the same project — rejected (decision 7).
    expect(store.addScreenToProject(project.id, s3, "detail/{id}")).toBeNull();
    expect(store.getMembership(project.id, s3)).toBeNull();
    // The same route in ANOTHER project is free.
    expect(
      store.addScreenToProject(other.id, s3, "detail/{id}"),
    ).not.toBeNull();
    // Route normalizes to the shared shape.
    const s4 = seedEntry("s4");
    expect(store.addScreenToProject(project.id, s4, "/settings/")?.route).toBe(
      "settings",
    );
  });

  test("remove: membership only — the screen survives elsewhere", () => {
    const p1 = seedProject("P1");
    const p2 = seedProject("P2");
    const screen = seedEntry("shared");
    store.addScreenToProject(p1.id, screen);
    store.addScreenToProject(p2.id, screen);

    expect(store.removeScreenFromProject(p1.id, screen)).toBe(true);
    expect(store.getMembership(p1.id, screen)).toBeNull();
    expect(store.getMembership(p2.id, screen)).not.toBeNull();
    // The history entry itself is untouched.
    expect(getHistory().some((e) => e.id === screen)).toBe(true);
    // Unknown pair — no-op.
    expect(store.removeScreenFromProject(p1.id, screen)).toBe(false);
  });

  test("setMembershipRoute: collision rejection, clear, unchanged no-op", () => {
    const project = seedProject("Routes");
    const s1 = seedEntry("s1");
    const s2 = seedEntry("s2");
    store.addScreenToProject(project.id, s1, "first");
    store.addScreenToProject(project.id, s2);

    // s2 can take a free route.
    expect(store.setMembershipRoute(project.id, s2, "second/{id}")).toBe(true);
    // s2 cannot take s1's route.
    expect(store.setMembershipRoute(project.id, s2, "first")).toBe(false);
    expect(store.getMembership(project.id, s2)?.route).toBe("second/{id}");
    // Clearing frees the route for reassignment.
    expect(store.setMembershipRoute(project.id, s1, null)).toBe(true);
    expect(store.setMembershipRoute(project.id, s2, "first")).toBe(true);
    // Unchanged value — nothing written.
    expect(store.setMembershipRoute(project.id, s2, "first")).toBe(false);
    // Non-member pair.
    const stranger = seedEntry("stranger");
    expect(store.setMembershipRoute(project.id, stranger, "x")).toBe(false);
  });

  test("reorder: dense positions, unlisted keep relative order, unknown ignored", () => {
    const project = seedProject("Order");
    const a = seedEntry("a");
    const b = seedEntry("b");
    const c = seedEntry("c");
    store.addScreenToProject(project.id, a);
    store.addScreenToProject(project.id, b);
    store.addScreenToProject(project.id, c);

    // c first; a and b keep their relative order after it; unknown ignored.
    expect(store.reorderProjectMembers(project.id, [c, "not-a-member"])).toBe(
      true,
    );
    expect(
      store.getProjectMemberships(project.id).map((m) => m.screenId),
    ).toEqual([c, a, b]);
    expect(
      store.getProjectMemberships(project.id).map((m) => m.position),
    ).toEqual([0, 1, 2]);
    // Same order again — no-op.
    expect(store.reorderProjectMembers(project.id, [c, a, b])).toBe(false);
    // Empty project — no-op.
    expect(store.reorderProjectMembers("nope", [a])).toBe(false);
  });

  test("membership writes notify subscribers", () => {
    const project = seedProject("Notify");
    const screen = seedEntry("screen");
    let calls = 0;
    const unsubscribe = store.subscribeMemberships(() => {
      calls += 1;
    });
    store.addScreenToProject(project.id, screen);
    expect(calls).toBe(1);
    store.setMembershipRoute(project.id, screen, "r");
    expect(calls).toBe(2);
    store.removeScreenFromProject(project.id, screen);
    expect(calls).toBe(3);
    unsubscribe();
    store.addScreenToProject(project.id, screen);
    expect(calls).toBe(3);
  });

  test("remove clears the device-local pointer so reload never resurrects the membership", async () => {
    const project = seedProject("Pointer");
    const screen = seedEntry("pointer-screen", project.id);

    const first = "./memberships.ts?remove-reload-1";
    const storeA = (await import(first)) as MembershipsModule;
    expect(storeA.getMembership(project.id, screen)).not.toBeNull();

    expect(storeA.removeScreenFromProject(project.id, screen)).toBe(true);
    // Decision 12: the pointer goes with the row.
    expect(
      getHistory().find((entry) => entry.id === screen)?.projectId,
    ).toBeUndefined();

    // A fresh load (reload) backfills nothing — the membership stays gone.
    const second = "./memberships.ts?remove-reload-2";
    const storeB = (await import(second)) as MembershipsModule;
    expect(storeB.getMembership(project.id, screen)).toBeNull();
  });

  test("deleting the project drops its memberships and keeps the screens (073)", async () => {
    const project = seedProject("Doomed");
    const kept = seedProject("Kept");
    const screen = seedEntry("doomed-screen", project.id);
    const other = seedEntry("kept-screen", kept.id);
    store.addScreenToProject(project.id, screen);
    store.addScreenToProject(kept.id, other);

    removeProject(project.id);
    // The cleanup hop is lazy (memberships already imports the projects
    // store); one microtask is enough for it to land.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const stored = JSON.parse(
      ls().getItem(MEMBERSHIP_STORAGE_KEY) ?? "[]",
    ) as ProjectMembership[];
    expect(stored.some((row) => row.projectId === project.id)).toBe(false);
    // Another project's rows are untouched, and the screens survive.
    expect(stored.some((row) => row.projectId === kept.id)).toBe(true);
    expect(getHistory().some((entry) => entry.id === screen)).toBe(true);
    expect(getProjects().some((row) => row.id === kept.id)).toBe(true);
  });

  test("copy: new screen at revision 0 in the destination; source untouched", () => {
    const from = seedProject("CopyFrom");
    const to = seedProject("CopyTo");
    const screen = seedEntry("copy-me", from.id);
    // Explicit add: the shared instance's cache already loaded in beforeEach
    // (backfill only runs on first load), and the guards test membership —
    // not how the row got there.
    store.addScreenToProject(from.id, screen);
    expect(store.getMembership(from.id, screen)).not.toBeNull();
    // Give the source real revision history — the copy must not inherit it.
    replaceEntrySpec(screen, makeSpec("second revision"), "prompt");
    const source = getHistory().find((entry) => entry.id === screen);
    expect(source?.revisions.length).toBe(2);
    if (!source) throw new Error("seeded source entry missing");

    const copy = store.copyScreenToProject(from.id, to.id, screen);
    expect(copy).not.toBeNull();
    if (!copy) throw new Error("copyScreenToProject returned null");
    expect(copy.id).not.toBe(screen);
    expect(copy.slug).not.toBe(source.slug);
    // Decision 3: revision 0 — a single fresh revision, current spec only.
    expect(copy.revisions).toHaveLength(1);
    expect(copy.head).toBe(0);
    expect(copy.spec).toEqual(source.spec);
    expect(copy.projectId).toBe(to.id);
    // Destination membership (route-less), source membership intact.
    expect(store.getMembership(to.id, copy.id)?.route).toBeNull();
    expect(store.getMembership(from.id, screen)).not.toBeNull();
    expect(getHistory().some((entry) => entry.id === screen)).toBe(true);

    // Guards: same project / non-member source are no-ops.
    expect(store.copyScreenToProject(from.id, from.id, screen)).toBeNull();
    expect(store.copyScreenToProject(from.id, to.id, "nope")).toBeNull();
  });

  test("move: identity and revisions preserved, pointer re-stamped, no resurrection", async () => {
    const from = seedProject("MoveFrom");
    const to = seedProject("MoveTo");
    const screen = seedEntry("mover", from.id);
    replaceEntrySpec(screen, makeSpec("v2"), "prompt");
    expect(
      getHistory().find((entry) => entry.id === screen)?.revisions.length,
    ).toBe(2);

    const first = "./memberships.ts?move-reload-1";
    const storeA = (await import(first)) as MembershipsModule;
    expect(storeA.getMembership(from.id, screen)).not.toBeNull();

    expect(storeA.moveScreenBetweenProjects(from.id, to.id, screen)).toBe(true);
    expect(storeA.getMembership(from.id, screen)).toBeNull();
    expect(storeA.getMembership(to.id, screen)).not.toBeNull();
    // Same entry: id and revision stack preserved; pointer re-stamped.
    const moved = getHistory().find((entry) => entry.id === screen);
    expect(moved?.revisions.length).toBe(2);
    expect(moved?.projectId).toBe(to.id);

    // Reload: the source membership stays gone (no backfill resurrection).
    const second = "./memberships.ts?move-reload-2";
    const storeB = (await import(second)) as MembershipsModule;
    expect(storeB.getMembership(from.id, screen)).toBeNull();
    expect(storeB.getMembership(to.id, screen)).not.toBeNull();

    // Guards: no longer a source member / same project / unknown pair /
    // already a member of the destination.
    expect(storeA.moveScreenBetweenProjects(from.id, to.id, screen)).toBe(
      false,
    );
    expect(storeA.moveScreenBetweenProjects(from.id, from.id, screen)).toBe(
      false,
    );
    expect(storeA.moveScreenBetweenProjects(from.id, to.id, "nope")).toBe(
      false,
    );
    const both = seedEntry("both-ways");
    storeA.addScreenToProject(from.id, both);
    storeA.addScreenToProject(to.id, both);
    expect(storeA.moveScreenBetweenProjects(from.id, to.id, both)).toBe(false);
  });

  test("applyRemoteMembership: same-id replace, pair twins re-keyed by LWW, route collision clears", () => {
    const project = seedProject("Adopt");
    const s1 = seedEntry("s1");
    const s2 = seedEntry("s2");
    const s3 = seedEntry("s3");
    store.addScreenToProject(project.id, s1, "local-route");
    const localTwin = store.addScreenToProject(project.id, s2);
    store.addScreenToProject(project.id, s3, "settings");
    expect(localTwin).not.toBeNull();

    // 1. Same id: straight replace (the loop already decided LWW).
    const sameId = store.getMembership(project.id, s1);
    expect(sameId).not.toBeNull();
    store.applyRemoteMembership({
      ...(sameId as ProjectMembership),
      route: "remote-route",
      position: 5,
      updatedAt: Date.now() + 10000,
    });
    expect(store.getMembership(project.id, s1)?.route).toBe("remote-route");
    expect(store.getMembership(project.id, s1)?.position).toBe(5);

    // 2. Older remote twin: local content wins but takes the remote's DB id
    //    (decision 11) — one row per pair, local position preserved.
    store.applyRemoteMembership({
      id: "remote-twin-uuid",
      projectId: project.id,
      screenId: s2,
      route: null,
      position: 99,
      createdAt: 1,
      updatedAt: 1,
    });
    const rekeyed = store.getMembership(project.id, s2);
    expect(rekeyed?.id).toBe("remote-twin-uuid");
    expect(rekeyed?.position).toBe(localTwin?.position);
    expect(
      store.getMemberships().filter((row) => row.screenId === s2),
    ).toHaveLength(1);

    // 3. Newer remote twin wins outright.
    store.applyRemoteMembership({
      id: "remote-newer",
      projectId: project.id,
      screenId: s2,
      route: null,
      position: 42,
      createdAt: 1,
      updatedAt: Date.now() + 10000,
    });
    const adopted = store.getMembership(project.id, s2);
    expect(adopted?.id).toBe("remote-newer");
    expect(adopted?.position).toBe(42);
    expect(
      store.getMemberships().filter((row) => row.screenId === s2),
    ).toHaveLength(1);

    // 4. Route collision with ANOTHER pair: the adopted route is DB truth —
    //    the local holder clears (membership kept), never drops (d9).
    expect(store.getMembership(project.id, s3)?.route).toBe("settings");
    store.applyRemoteMembership({
      id: "remote-route-owner",
      projectId: project.id,
      screenId: "other-screen",
      route: "settings",
      position: 0,
      createdAt: 1,
      updatedAt: Date.now() + 10000,
    });
    const cleared = store.getMembership(project.id, s3);
    expect(cleared?.route).toBeNull();
    expect(cleared).not.toBeNull();
  });

  test("adopting a membership stamps a pointer-less entry (remote alignment)", () => {
    const project = seedProject("Align-adopt");
    const screenId = seedEntry("align-adopt-screen");
    // The adopted `uis` copy carries no project column — a device that did
    // not create the screen starts with no pointer at all (061/064).
    expect(
      getHistory().find((entry) => entry.id === screenId)?.projectId,
    ).toBeUndefined();

    store.applyRemoteMembership({
      id: "remote-align-adopt",
      projectId: project.id,
      screenId,
      route: null,
      position: 0,
      createdAt: 1,
      updatedAt: Date.now() + 10000,
    });

    // Without the stamp the membership groups nothing on THIS device:
    // screensInScope and the catalog picker's install scoping both read
    // entry.projectId (plan 066 task 5's cross-device failure).
    expect(getHistory().find((entry) => entry.id === screenId)?.projectId).toBe(
      project.id,
    );
  });

  test("alignment never rewrites an existing born-into pointer (d12)", () => {
    const bornInto = seedProject("Align-born");
    const later = seedProject("Align-later");
    const screenId = seedEntry("align-owned-screen", bornInto.id);

    store.applyRemoteMembership({
      id: "remote-align-later",
      projectId: later.id,
      screenId,
      route: null,
      position: 0,
      createdAt: 1,
      updatedAt: Date.now() + 10000,
    });

    // A later claim (a screen added to a second project) must not move the
    // pointer — born-into history is never rewritten (decision 12).
    expect(getHistory().find((entry) => entry.id === screenId)?.projectId).toBe(
      bornInto.id,
    );
  });

  test("a membership that lands BEFORE its entry claims it on arrival", () => {
    const project = seedProject("Align-early");
    // Fixed id so the row can name an entry that does not exist YET — the
    // `project_screens` loop may pull before the `uis` loop adopts.
    const screenId = "11111111-2222-4333-8444-555555555599";
    store.getMemberships(); // load + subscribe the heal pass
    store.applyRemoteMembership({
      id: "remote-align-early",
      projectId: project.id,
      screenId,
      route: null,
      position: 0,
      createdAt: 1,
      updatedAt: Date.now() + 10000,
    });
    expect(getHistory().some((entry) => entry.id === screenId)).toBe(false);

    // The entry arrives later (the `uis` loop's adoption commits history,
    // which is the hook the heal pass listens to).
    const arriving = createEntry("align-early-screen", makeSpec("early"));
    addEntry({ ...arriving, id: screenId });

    expect(getHistory().find((entry) => entry.id === screenId)?.projectId).toBe(
      project.id,
    );
  });

  test("reconcileProjectRoutes: re-keys pair twins, clears owned routes, leaves the rest", () => {
    const project = seedProject("Reconcile");
    const s1 = seedEntry("r1");
    const s2 = seedEntry("r2");
    const s3 = seedEntry("r3");
    const localPair = store.addScreenToProject(project.id, s1);
    const routeHolder = store.addScreenToProject(project.id, s2, "detail/{id}");
    const untouched = store.addScreenToProject(project.id, s3);
    expect(localPair).not.toBeNull();
    expect(routeHolder).not.toBeNull();
    expect(untouched).not.toBeNull();

    store.reconcileProjectRoutes([
      // Remote twin of s1's pair, different id → local re-keyed onto it.
      {
        id: "remote-pair",
        project_id: project.id,
        screen_id: s1,
        route: null,
      },
      // Remote owner of "detail/{id}" on ANOTHER pair → ours clears (d9).
      {
        id: "remote-route",
        project_id: project.id,
        screen_id: "elsewhere",
        route: "detail/{id}",
      },
      // Our own row echoing back must never trigger anything.
      {
        id: untouched?.id ?? "missing",
        project_id: project.id,
        screen_id: s3,
        route: null,
      },
    ]);

    const rekeyed = store.getMembership(project.id, s1);
    expect(rekeyed?.id).toBe("remote-pair");
    expect(rekeyed?.position).toBe(localPair?.position); // content preserved
    const cleared = store.getMembership(project.id, s2);
    expect(cleared?.route).toBeNull();
    expect(cleared?.updatedAt).toBeGreaterThanOrEqual(
      routeHolder?.updatedAt ?? Infinity,
    );
    expect(store.getMembership(project.id, s3)).toEqual(untouched);
    // Never a duplicate id after re-keying.
    const ids = store.getMemberships().map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("first membership seeds the home; later adds never reassign it", () => {
    const project = seedProject("Home seed");
    const first = seedEntry("first-screen");
    const second = seedEntry("second-screen");
    const homeOf = (): string | null | undefined =>
      getProjects().find((candidate) => candidate.id === project.id)
        ?.homeScreenId;

    // Decision 13: the first add fills the empty home…
    expect(store.addScreenToProject(project.id, first)).not.toBeNull();
    expect(homeOf()).toBe(first);
    // …and a later add is NOT a reassignment (decision 5).
    expect(store.addScreenToProject(project.id, second)).not.toBeNull();
    expect(homeOf()).toBe(first);

    // An explicit pick is respected — adds keep hands off it.
    expect(setProjectHomeScreenId(project.id, second)).toBe(true);
    expect(
      store.addScreenToProject(project.id, seedEntry("third")),
    ).not.toBeNull();
    expect(homeOf()).toBe(second);
  });

  test("removing the home clears it; removing another member keeps it", () => {
    const project = seedProject("Home clear");
    const home = seedEntry("home-screen");
    const other = seedEntry("other-screen");
    store.addScreenToProject(project.id, home);
    store.addScreenToProject(project.id, other);
    const homeOf = (): string | null | undefined =>
      getProjects().find((candidate) => candidate.id === project.id)
        ?.homeScreenId;
    expect(homeOf()).toBe(home);

    // Removing a NON-home member leaves the front door alone.
    expect(store.removeScreenFromProject(project.id, other)).toBe(true);
    expect(homeOf()).toBe(home);

    // Removing the home clears (never reassigns to the survivor) —
    // decision 5's "leaves the root entry point empty". In-session the
    // value is an explicit null; a reload normalizes it to absent — both
    // read as empty through the `?? null` discipline.
    expect(store.removeScreenFromProject(project.id, home)).toBe(true);
    expect(homeOf() ?? null).toBeNull();
  });

  test("backfill seeds home only for a FIRST-TIME membership set (d13)", async () => {
    const project = seedProject("Backfill home");
    const screen = seedEntry("backfilled-screen", project.id);
    ls().removeItem(MEMBERSHIP_STORAGE_KEY); // fresh device / first read

    // A fresh instance runs the backfill: the project's membership set is
    // created NOW and its home is empty → seeded with the oldest member.
    const firstSpecifier = "./memberships.ts?home-backfill-1";
    const first = (await import(firstSpecifier)) as MembershipsModule;
    expect(first.getMembership(project.id, screen)).not.toBeNull();
    expect(
      getProjects().find((candidate) => candidate.id === project.id)
        ?.homeScreenId,
    ).toBe(screen);

    // A deliberately cleared home stays cleared across reloads — the rows
    // already exist, so the backfill's first-time condition never fires.
    expect(setProjectHomeScreenId(project.id, null)).toBe(true);
    const secondSpecifier = "./memberships.ts?home-backfill-2";
    const second = (await import(secondSpecifier)) as MembershipsModule;
    second.getMembership(project.id, screen); // trigger its first read
    expect(
      getProjects().find((candidate) => candidate.id === project.id)
        ?.homeScreenId ?? null,
    ).toBeNull(); // still cleared — the backfill never resurrects it
  });

  test("in-session healing: entries created after first load gain rows (065 task 4)", () => {
    const project = seedProject("Heal");
    // The shared instance's first load already happened (beforeEach) — a
    // screen created NOW must not wait for a reload to become a member,
    // or the membership-driven drawer would strand it in the legacy bucket.
    const screen = seedEntry("created-late", project.id);
    expect(store.getMembership(project.id, screen)).not.toBeNull();
    expect(
      store
        .getMemberships()
        .filter(
          (row) => row.projectId === project.id && row.screenId === screen,
        ),
    ).toHaveLength(1); // idempotent — one commit per row, no duplicates

    // The first-time membership set seeds the home too (decision 13) —
    // the healing runs the same `backfillFromEntries` pass as first load.
    expect(
      getProjects().find((candidate) => candidate.id === project.id)
        ?.homeScreenId,
    ).toBe(screen);

    // The healed row drives ordering like any other (position appended).
    expect(
      store.getProjectMemberships(project.id).map((m) => m.screenId),
    ).toEqual([screen]);

    // Pointer-only entries (no project) and entries of unknown projects
    // never gain rows from the healing pass.
    const loose = seedEntry("still-loose");
    expect(store.getMembership(project.id, loose)).toBeNull();
  });
});
