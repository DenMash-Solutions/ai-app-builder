import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Spec } from "@json-render/core";
import { createEntry } from "@/lib/history";
import type { HistoryEntry } from "@/lib/history";
import type { ProjectMembership } from "@/lib/projects/memberships";
import type { Project } from "@/lib/projects/projects";
import type { PublishClient } from "@/lib/publish/publish";
import {
  buildProjectEntryPoints,
  getProjectPublishState,
  getProjectPublishStates,
  getPublishedEntryPointsFrom,
  PROJECT_PUBLISH_STATUS,
  publishProject,
  unpublishProject,
} from "./project-publish";
import { PROJECT_PUBLISH_ISSUES } from "./validate-project";

function makeSpec(heading: string): Spec {
  return {
    root: "root",
    elements: { root: { type: "Card", props: { title: heading } } },
  };
}

function entry(id: string, slug: string, heading = id): HistoryEntry {
  const base = createEntry(`screen ${id}`, makeSpec(heading));
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

interface Op {
  table: string;
  op: "select" | "upsert" | "update" | "delete";
  columns?: string;
  filters: Array<[string, unknown]>;
  payload?: unknown;
  options?: unknown;
}

interface FakeState {
  /** Every statement the code under test issued, in resolution order. */
  ops: Op[];
  /** Rows behind `published_entry_points` (the version read). */
  entryRows: Array<Record<string, unknown>>;
  /** Rows behind `projects` (the publish-state read). */
  projectRows: Array<Record<string, unknown>>;
  /** Fail the first matching statement (simulates a DB/trigger error). */
  fail: { table: string; op: string; message: string } | null;
}

function makeClient(state: FakeState): PublishClient {
  type Resolved = { data: unknown; error: { message: string } | null };

  const failure = (table: string, op: string): { message: string } | null => {
    const fail = state.fail;
    if (fail && fail.table === table && fail.op === op) {
      state.fail = null; // only the matching statement fails
      return { message: fail.message };
    }
    return null;
  };

  function writeBuilder(
    table: string,
    op: Op["op"],
    filters: Array<[string, unknown]>,
    payload?: unknown,
    options?: unknown,
  ): Record<string, unknown> {
    const b: Record<string, unknown> = {};
    b.eq = (column: string, value: string | number | boolean) => {
      filters.push([column, value]);
      return b;
    };
    b.in = (column: string, values: string[]) => {
      filters.push([column, values]);
      return b;
    };
    b.then = (onOk: unknown, onErr: unknown) => {
      state.ops.push({ table, op, filters: [...filters], payload, options });
      const error = failure(table, op);
      const resolved: Resolved = { data: null, error };
      return Promise.resolve(resolved).then(onOk as never, onErr as never);
    };
    return b;
  }

  function selectBuilder(
    table: string,
    columns: string,
  ): Record<string, unknown> {
    const filters: Array<[string, unknown]> = [];
    const data: unknown =
      table === "projects" ? state.projectRows : state.entryRows;
    const resolve = (): Resolved => {
      state.ops.push({ table, op: "select", columns, filters: [...filters] });
      const error = failure(table, "select");
      return { data: error ? null : data, error };
    };
    const b: Record<string, unknown> = {};
    b.eq = (column: string, value: string | number | boolean) => {
      filters.push([column, value]);
      return b;
    };
    b.in = (column: string, values: string[]) => {
      filters.push([column, values]);
      return b;
    };
    b.order = () => b;
    b.limit = () => b;
    b.maybeSingle = async () => resolve();
    b.then = (onOk: unknown, onErr: unknown) =>
      Promise.resolve(resolve()).then(onOk as never, onErr as never);
    return b;
  }

  function from(table: string): ReturnType<PublishClient["from"]> {
    const api = {
      select: (columns: string) => selectBuilder(table, columns),
      insert: () => {
        throw new Error(`unexpected insert on ${table}`);
      },
      upsert: (
        values: Record<string, unknown> | Record<string, unknown>[],
        options?: { onConflict?: string },
      ) => writeBuilder(table, "upsert", [], values, options),
      update: (values: Record<string, unknown>) =>
        writeBuilder(table, "update", [], values),
      delete: () => ({
        eq: (column: string, value: string) =>
          writeBuilder(table, "delete", [[column, value]]),
      }),
    };
    return api as unknown as ReturnType<PublishClient["from"]>;
  }

  return {
    from,
    rpc: () => {
      throw new Error("project-publish must not call route_available");
    },
  };
}

let state: FakeState;

/** revalidateProjection's browser hop — recorded, never actually fetched. */
let fetched: Array<{ url: string; body: string }>;
const globals = globalThis as { window?: unknown; fetch?: unknown };
const originalWindow = globals.window;
const originalFetch = globals.fetch;

beforeEach(() => {
  state = { ops: [], entryRows: [], projectRows: [], fail: null };
  fetched = [];
  globals.window = {};
  globals.fetch = (url: unknown, init: { body: string }) => {
    fetched.push({ url: String(url), body: init.body });
    return Promise.resolve({ ok: true });
  };
});

afterEach(() => {
  globals.window = originalWindow;
  globals.fetch = originalFetch;
});

function opNames(): string[] {
  return state.ops.map((op) => `${op.table}:${op.op}`);
}

function opFilters(op: Op, column: string): unknown {
  return op.filters.find(([key]) => key === column)?.[1];
}

describe("buildProjectEntryPoints", () => {
  test("publishes slug rungs, configured patterns and the home rung — never an id", () => {
    const project = makeProject({ homeScreenId: "s-home" });
    const entries = [
      entry("s-home", "home"),
      entry("s-alpha", "alpha"),
      entry("s-beta", "beta"),
    ];
    const memberships = [
      member("m-home", "s-home", null, 0),
      member("m-alpha", "s-alpha", "items/{id}", 1),
      member("m-beta", "s-beta", null, 2),
    ];

    const rows = buildProjectEntryPoints(project, entries, memberships);

    expect(rows.map((row) => row.route).sort()).toEqual([
      "",
      "alpha",
      "beta",
      "home",
      "items/{id}",
    ]);
    // The id rung is preview-only: no uuid leaks into the live namespace.
    expect(rows.some((row) => row.route.startsWith("s-"))).toBe(false);
    expect(rows.find((row) => row.route === "")?.screenId).toBe("s-home");
  });

  test("snapshots the head revision, not the original spec", () => {
    const project = makeProject({ homeScreenId: "s-home" });
    const home: HistoryEntry = {
      ...entry("s-home", "home", "v0"),
      revisions: [
        { spec: makeSpec("v0"), label: "r0", createdAt: 1 },
        { spec: makeSpec("v1"), label: "r1", createdAt: 2 },
      ],
      head: 1,
    };

    const rows = buildProjectEntryPoints(
      project,
      [home],
      [member("m-home", "s-home", null, 0)],
    );

    expect(rows.find((row) => row.route === "")?.spec).toEqual(makeSpec("v1"));
  });

  test("a route claimed twice keeps the earlier position", () => {
    const project = makeProject();
    const entries = [entry("s-a", "alpha"), entry("s-b", "beta")];
    const memberships = [
      member("m-a", "s-a", null, 0),
      // `beta` configures the exact value `alpha`'s slug already owns.
      member("m-b", "s-b", "alpha", 1),
    ];

    const rows = buildProjectEntryPoints(project, entries, memberships);

    expect(rows.find((row) => row.route === "alpha")?.screenId).toBe("s-a");
  });

  test("skips memberships of other projects and entries that no longer exist", () => {
    const project = makeProject({ homeScreenId: "s-home" });
    const entries = [entry("s-home", "home")];
    const memberships = [
      member("m-home", "s-home", null, 0),
      member("m-ghost", "s-deleted", null, 1),
      member("m-foreign", "s-other", null, 2, "proj-2"),
    ];

    const rows = buildProjectEntryPoints(project, entries, memberships);

    expect(rows.map((row) => row.route)).toEqual(["home", ""]);
  });

  test("no home screen means no home rung", () => {
    const project = makeProject({ homeScreenId: null });
    const entries = [entry("s-a", "alpha")];

    const rows = buildProjectEntryPoints(project, entries, [
      member("m-a", "s-a", null, 0),
    ]);

    expect(rows.map((row) => row.route)).toEqual(["alpha"]);
  });
});

describe("getProjectPublishStates", () => {
  test("reads explicit columns — never SELECT *", async () => {
    const result = await getProjectPublishStates(makeClient(state), ["p1"]);

    expect(result).toEqual({});
    expect(state.ops).toHaveLength(1);
    expect(state.ops[0].columns).toBe("id, status, handle, published_at");
    expect(opFilters(state.ops[0], "id")).toEqual(["p1"]);
  });

  test("maps rows by id and skips ids without a row", async () => {
    state.projectRows = [
      {
        id: "p1",
        status: PROJECT_PUBLISH_STATUS.published,
        handle: "dex",
        published_at: "2026-11-04T00:00:00.000Z",
      },
      { id: "p2", status: PROJECT_PUBLISH_STATUS.draft, handle: null },
    ];

    const result = await getProjectPublishStates(makeClient(state), [
      "p1",
      "p2",
      "p3",
    ]);

    expect(Object.keys(result).sort()).toEqual(["p1", "p2"]);
    expect(result.p1).toEqual({
      status: PROJECT_PUBLISH_STATUS.published,
      handle: "dex",
      publishedAt: "2026-11-04T00:00:00.000Z",
    });
    expect(result.p2).toEqual({
      status: PROJECT_PUBLISH_STATUS.draft,
      handle: null,
      publishedAt: null,
    });
  });

  test("an unreadable status answers draft — the badge never guesses live", async () => {
    state.projectRows = [{ id: "p1", status: "something-else", handle: "dex" }];

    const result = await getProjectPublishStates(makeClient(state), ["p1"]);

    expect(result.p1?.status).toBe(PROJECT_PUBLISH_STATUS.draft);
  });

  test("an error answers {} and an empty id list asks nothing", async () => {
    state.fail = {
      table: "projects",
      op: "select",
      message: "permission denied",
    };

    expect(await getProjectPublishStates(makeClient(state), ["p1"])).toEqual(
      {},
    );

    const fresh: FakeState = {
      ops: [],
      entryRows: [],
      projectRows: [],
      fail: null,
    };
    expect(await getProjectPublishStates(makeClient(fresh), [])).toEqual({});
    expect(fresh.ops).toHaveLength(0);
  });

  test("getProjectPublishState returns null when the read fails", async () => {
    state.fail = {
      table: "projects",
      op: "select",
      message: "permission denied",
    };

    expect(await getProjectPublishState(makeClient(state), "p1")).toBeNull();
  });
});

describe("publishProject (decision 15: entry points before the status flip)", () => {
  const project = makeProject({ homeScreenId: "s-home" });
  const entries = [entry("s-home", "home"), entry("s-a", "alpha")];
  const memberships = [
    member("m-home", "s-home", null, 0),
    member("m-a", "s-a", null, 1),
  ];

  test("upserts the snapshot, then claims the handle and flips status", async () => {
    const result = await publishProject(
      makeClient(state),
      "owner-1",
      project,
      entries,
      memberships,
      "dex",
    );

    expect(result.ok).toBe(true);
    expect(opNames()).toEqual([
      "published_entry_points:select",
      "published_entry_points:upsert",
      "projects:update",
    ]);

    const upsert = state.ops[1];
    expect(upsert.options).toEqual({ onConflict: "project_id,route" });
    expect(upsert.payload).toEqual([
      {
        project_id: "proj-1",
        route: "home",
        owner_id: "owner-1",
        screen_id: "s-home",
        spec: makeSpec("s-home"),
        version: 1,
        artifacts: null,
        published_at: expect.any(String),
      },
      {
        project_id: "proj-1",
        route: "alpha",
        owner_id: "owner-1",
        screen_id: "s-a",
        spec: makeSpec("s-a"),
        version: 1,
        artifacts: null,
        published_at: expect.any(String),
      },
      {
        project_id: "proj-1",
        route: "",
        owner_id: "owner-1",
        screen_id: "s-home",
        spec: makeSpec("s-home"),
        version: 1,
        artifacts: null,
        published_at: expect.any(String),
      },
    ]);

    const update = state.ops[2];
    expect(update.payload).toEqual({
      handle: "dex",
      status: PROJECT_PUBLISH_STATUS.published,
      published_at: expect.any(String),
    });
    expect(opFilters(update, "id")).toBe("proj-1");
    expect(update.filters[0][0]).toBe("id");
  });

  test("bumps each route's own version counter", async () => {
    state.entryRows = [
      { route: "home", version: 3 },
      { route: "alpha", version: 7 },
    ];

    await publishProject(
      makeClient(state),
      "owner-1",
      project,
      entries,
      memberships,
      "dex",
    );

    const payload = state.ops[1].payload as Array<{
      route: string;
      version: number;
    }>;
    expect(payload.map((row) => [row.route, row.version])).toEqual([
      ["home", 4],
      ["alpha", 8],
      ["", 1],
    ]);
  });

  test("deletes routes the snapshot dropped, scoped to the project", async () => {
    state.entryRows = [{ route: "removed", version: 2 }];

    await publishProject(
      makeClient(state),
      "owner-1",
      project,
      entries,
      memberships,
      "dex",
    );

    expect(opNames()).toEqual([
      "published_entry_points:select",
      "published_entry_points:upsert",
      "published_entry_points:delete",
      "projects:update",
    ]);
    const del = state.ops[2];
    expect(opFilters(del, "project_id")).toBe("proj-1");
    expect(opFilters(del, "route")).toEqual(["removed"]);
    // The status flip still comes last, after the stale-route delete.
    expect(state.ops[3].table).toBe("projects");
  });

  test("a read failure writes nothing at all", async () => {
    state.fail = {
      table: "published_entry_points",
      op: "select",
      message: "read exploded",
    };

    const result = await publishProject(
      makeClient(state),
      "owner-1",
      project,
      entries,
      memberships,
      "dex",
    );

    expect(result).toEqual({ ok: false, error: "read exploded" });
    expect(state.ops).toHaveLength(1);
    expect(fetched).toHaveLength(0);
  });

  test("an upsert failure stops before the status flip (site stays dark)", async () => {
    state.fail = {
      table: "published_entry_points",
      op: "upsert",
      message: "write exploded",
    };

    const result = await publishProject(
      makeClient(state),
      "owner-1",
      project,
      entries,
      memberships,
      "dex",
    );

    expect(result).toEqual({ ok: false, error: "write exploded" });
    expect(opNames()).toEqual([
      "published_entry_points:select",
      "published_entry_points:upsert",
    ]);
    expect(fetched).toHaveLength(0);
  });

  test("a foreign handle claim answers handleTaken", async () => {
    state.fail = {
      table: "projects",
      op: "update",
      message:
        'duplicate key value violates unique constraint "projects_handle_key"',
    };

    const result = await publishProject(
      makeClient(state),
      "owner-1",
      project,
      entries,
      memberships,
      "dex",
    );

    expect(result.ok).toBe(false);
    expect(result.handleTaken).toBe(true);
    expect(fetched).toHaveLength(0);
  });

  test("the trigger's claim refusal also answers handleTaken", async () => {
    state.fail = {
      table: "projects",
      op: "update",
      message: 'value "dex" is already claimed',
    };

    const result = await publishProject(
      makeClient(state),
      "owner-1",
      project,
      entries,
      memberships,
      "dex",
    );

    expect(result.ok).toBe(false);
    expect(result.handleTaken).toBe(true);
  });

  test("a non-claim update failure is not a handle conflict", async () => {
    state.fail = {
      table: "projects",
      op: "update",
      message: "could not serialize access",
    };

    const result = await publishProject(
      makeClient(state),
      "owner-1",
      project,
      entries,
      memberships,
      "dex",
    );

    expect(result).toEqual({
      ok: false,
      error: "could not serialize access",
    });
    expect(result.handleTaken).toBeUndefined();
  });

  test("a successful publish pokes the projection cache", async () => {
    await publishProject(
      makeClient(state),
      "owner-1",
      project,
      entries,
      memberships,
      "dex",
    );

    expect(fetched).toHaveLength(1);
    expect(fetched[0].url).toBe("/api/revalidate");
    expect(JSON.parse(fetched[0].body)).toEqual({
      tags: ["published_entry_points"],
    });
  });
});

describe("unpublishProject (decision 14: the handle claim stays)", () => {
  test("clears entry points and redirects before the status flip", async () => {
    const result = await unpublishProject(makeClient(state), "proj-1");

    expect(result.ok).toBe(true);
    expect(opNames()).toEqual([
      "published_entry_points:delete",
      "route_redirects:delete",
      "projects:update",
    ]);
    expect(opFilters(state.ops[0], "project_id")).toBe("proj-1");
    expect(opFilters(state.ops[1], "project_id")).toBe("proj-1");

    const update = state.ops[2];
    expect(update.payload).toEqual({ status: PROJECT_PUBLISH_STATUS.draft });
    // The claim is never released — no handle (or published_at) in the write.
    expect(update.payload).not.toHaveProperty("handle");
    expect(update.payload).not.toHaveProperty("published_at");
  });

  test("stops at the first failure — no status flip after a failed clear", async () => {
    state.fail = {
      table: "published_entry_points",
      op: "delete",
      message: "clear exploded",
    };

    const result = await unpublishProject(makeClient(state), "proj-1");

    expect(result).toEqual({ ok: false, error: "clear exploded" });
    expect(opNames()).toEqual(["published_entry_points:delete"]);
    expect(fetched).toHaveLength(0);
  });

  test("a failed redirect clear still blocks the status flip", async () => {
    state.fail = {
      table: "route_redirects",
      op: "delete",
      message: "redirect exploded",
    };

    const result = await unpublishProject(makeClient(state), "proj-1");

    expect(result).toEqual({ ok: false, error: "redirect exploded" });
    expect(opNames()).toEqual([
      "published_entry_points:delete",
      "route_redirects:delete",
    ]);
    expect(fetched).toHaveLength(0);
  });

  test("a successful unpublish pokes the projection cache", async () => {
    await unpublishProject(makeClient(state), "proj-1");

    expect(fetched).toHaveLength(1);
    expect(JSON.parse(fetched[0].body)).toEqual({
      tags: ["published_entry_points"],
    });
  });
});

describe("getPublishedEntryPointsFrom (live reader, decision 18)", () => {
  test("reads explicit columns — never SELECT *", async () => {
    state.entryRows = [
      { route: "beta", screen_id: "s-b", spec: makeSpec("beta") },
      { route: "", screen_id: "s-home", spec: makeSpec("home") },
    ];

    const rows = await getPublishedEntryPointsFrom(makeClient(state), "proj-1");

    expect(state.ops).toHaveLength(1);
    expect(state.ops[0].columns).toBe("route, screen_id, spec");
    expect(opFilters(state.ops[0], "project_id")).toBe("proj-1");
    expect(rows).toEqual([
      { route: "beta", screenId: "s-b", spec: makeSpec("beta") },
      { route: "", screenId: "s-home", spec: makeSpec("home") },
    ]);
  });

  test("malformed rows are dropped, never rendered", async () => {
    state.entryRows = [
      { route: "ok", screen_id: "s-1", spec: makeSpec("ok") },
      { route: 42, screen_id: "s-2", spec: makeSpec("x") },
      { route: "bad", screen_id: "s-3", spec: "not-an-object" },
      { route: "ghost", screen_id: null, spec: makeSpec("g") },
    ];

    const rows = await getPublishedEntryPointsFrom(makeClient(state), "proj-1");

    expect(rows?.map((row) => row.route)).toEqual(["ok"]);
  });

  test("a failed read answers null — the caller 404s (fail-closed)", async () => {
    state.fail = {
      table: "published_entry_points",
      op: "select",
      message: "permission denied",
    };

    expect(
      await getPublishedEntryPointsFrom(makeClient(state), "proj-1"),
    ).toBeNull();
  });
});

describe("publishProject validation (decision 20: no write on an issue)", () => {
  const entries = [entry("s-home", "home"), entry("s-a", "alpha")];
  const memberships = [
    member("m-home", "s-home", null, 0),
    member("m-a", "s-a", null, 1),
  ];
  const project = makeProject({ homeScreenId: "s-home" });

  test("no home screen refuses with noHome and writes nothing", async () => {
    const result = await publishProject(
      makeClient(state),
      "owner-1",
      makeProject({ homeScreenId: null }),
      entries,
      memberships,
      "dex",
    );

    expect(result.ok).toBe(false);
    expect(result.issue).toBe(PROJECT_PUBLISH_ISSUES.noHome);
    expect(result.error).toBe(PROJECT_PUBLISH_ISSUES.noHome);
    expect(state.ops).toHaveLength(0);
    expect(fetched).toHaveLength(0);
  });

  test("a dangling membership refuses with missingScreen", async () => {
    const result = await publishProject(
      makeClient(state),
      "owner-1",
      project,
      entries,
      [...memberships, member("m-ghost", "s-deleted", null, 2)],
      "dex",
    );

    expect(result.issue).toBe(PROJECT_PUBLISH_ISSUES.missingScreen);
    expect(result.error).toBe("s-deleted");
    expect(state.ops).toHaveLength(0);
  });

  test("a malformed route refuses with invalidRoute", async () => {
    const result = await publishProject(
      makeClient(state),
      "owner-1",
      project,
      entries,
      [...memberships, member("m-bad", "s-a", "items/{id", 2)],
      "dex",
    );

    expect(result.issue).toBe(PROJECT_PUBLISH_ISSUES.invalidRoute);
    expect(result.error).toBe("items/{id");
    expect(state.ops).toHaveLength(0);
  });

  test("a keyless api source refuses with dataConfig (067 gate)", async () => {
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
    const badHome: HistoryEntry = {
      ...entries[0],
      spec: badSpec,
      revisions: [{ spec: badSpec, label: "r0", createdAt: 1 }],
      head: 0,
    };

    const result = await publishProject(
      makeClient(state),
      "owner-1",
      project,
      [badHome, entries[1]],
      memberships,
      "dex",
    );

    expect(result.issue).toBe(PROJECT_PUBLISH_ISSUES.dataConfig);
    expect(result.error).toContain("auth.ref");
    expect(state.ops).toHaveLength(0);
    expect(fetched).toHaveLength(0);
  });

  test("a valid project still publishes (validation passes through)", async () => {
    const result = await publishProject(
      makeClient(state),
      "owner-1",
      project,
      entries,
      memberships,
      "dex",
    );

    expect(result.ok).toBe(true);
    expect(opNames()).toEqual([
      "published_entry_points:select",
      "published_entry_points:upsert",
      "projects:update",
    ]);
  });
});
