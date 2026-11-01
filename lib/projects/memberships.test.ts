import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Spec } from "@json-render/core";
import { addEntry, createEntry, getHistory } from "@/lib/history";
import {
  ACTIVE_PROJECT_STORAGE_KEY,
  PROJECT_STORAGE_KEY,
  createProject,
  getProjects,
  removeProject,
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
});
