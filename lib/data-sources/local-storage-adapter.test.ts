import { describe, expect, test } from "bun:test";
import { createLocalStorageAdapter } from "./local-storage-adapter";
import { DATA_ERROR_CODES, DataError, dataStorageKey } from "./types";
import type { NamedResourceDef } from "./types";

/** Map-backed Storage double — the adapter never needs a DOM (DI, plan T5). */
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

const resource: NamedResourceDef = {
  name: "todos",
  dataSource: "localTodos",
  schema: { title: "string", done: "boolean" },
};

const adapterFor = (storage: Storage | null, namespace = "entry-1") =>
  createLocalStorageAdapter(
    { provider: "localStorage", config: {} },
    { namespace },
    () => storage,
  );

const seeded = (storage: Storage, records: unknown[]): void => {
  storage.setItem(dataStorageKey("entry-1", "todos"), JSON.stringify(records));
};

describe("localStorage adapter", () => {
  test("a missing key lists as an empty array — first visit is not an error", async () => {
    const adapter = adapterFor(fakeStorage());
    await adapter.initialize();
    expect(await adapter.list(resource)).toEqual([]);
  });

  test("create stores a record with a generated id under the namespaced key", async () => {
    const storage = fakeStorage();
    const adapter = adapterFor(storage);
    await adapter.initialize();
    const created = await adapter.create(resource, {
      title: "Buy milk",
      done: false,
    });
    expect(typeof created.id).toBe("string");
    expect(created.title).toBe("Buy milk");
    const stored = JSON.parse(
      storage.raw.get(dataStorageKey("entry-1", "todos")) as string,
    );
    expect(stored).toEqual([created]);
  });

  test("a custom storageKeyPrefix scopes the key (config plumbing)", async () => {
    const storage = fakeStorage();
    const adapter = createLocalStorageAdapter(
      { provider: "localStorage", config: { storageKeyPrefix: "my-app" } },
      { namespace: "entry-1" },
      () => storage,
    );
    await adapter.initialize();
    await adapter.create(resource, { title: "x", done: false });
    expect(storage.raw.has("my-app:entry-1:todos")).toBe(true);
  });

  test("a resource-level collection name overrides the key suffix", async () => {
    const storage = fakeStorage();
    const adapter = adapterFor(storage);
    await adapter.initialize();
    await adapter.create(
      { ...resource, collection: "shopping" },
      {
        title: "x",
        done: false,
      },
    );
    expect(storage.raw.has(dataStorageKey("entry-1", "shopping"))).toBe(true);
  });

  test("create validates against the resource schema", async () => {
    const adapter = adapterFor(fakeStorage());
    await adapter.initialize();
    await expect(
      adapter.create(resource, { done: true }),
    ).rejects.toMatchObject({ code: DATA_ERROR_CODES.invalidRecord });
    await expect(
      adapter.create(resource, { title: 7, done: false }),
    ).rejects.toMatchObject({ code: DATA_ERROR_CODES.invalidRecord });
  });

  test("update merges the patch into the record by id", async () => {
    const storage = fakeStorage();
    const adapter = adapterFor(storage);
    await adapter.initialize();
    const created = await adapter.create(resource, {
      title: "Buy milk",
      done: false,
    });
    const updated = await adapter.update(resource, created.id as string, {
      done: true,
    });
    expect(updated).toEqual({ ...created, done: true });
    expect(await adapter.list(resource)).toEqual([updated]);
  });

  test("update and delete of a missing id throw not_found", async () => {
    const adapter = adapterFor(fakeStorage());
    await adapter.initialize();
    await expect(
      adapter.update(resource, "ghost", { done: true }),
    ).rejects.toMatchObject({ code: DATA_ERROR_CODES.notFound });
    await expect(adapter.delete(resource, "ghost")).rejects.toMatchObject({
      code: DATA_ERROR_CODES.notFound,
    });
  });

  test("delete removes exactly the addressed record", async () => {
    const storage = fakeStorage();
    seeded(storage, [
      { id: "a", title: "a", done: false },
      { id: "b", title: "b", done: false },
    ]);
    const adapter = adapterFor(storage);
    await adapter.initialize();
    await adapter.delete(resource, "a");
    expect(await adapter.list(resource)).toEqual([
      { id: "b", title: "b", done: false },
    ]);
  });

  test("get returns the record or null", async () => {
    const storage = fakeStorage();
    seeded(storage, [{ id: "a", title: "a", done: false }]);
    const adapter = adapterFor(storage);
    await adapter.initialize();
    expect(await adapter.get(resource, "a")).toEqual({
      id: "a",
      title: "a",
      done: false,
    });
    expect(await adapter.get(resource, "ghost")).toBeNull();
  });

  test("malformed or non-array stored data is an error branch, not a crash", async () => {
    const storage = fakeStorage();
    storage.setItem(dataStorageKey("entry-1", "todos"), "{oops");
    const adapter = adapterFor(storage);
    await adapter.initialize();
    await expect(adapter.list(resource)).rejects.toMatchObject({
      code: DATA_ERROR_CODES.malformed,
    });
    storage.setItem(dataStorageKey("entry-1", "todos"), '{"not": "an array"}');
    await expect(adapter.list(resource)).rejects.toMatchObject({
      code: DATA_ERROR_CODES.malformed,
    });
  });

  test("a blocked/unavailable storage surfaces unavailable", async () => {
    const adapter = adapterFor(null);
    await adapter.initialize();
    await expect(adapter.list(resource)).rejects.toBeInstanceOf(DataError);
    await expect(adapter.list(resource)).rejects.toMatchObject({
      code: DATA_ERROR_CODES.unavailable,
    });
  });
});
