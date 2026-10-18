import { describe, expect, test } from "bun:test";
import { AdapterRegistry } from "./adapter-registry";
import { createLocalStorageAdapter } from "./local-storage-adapter";
import { QueryManager, resolveRecordId } from "./query-manager";
import {
  DATA_ERROR_CODES,
  DATA_SOURCE_PROVIDERS,
  QUERY_STATUSES,
  dataStorageKey,
} from "./types";
import type { DataSourceAdapter, AdapterCapabilities } from "./adapter";
import type { QueryManagerConfig } from "./query-manager";
import type { QueryMirror } from "./types";
import type { StateModel } from "@json-render/core";

/** Map-backed Storage double (no DOM needed — plan T5/T6 DI). */
function fakeStorage(): Storage & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    getItem: (key: string) => (raw.has(key) ? (raw.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      raw.set(key, value);
    },
    removeItem: (key: string) => {
      raw.delete(key);
    },
    clear: () => {
      raw.clear();
    },
    key: (index: number) => [...raw.keys()][index] ?? null,
    get length() {
      return raw.size;
    },
  } as Storage & { raw: Map<string, string> };
}

interface Write {
  path: string;
  value: QueryMirror;
}

/** Deterministic config: one dataSource, one resource, one list query. */
function todoConfig(writes: Write[]): QueryManagerConfig {
  return {
    namespace: "entry-1",
    dataSources: { localTodos: { provider: "localStorage", config: {} } },
    resources: {
      todos: {
        dataSource: "localTodos",
        schema: { title: "string", done: "boolean" },
      },
    },
    queries: { todoList: { resource: "todos", operation: "list" } },
    write: (path, value) => {
      writes.push({ path, value: value as QueryMirror });
    },
  };
}

const registryFor = (storage: Storage) =>
  new AdapterRegistry({
    [DATA_SOURCE_PROVIDERS.localStorage]: (def, context) =>
      createLocalStorageAdapter(def, context, () => storage),
  });

/** One macrotask — all fake-storage microtasks settle first. */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const seed = (storage: Storage, records: unknown[]): void => {
  storage.setItem(dataStorageKey("entry-1", "todos"), JSON.stringify(records));
};

/** Adapter whose `list` blocks until `release()` (dedupe/stale tests). */
function gatedAdapter(): {
  adapter: DataSourceAdapter;
  release: () => void;
  listCalls: () => number;
} {
  const capabilities: AdapterCapabilities = {
    list: true,
    get: true,
    create: true,
    update: true,
    delete: true,
  };
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  return {
    adapter: {
      provider: DATA_SOURCE_PROVIDERS.localStorage,
      capabilities,
      initialize: async () => {},
      list: async () => {
        calls += 1;
        await gate;
        return [];
      },
      get: async () => null,
      create: async (_resource, input) => input,
      update: async (_resource, _id, patch) => patch,
      delete: async () => {},
      dispose: async () => {},
    },
    release: () => release(),
    listCalls: () => calls,
  };
}

