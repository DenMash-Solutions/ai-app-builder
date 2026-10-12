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
import { entryToRow, getSyncStatus, rowToEntry, startSync } from "./sync";
import type { SyncClient } from "./sync";

function makeSpec(heading: string): Spec {
  return {
    root: "root",
    elements: { root: { type: "Card", props: { title: heading } } },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface MockState {
  rows: Record<string, unknown>[];
  upserts: Record<string, unknown>[][];
  deletes: string[][];
}

function makeClient(state: MockState): SyncClient {
  return {
    from: () => ({
      select: async () => ({
        data: state.rows.map((row) => ({ ...row })),
        error: null,
      }),
      upsert: async (rows: Record<string, unknown>[]) => {
        state.upserts.push(rows);
        for (const row of rows) {
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
});

describe("sync", () => {
  let state: MockState;

  beforeEach(() => {
    clearHistory();
    state = { rows: [], upserts: [], deletes: [] };
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
});
