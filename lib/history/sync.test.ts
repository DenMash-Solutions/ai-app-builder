import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Spec } from "@json-render/core";
import {
  addEntry,
  clearHistory,
  createEntry,
  getHistory,
  removeEntry,
} from "./history";
import type { HistoryEntry } from "./history";
import {
  entryToRow,
  flushSync,
  getSyncStatus,
  membershipToRow,
  membershipsSyncSpec,
  projectToRow,
  projectsSyncSpec,
  rowToEntry,
  rowToMembership,
  rowToProject,
  startSync,
  startTableSync,
} from "./sync";
import type { SelectBuilder, SyncClient } from "./sync";
import {
  ACTIVE_PROJECT_STORAGE_KEY,
  PROJECT_STORAGE_KEY,
  applyRemoteProject,
  createProject,
  getProjects,
  removeProject,
} from "@/lib/projects/projects";
import type { Project } from "@/lib/projects/projects";
import {
  MEMBERSHIP_STORAGE_KEY,
  addScreenToProject,
  getMembership,
  getMemberships,
  removeScreenFromProject,
} from "@/lib/projects/memberships";
import type { ProjectMembership } from "@/lib/projects/memberships";

function makeSpec(heading: string): Spec {
  return {
    root: "root",
    elements: { root: { type: "Card", props: { title: heading } } },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface RecordedSelect {
  columns?: string;
  filters: { kind: "eq" | "in"; column: string; values: unknown[] }[];
}

interface MockState {
  rows: Record<string, unknown>[];
  upserts: Record<string, unknown>[][];
  deletes: string[][];
  /** Every awaited select, in order — column/filter pins (plan 055 A). */
  selects: RecordedSelect[];
}

/** Explicitly annotated so the self-references in `eq`/`in` don't trip
 *  TS's circular-initializer inference; cast to the real builder type. */
interface MockSelectBuilder {
  eq(column: string, value: unknown): MockSelectBuilder;
  in(column: string, values: unknown[]): MockSelectBuilder;
  then(
    onfulfilled?: (value: { data: unknown[] | null; error: null }) => void,
    onrejected?: (reason: unknown) => void,
  ): Promise<unknown>;
}

function makeClient(state: MockState): SyncClient {
  /** Rows visible to a table. Untagged rows predate table-awareness (the
   *  entries tests seed plain rows) and stay visible to every table; tagged
   *  rows surface only for their own — the two-loop tests share one mock
   *  and need `uis`/`projects` kept apart like the real database. */
  const visibleTo = (row: Record<string, unknown>, table: string): boolean =>
    row.__table === undefined || row.__table === table;

  const select = (table: string, columns?: string): SelectBuilder => {
    const filters: RecordedSelect["filters"] = [];
    const record = (): { data: unknown[]; error: null } => {
      state.selects.push({ columns, filters });
      let rows = state.rows
        .filter((row) => visibleTo(row, table))
        .map((row) => ({ ...row }));
      for (const filter of filters) {
        rows = rows.filter((row) =>
          filter.kind === "eq"
            ? row[filter.column] === filter.values[0]
            : filter.values.includes(row[filter.column]),
        );
      }
      if (columns !== undefined && columns !== "*") {
        const keys = columns.split(",").map((key) => key.trim());
        rows = rows.map((row) =>
          Object.fromEntries(keys.map((key) => [key, row[key]])),
        );
      }
      return { data: rows, error: null };
    };
    const builder: MockSelectBuilder = {
      eq: (column, value) => {
        filters.push({ kind: "eq", column, values: [value] });
        return builder;
      },
      in: (column, values) => {
        filters.push({ kind: "in", column, values });
        return builder;
      },
      then: (onfulfilled, onrejected) =>
        Promise.resolve(record()).then(onfulfilled, onrejected),
    };
    return builder as unknown as SelectBuilder;
  };

  return {
    from: (table: string) => ({
      select: (columns?: string) => select(table, columns),
      upsert: async (rows: Record<string, unknown>[]) => {
        state.upserts.push(rows);
        for (const payload of rows) {
          const row: Record<string, unknown> = { ...payload, __table: table };
          const index = state.rows.findIndex(
            (existing) => existing.id === row.id,
          );
          if (index >= 0) state.rows[index] = row;
          else state.rows.push(row);
        }
        return { error: null };
      },
      delete: () => ({
        in: async (_column: string, ids: string[]) => {
          state.deletes.push(ids);
          state.rows = state.rows.filter(
            (row) => !ids.includes(row.id as string),
          );
          return { error: null };
        },
      }),
    }),
  };
}

function remoteRow(
  id: string,
  overrides: Partial<{ updatedAt: number; name: string }> = {},
): Record<string, unknown> {
  const entry: HistoryEntry = {
    ...createEntry("account entry", makeSpec("remote")),
    id,
    name: overrides.name ?? "account entry",
    createdAt: 1000,
    updatedAt: overrides.updatedAt ?? 5000,
  };
  return entryToRow(entry, "owner-1");
}

describe("row mapping", () => {
  test("entryToRow / rowToEntry round-trip preserves timestamps and revisions", () => {
    const entry: HistoryEntry = {
      ...createEntry("prompt", makeSpec("v0")),
      createdAt: 1700000000000,
      updatedAt: 1700000009000,
    };

    const row = entryToRow(entry, "owner-1");
    const back = rowToEntry(row as unknown as Parameters<typeof rowToEntry>[0]);

    expect(back.id).toBe(entry.id);
    expect(back.slug).toBe(entry.slug);
    expect(back.createdAt).toBe(entry.createdAt);
    expect(back.updatedAt).toBe(entry.updatedAt);
    expect(back.revisions).toEqual(entry.revisions);
    expect(back.head).toBe(entry.head);
    expect(back.spec).toEqual(entry.spec);
  });

  test("project grouping is device-local — rows never carry projectId", () => {
    const entry = createEntry("prompt", makeSpec("v0"), "proj-1");
    expect(entry.projectId).toBe("proj-1");

    const row = entryToRow(entry, "owner-1");
    expect(row).not.toHaveProperty("projectId");

    const back = rowToEntry(row as unknown as Parameters<typeof rowToEntry>[0]);
    // The `uis` table has no project column (projects are local-only, 061):
    // an account copy never resurrects a grouping this device doesn't have.
    expect(back.projectId).toBeUndefined();
  });
});

describe("sync", () => {
  let state: MockState;

  beforeEach(() => {
    clearHistory();
    state = { rows: [], upserts: [], deletes: [], selects: [] };
  });

  afterEach(() => {
    clearHistory();
  });

  test("downloads remote-only entries preserving their updatedAt", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    state.rows.push(remoteRow(id, { updatedAt: 7000 }));

    const stop = startSync(makeClient(state), "owner-1", { debounceMs: 1 });
    await sleep(20);

    expect(getHistory()).toHaveLength(1);
    expect(getHistory()[0].id).toBe(id);
    expect(getHistory()[0].updatedAt).toBe(7000);
    expect(getSyncStatus()).toBe("saved");
    stop();
    expect(getSyncStatus()).toBe("idle");
  });

  test("remote newer than local wins the merge", async () => {
    const id = "22222222-2222-4222-8222-222222222222";
    const local = { ...createEntry("local copy", makeSpec("v0")), id };
    addEntry({ ...local, updatedAt: 1000 });
    state.rows.push(
      remoteRow(id, { updatedAt: 9000, name: "renamed remotely" }),
    );

    const stop = startSync(makeClient(state), "owner-1", { debounceMs: 1 });
    await sleep(20);

    const [stored] = getHistory();
    expect(stored.name).toBe("renamed remotely");
    expect(stored.updatedAt).toBe(9000);
    stop();
  });

  test("a remote win keeps the local project grouping (061)", async () => {
    const id = "44444444-4444-4444-8444-444444444444";
    addEntry({
      ...createEntry("local copy", makeSpec("v0"), "proj-9"),
      id,
      updatedAt: 1000,
    });
    state.rows.push(remoteRow(id, { updatedAt: 9000 }));

    const stop = startSync(makeClient(state), "owner-1", { debounceMs: 1 });
    await sleep(20);

    const [stored] = getHistory();
    expect(stored.updatedAt).toBe(9000);
    // The remote row has no project column (projects are local-only, 061), so
    // adopting it must carry the device's own grouping across the merge.
    expect(stored.projectId).toBe("proj-9");
    stop();
  });

  test("local newer than remote wins and is pushed", async () => {
    const id = "33333333-3333-4333-8333-333333333333";
    addEntry({
      ...createEntry("local winner", makeSpec("v0")),
      id,
      updatedAt: 9000,
    });
    state.rows.push(remoteRow(id, { updatedAt: 1000 }));

    const stop = startSync(makeClient(state), "owner-1", { debounceMs: 1 });
    await sleep(20);

    const pushed = state.upserts.flat().find((row) => row.id === id);
    expect(pushed).toBeDefined();
    expect(pushed?.name).toBe("local winner");
    expect(pushed?.owner_id).toBe("owner-1");
    expect(pushed?.updated_at).toBe(new Date(9000).toISOString());
    expect(getHistory()[0].name).toBe("local winner");
    stop();
  });

  test("remote-newer rows are not clobbered by the push", async () => {
    const id = "44444444-4444-4444-8444-444444444444";
    addEntry({
      ...createEntry("stale local", makeSpec("v0")),
      id,
      updatedAt: 1000,
    });
    state.rows.push(remoteRow(id, { updatedAt: 9000, name: "fresh remote" }));

    const stop = startSync(makeClient(state), "owner-1", { debounceMs: 1 });
    await sleep(20);

    // The stale local copy must never land in a push (an idempotent re-push
    // of the now-identical fresher copy is fine).
    const pushed = state.upserts.flat().find((row) => row.id === id);
    expect(pushed?.name ?? "fresh remote").toBe("fresh remote");
    // …and the local copy adopted the fresher remote one.
    expect(getHistory()[0].name).toBe("fresh remote");
    stop();
  });

  test("deletes a row removed locally after it was synced", async () => {
    const entry = createEntry("to be deleted", makeSpec("v0"));
    addEntry(entry);

    const stop = startSync(makeClient(state), "owner-1", { debounceMs: 1 });
    await sleep(20);
    expect(state.upserts.flat()).toHaveLength(1);

    removeEntry(entry.id);
    await sleep(30);

    expect(state.deletes).toEqual([[entry.id]]);
    stop();
  });

  test("history changes trigger a debounced push", async () => {
    const stop = startSync(makeClient(state), "owner-1", { debounceMs: 5 });
    await sleep(20);

    addEntry(createEntry("typed while synced", makeSpec("v1")));
    await sleep(1); // within the debounce window
    expect(state.upserts.flat()).toHaveLength(0);
    await sleep(30);

    expect(state.upserts.flat()).toHaveLength(1);
    expect(getSyncStatus()).toBe("saved");
    stop();
  });

  test("stopping mid-debounce (sign-out) cancels the pending push and settles to idle", async () => {
    const stop = startSync(makeClient(state), "owner-1", { debounceMs: 20 });
    await sleep(20);

    addEntry(createEntry("typed right before sign-out", makeSpec("v1")));
    await sleep(1); // within the debounce window
    stop(); // SyncEngine cleanup when the session goes away

    await sleep(40); // past the debounce — the push must never fire
    expect(state.upserts.flat()).toHaveLength(0);
    expect(getSyncStatus()).toBe("idle");
  });

  test("pull never adopts rows owned by another account (admin see-all)", async () => {
    // RLS audit F7: an admin's SELECT returns every uis row — without the
    // owner guard the pull would copy a foreign draft into local history
    // and the next push would re-upsert it with owner_id = admin.
    const foreignId = "55555555-5555-4555-8555-555555555555";
    const ownId = "66666666-6666-4666-8666-666666666666";
    state.rows.push({
      ...remoteRow(foreignId, { name: "victim draft" }),
      owner_id: "someone-else",
    });
    state.rows.push(remoteRow(ownId, { name: "own draft" }));

    const stop = startSync(makeClient(state), "owner-1", { debounceMs: 1 });
    await sleep(20);

    const ids = getHistory().map((entry) => entry.id);
    expect(ids).toContain(ownId);
    expect(ids).not.toContain(foreignId);
    // …and nothing re-upserted the foreign row.
    expect(
      state.upserts.flat().find((row) => row.id === foreignId),
    ).toBeUndefined();
    stop();
  });

  test("push never overwrites or re-owns a row another account owns", async () => {
    // Belt to pull's braces: a stale/polluted local copy of a foreign id
    // must not upsert (owner_id would be stamped to us) …
    const foreignId = "77777777-7777-4777-8777-777777777777";
    addEntry({
      ...createEntry("polluted local copy", makeSpec("v0")),
      id: foreignId,
      updatedAt: 9000, // newer than the remote — LWW alone would win
    });
    state.rows.push({
      ...remoteRow(foreignId, { name: "victim draft" }),
      owner_id: "someone-else",
    });

    const stop = startSync(makeClient(state), "owner-1", { debounceMs: 1 });
    await sleep(20);

    expect(
      state.upserts.flat().find((row) => row.id === foreignId),
    ).toBeUndefined();
    const row = state.rows.find((r) => r.id === foreignId);
    expect(row?.owner_id).toBe("someone-else");
    expect(row?.name).toBe("victim draft");

    // …and deleting the stale local copy must not delete the foreign row.
    removeEntry(foreignId);
    await sleep(30);
    expect(state.deletes.flat()).not.toContain(foreignId);
    expect(state.rows.find((r) => r.id === foreignId)).toBeDefined();
    stop();
  });

  test("pull is two-phase and both sync calls are column-slimmed (055 A)", async () => {
    const id = "99999999-9999-4999-8999-999999999999";
    state.rows.push(remoteRow(id, { updatedAt: 7000 }));

    const stop = startSync(makeClient(state), "owner-1", { debounceMs: 50 });
    await sleep(20);

    // Phase 1: LWW compare needs only the three scalar columns, filtered
    // to our rows server-side.
    expect(state.selects[0]).toEqual({
      columns: "id, owner_id, updated_at",
      filters: [{ kind: "eq", column: "owner_id", values: ["owner-1"] }],
    });
    // Phase 2: full rows fetched ONLY for the id that wins the compare.
    expect(state.selects[1].columns).toBe("*");
    expect(state.selects[1].filters).toEqual([
      { kind: "in", column: "id", values: [id] },
    ]);
    // Push: slim and deliberately unfiltered — the F7 guard must still see
    // foreign rows to refuse upserting them (decision 5).
    expect(state.selects[2]).toEqual({
      columns: "id, owner_id, updated_at",
      filters: [],
    });
    // The merge still adopted the remote entry (semantics unchanged).
    expect(getHistory().map((entry) => entry.id)).toContain(id);
    stop();
  });

  test("no full-row fetch when nothing wins the compare (055 A)", async () => {
    const id = "aaaaaaaa-4444-4888-8999-aaaaaaaaaaaa";
    addEntry({
      ...createEntry("already fresh local", makeSpec("v0")),
      id,
      updatedAt: 9000,
    });
    state.rows.push(remoteRow(id, { updatedAt: 1000 })); // older than local

    const stop = startSync(makeClient(state), "owner-1", { debounceMs: 50 });
    await sleep(20);

    // Exactly pull-phase-1 + push: the `*` phase never runs.
    expect(state.selects).toHaveLength(2);
    expect(state.selects.filter((s) => s.columns === "*")).toHaveLength(0);
    stop();
  });
});

/** The window's storage — reuses the shared test window or installs one
 *  (same pattern as projects.test.ts: bun test shares one process). */
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

function projectRow(
  id: string,
  overrides: Partial<{
    updatedAt: number;
    name: string;
    slug: string;
    ownerId: string;
  }> = {},
): Record<string, unknown> {
  return {
    id,
    owner_id: overrides.ownerId ?? "owner-1",
    name: overrides.name ?? "remote project",
    slug: overrides.slug ?? "remote-project",
    state: {},
    created_at: new Date(1000).toISOString(),
    updated_at: new Date(overrides.updatedAt ?? 5000).toISOString(),
    __table: "projects",
  };
}

function membershipRow(
  id: string,
  overrides: Partial<{
    updatedAt: number;
    projectId: string;
    screenId: string;
    route: string | null;
    position: number;
    ownerId: string;
  }> = {},
): Record<string, unknown> {
  return {
    id,
    owner_id: overrides.ownerId ?? "owner-1",
    project_id: overrides.projectId ?? "11111111-2222-4333-8444-555555555555",
    screen_id: overrides.screenId ?? "11111111-2222-4333-8444-666666666666",
    route: overrides.route ?? null,
    position: overrides.position ?? 0,
    created_at: new Date(1000).toISOString(),
    updated_at: new Date(overrides.updatedAt ?? 5000).toISOString(),
    __table: "project_screens",
  };
}

describe("projects loop (plan 064)", () => {
  let state: MockState;

  const resetProjects = (): void => {
    // Reset through the store's own API so cache and storage agree — the
    // module instance (and its cache) is shared across test files.
    for (const project of [...getProjects()]) removeProject(project.id);
    storage().removeItem(PROJECT_STORAGE_KEY);
    storage().removeItem(ACTIVE_PROJECT_STORAGE_KEY);
  };

  beforeEach(() => {
    storage(); // install/reuse the shared window so the store isn't SSR-empty
    resetProjects();
    clearHistory();
    state = { rows: [], upserts: [], deletes: [], selects: [] };
  });

  afterEach(() => {
    resetProjects();
    clearHistory();
  });

  test("projectToRow / rowToProject round-trip; status stays server-side", () => {
    const project: Project = {
      id: "aaaaaaaa-4444-4888-8999-aaaaaaaaaaaa",
      name: "Pokédex",
      slug: "pokedex",
      createdAt: 1700000000000,
      updatedAt: 1700000009000,
      state: { cart: ["pikachu"] },
      homeScreenId: "bbbbbbbb-4444-4888-8999-bbbbbbbbbbbb",
    };
    const row = projectToRow(project, "owner-1");
    expect(row.owner_id).toBe("owner-1");
    // status is 069's server-side fact — sync must not write it; the
    // explicit home (065 decision 10) now travels BOTH ways.
    expect(row.status).toBeUndefined();
    expect(row.home_screen_id).toBe("bbbbbbbb-4444-4888-8999-bbbbbbbbbbbb");

    expect(rowToProject(row)).toEqual(project);

    // No home → null on the wire, absent after normalization — both read
    // as "empty home" for the decision-13 seed paths.
    const withoutHome = projectToRow(
      { ...project, homeScreenId: undefined },
      "owner-1",
    );
    expect(withoutHome.home_screen_id).toBeNull();
    expect(rowToProject(withoutHome)?.homeScreenId).toBeUndefined();

    // Corrupt/partial rows: junk timestamp → null, empty name → null,
    // non-object state → backfilled to {}, non-object row → null, junk
    // home id → absent.
    expect(rowToProject({ ...row, created_at: "garbage" })).toBeNull();
    expect(rowToProject({ ...row, name: "" })).toBeNull();
    expect(rowToProject({ ...row, state: "scalar" })?.state).toEqual({});
    expect(
      rowToProject({ ...row, home_screen_id: 42 })?.homeScreenId,
    ).toBeUndefined();
    expect(rowToProject("not-an-object")).toBeNull();
  });

  test("downloads a remote-only project with its id, slug and stamps (no remap)", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    state.rows.push(
      projectRow(id, { name: "Pokédex", slug: "pokedex", updatedAt: 7000 }),
    );

    const stop = startTableSync(
      makeClient(state),
      "owner-1",
      projectsSyncSpec,
      { debounceMs: 1 },
    );
    await sleep(20);

    const projects = getProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].id).toBe(id); // client-generated id adopted as-is
    expect(projects[0].name).toBe("Pokédex");
    expect(projects[0].slug).toBe("pokedex");
    expect(projects[0].updatedAt).toBe(7000);
    expect(getSyncStatus()).toBe("saved");
    stop();
    expect(getSyncStatus()).toBe("idle");
  });

  test("a remote-newer project wins the merge and is never clobbered back", async () => {
    const adopted = createProject("Device two") as Project;
    state.rows.push(
      projectRow(adopted.id, {
        name: "Renamed on device one",
        slug: "device-two",
        updatedAt: Date.now() + 90000,
      }),
    );

    const stop = startTableSync(
      makeClient(state),
      "owner-1",
      projectsSyncSpec,
      { debounceMs: 1 },
    );
    await sleep(20);

    expect(getProjects().find((p) => p.id === adopted.id)?.name).toBe(
      "Renamed on device one",
    );
    // The push must carry the adopted copy (or skip it) — never a stale name.
    const pushed = state.upserts.flat().find((row) => row.id === adopted.id);
    expect(pushed?.name ?? "Renamed on device one").toBe(
      "Renamed on device one",
    );
    stop();
  });

  test("a local-newer project wins the merge and lands in the payload", async () => {
    const local = createProject("Local winner") as Project;
    state.rows.push(
      projectRow(local.id, {
        name: "stale remote",
        slug: "local-winner",
        updatedAt: 1,
      }),
    );

    const stop = startTableSync(
      makeClient(state),
      "owner-1",
      projectsSyncSpec,
      { debounceMs: 1 },
    );
    await sleep(20);

    const pushed = state.upserts.flat().find((row) => row.id === local.id);
    expect(pushed?.name).toBe("Local winner");
    expect(pushed?.owner_id).toBe("owner-1");
    expect(pushed?.updated_at).toBe(new Date(local.updatedAt).toISOString());
    const stored = getProjects().find((p) => p.id === local.id);
    expect(stored?.name).toBe("Local winner");
    // Our own remote row sharing the slug never triggers a reconcile bump.
    expect(stored?.slug).toBe("local-winner");
    stop();
  });

  test("pull never adopts projects owned by another account (F7 see-all)", async () => {
    const foreignId = "55555555-5555-4555-8555-555555555555";
    const ownId = "66666666-6666-4666-8666-666666666666";
    state.rows.push(
      projectRow(foreignId, {
        name: "victim project",
        slug: "victim",
        ownerId: "someone-else",
      }),
    );
    state.rows.push(projectRow(ownId, { name: "own project" }));

    const stop = startTableSync(
      makeClient(state),
      "owner-1",
      projectsSyncSpec,
      { debounceMs: 1 },
    );
    await sleep(20);

    const ids = getProjects().map((project) => project.id);
    expect(ids).toContain(ownId);
    expect(ids).not.toContain(foreignId);
    stop();
  });

  test("push never overwrites or deletes a project another account owns (F7)", async () => {
    const foreignId = "77777777-7777-4777-8777-777777777777";
    state.rows.push(
      projectRow(foreignId, {
        name: "victim project",
        slug: "victim",
        ownerId: "someone-else",
      }),
    );
    // A polluted LOCAL copy of the foreign id — LWW alone would win (it's
    // newer), so only the owner guard can stop the upsert.
    applyRemoteProject({
      id: foreignId,
      name: "polluted local copy",
      slug: "polluted",
      createdAt: 1,
      updatedAt: 90000,
      state: {},
    });

    const stop = startTableSync(
      makeClient(state),
      "owner-1",
      projectsSyncSpec,
      { debounceMs: 1 },
    );
    await sleep(20);

    expect(
      state.upserts.flat().find((row) => row.id === foreignId),
    ).toBeUndefined();
    expect(state.rows.find((row) => row.id === foreignId)?.owner_id).toBe(
      "someone-else",
    );
    expect(state.rows.find((row) => row.id === foreignId)?.name).toBe(
      "victim project",
    );

    // Deleting the stale local copy must not delete the foreign row.
    removeProject(foreignId);
    await sleep(30);
    expect(state.deletes.flat()).not.toContain(foreignId);
    expect(state.rows.find((row) => row.id === foreignId)).toBeDefined();
    stop();
  });

  test("corrupt or partial remote rows are sanitized away", async () => {
    state.rows.push(
      {
        __table: "projects",
        id: "bad-timestamp",
        owner_id: "owner-1",
        name: "No date",
        slug: "no-date",
        state: {},
        created_at: "garbage",
        updated_at: "garbage",
      },
      {
        __table: "projects",
        id: "bad-name",
        owner_id: "owner-1",
        name: "   ",
        slug: "blank-name",
        state: {},
        created_at: new Date(1000).toISOString(),
        updated_at: new Date(5000).toISOString(),
      },
      {
        __table: "projects",
        id: "junk-state",
        owner_id: "owner-1",
        name: "Junk state",
        slug: "junk-state",
        state: ["array"],
        created_at: new Date(1000).toISOString(),
        updated_at: new Date(5000).toISOString(),
      },
      projectRow("11111111-2222-4333-8444-555555555555", { name: "Good" }),
    );

    const stop = startTableSync(
      makeClient(state),
      "owner-1",
      projectsSyncSpec,
      { debounceMs: 1 },
    );
    await sleep(20);

    const ids = getProjects().map((project) => project.id);
    expect(ids).toContain("11111111-2222-4333-8444-555555555555");
    expect(ids).not.toContain("bad-timestamp");
    expect(ids).not.toContain("bad-name");
    // Salvageable row kept, its junk state backfilled to the session object.
    expect(getProjects().find((p) => p.id === "junk-state")?.state).toEqual({});
    stop();
  });

  test("adopting a remote project bumps the LOCAL slug holder — both kept (d5)", async () => {
    const local = createProject("Pokédex") as Project;
    expect(local.slug).toBe("pokedex");
    const remoteId = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
    state.rows.push(
      projectRow(remoteId, {
        name: "Pokédex",
        slug: "pokedex",
        updatedAt: Date.now() + 90000,
      }),
    );

    const stop = startTableSync(
      makeClient(state),
      "owner-1",
      projectsSyncSpec,
      { debounceMs: 1 },
    );
    await sleep(20);

    const projects = getProjects();
    expect(projects).toHaveLength(2);
    // Constraint truth keeps the remote slug; the local holder yields.
    expect(projects.find((p) => p.id === remoteId)?.slug).toBe("pokedex");
    expect(projects.find((p) => p.id === local.id)?.slug).toBe("pokedex-2");
    expect(state.upserts.flat().find((row) => row.id === local.id)?.slug).toBe(
      "pokedex-2",
    );
    stop();
  });

  test("a remote row appearing after the pull is reconciled before the payload (d5)", async () => {
    const local = createProject("Pokedex") as Project;
    expect(local.slug).toBe("pokedex");

    const client = makeClient(state);
    const stop = startTableSync(client, "owner-1", projectsSyncSpec, {
      debounceMs: 1,
    });
    await sleep(20); // initial run: empty remote → local pushed as-is
    expect(state.rows.find((row) => row.id === local.id)?.slug).toBe("pokedex");

    // Device one's pokedex lands in the account — no second pull runs this
    // session, so only the push's reconcile can resolve the collision.
    state.rows.push(
      projectRow("bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb", {
        name: "Pokedex",
        slug: "pokedex",
        updatedAt: Date.now() + 90000,
      }),
    );

    createProject("Second screen set"); // schedules the next debounced push
    await sleep(30);

    expect(getProjects().find((p) => p.id === local.id)?.slug).toBe(
      "pokedex-2",
    );
    // The LATEST push of that row must carry the bump (earlier pushes of the
    // pre-bump copy are legitimately in the log).
    const pushedRows = state.upserts
      .flat()
      .filter((row) => row.id === local.id);
    expect(pushedRows.at(-1)?.slug).toBe("pokedex-2");
    stop();
  });

  test("one status dot and one flush path across both loops (d1)", async () => {
    const client = makeClient(state);
    const stopEntries = startSync(client, "owner-1", { debounceMs: 50 });
    const stopProjects = startTableSync(client, "owner-1", projectsSyncSpec, {
      debounceMs: 50,
    });
    await sleep(20);

    expect(getSyncStatus()).toBe("saved");

    // One loop stopping must not dim the dot while the other still runs.
    stopEntries();
    expect(getSyncStatus()).toBe("saved");
    stopProjects();
    expect(getSyncStatus()).toBe("idle");

    // One flush pushes BOTH tables outside their debounces.
    const stopAgain = [
      startSync(client, "owner-1", { debounceMs: 5000 }),
      startTableSync(client, "owner-1", projectsSyncSpec, {
        debounceMs: 5000,
      }),
    ];
    await sleep(20);
    addEntry(createEntry("entry to flush", makeSpec("v0")));
    createProject("Project to flush");
    flushSync();
    await sleep(30);

    const pushed = state.upserts.flat();
    expect(pushed.some((row) => "revisions" in row)).toBe(true); // uis loop
    expect(pushed.some((row) => "state" in row)).toBe(true); // projects loop
    expect(getSyncStatus()).toBe("saved");
    stopAgain.forEach((stop) => stop());
    expect(getSyncStatus()).toBe("idle");
  });
});