describe("QueryManager", () => {
  test("attach mirrors idle → loading → success through the write channel only", async () => {
    const storage = fakeStorage();
    const writes: Write[] = [];
    const manager = new QueryManager(registryFor(storage));
    manager.attach(todoConfig(writes));

    // Idle is synchronous (D1: the mirror path always exists to bind to).
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe("/queries/todoList");
    expect(writes[0].value.status).toBe(QUERY_STATUSES.idle);

    await tick();
    const statuses = writes.map((w) => w.value.status);
    expect(statuses).toEqual([
      QUERY_STATUSES.idle,
      QUERY_STATUSES.loading,
      QUERY_STATUSES.success,
    ]);
    const last = writes.at(-1) as Write;
    expect(last.value.data).toEqual([]);
    expect(last.value.count).toBe(0);
    expect(last.value.error).toBeNull();
  });

  test("seeded records surface as data + count in the success mirror", async () => {
    const storage = fakeStorage();
    seed(storage, [{ id: "a", title: "Buy milk", done: false }]);
    const writes: Write[] = [];
    const manager = new QueryManager(registryFor(storage));
    manager.attach(todoConfig(writes));
    await tick();
    const last = writes.at(-1) as Write;
    expect(last.value.status).toBe(QUERY_STATUSES.success);
    expect(last.value.data).toEqual([
      { id: "a", title: "Buy milk", done: false },
    ]);
    expect(last.value.count).toBe(1);
  });

  test("malformed storage becomes the error mirror, not a crash", async () => {
    const storage = fakeStorage();
    storage.setItem(dataStorageKey("entry-1", "todos"), "{oops");
    const writes: Write[] = [];
    const manager = new QueryManager(registryFor(storage));
    manager.attach(todoConfig(writes));
    await tick();
    const last = writes.at(-1) as Write;
    expect(last.value.status).toBe(QUERY_STATUSES.error);
    expect(last.value.error?.code).toBe(DATA_ERROR_CODES.malformed);
  });

  test("a query over an unknown resource errors immediately with a code", async () => {
    const storage = fakeStorage();
    const writes: Write[] = [];
    const manager = new QueryManager(registryFor(storage));
    const config = todoConfig(writes);
    config.queries = { broken: { resource: "ghost", operation: "list" } };
    manager.attach(config);
    await tick();
    const last = writes.at(-1) as Write;
    expect(last.path).toBe("/queries/broken");
    expect(last.value.status).toBe(QUERY_STATUSES.error);
    expect(last.value.error?.code).toBe(DATA_ERROR_CODES.resourceNotFound);
  });

  test("refreshResource re-reads silently (no loading write between)", async () => {
    const storage = fakeStorage();
    const writes: Write[] = [];
    const manager = new QueryManager(registryFor(storage));
    manager.attach(todoConfig(writes));
    await tick();

    writes.length = 0;
    seed(storage, [{ id: "a", title: "Buy milk", done: false }]);
    await manager.refreshResource("entry-1", "todos");
    expect(writes.map((w) => w.value.status)).toEqual([QUERY_STATUSES.success]);
    expect((writes.at(-1) as Write).value.count).toBe(1);
  });

  test("storage events re-read only the matching namespace's collection", async () => {
    const storage = fakeStorage();
    const writes: Write[] = [];
    const manager = new QueryManager(registryFor(storage));
    manager.attach(todoConfig(writes));
    await tick();

    writes.length = 0;
    // Another tab wrote this design's collection → silent refresh.
    manager.handleStorageEvent({ key: dataStorageKey("entry-1", "todos") });
    await tick();
    expect(writes.map((w) => w.value.status)).toEqual([QUERY_STATUSES.success]);

    writes.length = 0;
    // A different design's namespace → ignored entirely.
    manager.handleStorageEvent({ key: dataStorageKey("other-entry", "todos") });
    await tick();
    expect(writes).toHaveLength(0);

    writes.length = 0;
    // storage.clear() → everything may be gone.
    manager.handleStorageEvent({ key: null });
    await tick();
    expect(writes.map((w) => w.value.status)).toEqual([QUERY_STATUSES.success]);
    expect((writes.at(-1) as Write).value.count).toBe(0);
  });

  test("concurrent attaches dedupe in-flight reads of the same query", async () => {
    const writes: Write[] = [];
    const { adapter, release, listCalls } = gatedAdapter();
    const registry = new AdapterRegistry({
      [DATA_SOURCE_PROVIDERS.localStorage]: () => adapter,
    });
    const manager = new QueryManager(registry);

    const configA = todoConfig(writes);
    const configB = todoConfig(writes);
    manager.attach(configA);
    manager.attach(configB);
    release();
    await tick();
    expect(listCalls()).toBe(1);
  });

  test("a read that finishes after detach never writes (stale-write guard)", async () => {
    const writes: Write[] = [];
    const { adapter, release } = gatedAdapter();
    const registry = new AdapterRegistry({
      [DATA_SOURCE_PROVIDERS.localStorage]: () => adapter,
    });
    const manager = new QueryManager(registry);

    const detach = manager.attach(todoConfig(writes));
    detach();
    writes.length = 0; // drop the synchronous idle write
    release();
    await tick();
    expect(writes).toHaveLength(0);
    // Adapters of the detached namespace are disposed and forgotten.
    expect(registry.size).toBe(0);
  });

  test("StrictMode-style remount: the superseded load never clobbers the fresh mirror", async () => {
    const storage = fakeStorage();
    seed(storage, [{ id: "a", title: "Buy milk", done: false }]);
    const writes: Write[] = [];
    const manager = new QueryManager(registryFor(storage));
    // attach → detach → attach within one tick: the first load is still in
    // flight when its adapter is disposed (the handle is nulled), so it
    // ends in unavailable — without supersession that error would land
    // over the second attach's success, and the dedupe slot it held would
    // have blocked the replacement load.
    const detach = manager.attach(todoConfig(writes));
    detach();
    manager.attach(todoConfig(writes));
    await tick();

    const statuses = writes.map((w) => w.value.status);
    expect(statuses).not.toContain(QUERY_STATUSES.error);
    const last = writes.at(-1) as Write;
    expect(last.value.status).toBe(QUERY_STATUSES.success);
    expect(last.value.count).toBe(1);
  });

  test("configFor exposes declared defs and clears on detach", () => {
    const storage = fakeStorage();
    const writes: Write[] = [];
    const manager = new QueryManager(registryFor(storage));
    expect(manager.configFor("entry-1")).toBeUndefined();
    const detach = manager.attach(todoConfig(writes));
    const config = manager.configFor("entry-1");
    expect(config?.resources.todos.dataSource).toBe("localTodos");
    expect(config?.dataSources.localTodos.provider).toBe("localStorage");
    detach();
    expect(manager.configFor("entry-1")).toBeUndefined();
  });
});

describe("resolveRecordId (D2 rev 1.1: $item resolves to an absolute path)", () => {
  const state = {
    queries: { todoList: { data: [{ id: "abc", title: "Buy milk" }] } },
  } as StateModel;

  test("dereferences a /-leading path against live state", () => {
    expect(resolveRecordId("/queries/todoList/data/0/id", state)).toBe("abc");
  });

  test("literal ids pass through untouched", () => {
    expect(resolveRecordId("abc", state)).toBe("abc");
    expect(resolveRecordId(7, state)).toBe("7");
  });

  test("unresolvable ids become undefined (error branch, not a crash)", () => {
    expect(
      resolveRecordId("/queries/todoList/data/9/id", state),
    ).toBeUndefined();
    expect(resolveRecordId(undefined, state)).toBeUndefined();
    expect(resolveRecordId({}, state)).toBeUndefined();
  });
});

describe("state ownership (T9): the spec is never written", () => {
  const deepFreeze = <T>(value: T): T => {
    if (value && typeof value === "object") {
      for (const nested of Object.values(value)) deepFreeze(nested);
      Object.freeze(value);
    }
    return value;
  };

  test("frozen data blocks load fine; the mirror only reaches the write channel", async () => {
    const storage = fakeStorage();
    seed(storage, [{ id: "a", title: "Buy milk", done: false }]);
    const writes: Write[] = [];
    const config = todoConfig(writes);
    deepFreeze(config.dataSources);
    deepFreeze(config.resources);
    deepFreeze(config.queries);

    const manager = new QueryManager(registryFor(storage));
    manager.attach(config);
    await tick();

    const last = writes.at(-1) as Write;
    expect(last.value.status).toBe(QUERY_STATUSES.success);
    // Every write is confined to the reserved mirror namespace.
    expect(writes.every((w) => w.path.startsWith("/queries/"))).toBe(true);
  });
});