describe("memberships loop (plan 065)", () => {
  let state: MockState;

  /** Reset through the store's own API so cache and storage agree. History
   *  is cleared FIRST, so the backfill reads nothing to seed. */
  const resetMemberships = (): void => {
    for (const membership of [...getMemberships()]) {
      removeScreenFromProject(membership.projectId, membership.screenId);
    }
    storage().removeItem(MEMBERSHIP_STORAGE_KEY);
  };

  beforeEach(() => {
    storage(); // install/reuse the shared window so the store isn't SSR-empty
    clearHistory();
    resetMemberships();
    state = { rows: [], upserts: [], deletes: [], selects: [] };
  });

  afterEach(() => {
    clearHistory();
    resetMemberships();
  });

  test("membershipToRow / rowToMembership round-trip; owner stamp and corrupt rows", () => {
    const membership: ProjectMembership = {
      id: "aaaaaaaa-4444-4888-8999-aaaaaaaaaaaa",
      projectId: "11111111-2222-4333-8444-555555555555",
      screenId: "11111111-2222-4333-8444-666666666666",
      route: "detail/{id}",
      position: 3,
      createdAt: 1700000000000,
      updatedAt: 1700000009000,
    };
    const row = membershipToRow(membership, "owner-1");
    expect(row.owner_id).toBe("owner-1");
    expect(row.project_id).toBe(membership.projectId);
    expect(row.route).toBe("detail/{id}");
    expect(rowToMembership(row)).toEqual(membership);

    // Corrupt/partial rows: junk timestamp → null, missing columns → null,
    // non-object → null (the rowToProject discipline).
    expect(rowToMembership({ ...row, created_at: "garbage" })).toBeNull();
    expect(rowToMembership({ ...row, screen_id: undefined })).toBeNull();
    expect(rowToMembership("not-an-object")).toBeNull();
  });

  test("downloads a remote-only membership with its ids and stamps (no remap)", async () => {
    const id = "99999999-8888-4777-6666-555555555555";
    state.rows.push(membershipRow(id, { updatedAt: 7000, route: "settings" }));

    const stop = startTableSync(
      makeClient(state),
      "owner-1",
      membershipsSyncSpec,
      { debounceMs: 1 },
    );
    await sleep(20);

    const rows = getMemberships();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(id); // client-generated id adopted as-is
    expect(rows[0].route).toBe("settings");
    expect(rows[0].updatedAt).toBe(7000);
    expect(getSyncStatus()).toBe("saved");
    stop();
    expect(getSyncStatus()).toBe("idle");
  });

  test("pushes a local membership with pair, route, position and owner stamp", async () => {
    const project = "22222222-3333-4444-5555-666666666666";
    const screen = "33333333-4444-5555-6666-777777777777";
    const membership = addScreenToProject(
      project,
      screen,
      "detail/{id}",
    ) as ProjectMembership;

    const stop = startTableSync(
      makeClient(state),
      "owner-1",
      membershipsSyncSpec,
      { debounceMs: 1 },
    );
    await sleep(20);

    const pushed = state.upserts.flat().find((row) => row.id === membership.id);
    expect(pushed?.owner_id).toBe("owner-1");
    expect(pushed?.project_id).toBe(project);
    expect(pushed?.screen_id).toBe(screen);
    expect(pushed?.route).toBe("detail/{id}");
    expect(pushed?.position).toBe(0);
    expect(pushed?.updated_at).toBe(
      new Date(membership.updatedAt).toISOString(),
    );
    stop();
  });

  test("push reconciles a route another remote row owns — cleared, not poisoned (d9)", async () => {
    const project = "44444444-5555-6666-7777-888888888888";
    const local = addScreenToProject(
      project,
      "55555555-6666-7777-8888-999999999999",
      "settings",
    ) as ProjectMembership;
    // Device one already pushed the same route on ANOTHER pair.
    state.rows.push(
      membershipRow("66666666-7777-8888-9999-000000000000", {
        projectId: project,
        screenId: "77777777-8888-9999-0000-111111111111",
        route: "settings",
        updatedAt: Date.now() + 90000,
      }),
    );

    const stop = startTableSync(
      makeClient(state),
      "owner-1",
      membershipsSyncSpec,
      { debounceMs: 1 },
    );
    await sleep(20);

    // The local holder cleared BEFORE the payload — the batch never trips
    // unique (project_id, route) (decision 9).
    const pushed = state.upserts.flat().filter((row) => row.id === local.id);
    expect(pushed.at(-1)?.route).toBeNull();
    expect(getMembership(project, local.screenId)?.route).toBeNull();
    // The remote route owner is untouched (still routed, still theirs).
    expect(
      state.rows.find(
        (row) => row.id === "66666666-7777-8888-9999-000000000000",
      )?.route,
    ).toBe("settings");
    stop();
  });

  test("push re-keys a local pair twin onto the remote id — one row per pair (d11)", async () => {
    const project = "88888888-9999-0000-1111-222222222222";
    const screen = "99999999-0000-1111-2222-333333333333";
    const local = addScreenToProject(project, screen) as ProjectMembership;
    // Device one added the SAME screen to the SAME project (another uuid)
    // with older content — the local copy should win under LWW.
    state.rows.push(
      membershipRow("aaaaaaa1-0000-1111-2222-333333333333", {
        projectId: project,
        screenId: screen,
        position: 7,
        updatedAt: 1,
      }),
    );

    const stop = startTableSync(
      makeClient(state),
      "owner-1",
      membershipsSyncSpec,
      { debounceMs: 1 },
    );
    await sleep(20);

    // Exactly one local row for the pair, carrying the remote's DB identity
    // and the local content.
    const forPair = getMemberships().filter(
      (row) => row.projectId === project && row.screenId === screen,
    );
    expect(forPair).toHaveLength(1);
    expect(forPair[0].id).toBe("aaaaaaa1-0000-1111-2222-333333333333");
    expect(forPair[0].position).toBe(local.position);
    // The push upserts that id with the local content (local newer wins).
    const pushed = state.upserts
      .flat()
      .filter((row) => row.id === "aaaaaaa1-0000-1111-2222-333333333333");
    expect(pushed.at(-1)?.position).toBe(local.position);
    stop();
  });

  test("a local deletion reaches the table as a delete, not a resurrection", async () => {
    const project = "22222222-3333-4444-5555-aaaaaaaaaaaa";
    const screen = "33333333-4444-5555-6666-bbbbbbbbbbbb";
    expect(addScreenToProject(project, screen)).not.toBeNull();
    const remoteId = "aaaaaaa2-0000-1111-2222-333333333333";
    state.rows.push(
      membershipRow(remoteId, { projectId: project, screenId: screen }),
    );

    const client = makeClient(state);
    const stop = startTableSync(client, "owner-1", membershipsSyncSpec, {
      debounceMs: 1,
    });
    await sleep(30); // pair duplicate resolved by the first run's reconcile

    // Remove locally — the row leaves the store...
    removeScreenFromProject(project, screen);
    await sleep(30);
    // ...and the synced id is deleted server-side, never re-upserted.
    expect(getMembership(project, screen)).toBeNull();
    expect(state.rows.some((row) => row.id === remoteId)).toBe(false);
    stop();
  });
});
