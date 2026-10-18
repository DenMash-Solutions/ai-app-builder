import { describe, expect, test } from "bun:test";
import { AdapterRegistry } from "./adapter-registry";
import { createLocalStorageAdapter } from "./local-storage-adapter";
import { DATA_ERROR_CODES, DATA_SOURCE_PROVIDERS, DataError } from "./types";
import type { AdapterContext, DataSourceAdapter } from "./adapter";
import type { DataSourceDef } from "./types";

const def: DataSourceDef = { provider: "localStorage", config: {} };
const context: AdapterContext = { namespace: "entry-1" };

const noopAdapter = (calls: { dispose: number }): DataSourceAdapter => ({
  provider: DATA_SOURCE_PROVIDERS.localStorage,
  capabilities: {
    list: true,
    get: true,
    create: true,
    update: true,
    delete: true,
  },
  initialize: async () => {},
  list: async () => [],
  get: async () => null,
  create: async (_resource, input) => input,
  update: async (_resource, _id, patch) => patch,
  delete: async () => {},
  dispose: async () => {
    calls.dispose += 1;
  },
});

describe("AdapterRegistry", () => {
  test("caches one adapter per (dataSource, namespace) pair", () => {
    const calls = { dispose: 0 };
    const factoryCalls: string[] = [];
    const registry = new AdapterRegistry({
      [DATA_SOURCE_PROVIDERS.localStorage]: (_def, ctx) => {
        factoryCalls.push(ctx.namespace);
        return noopAdapter(calls);
      },
    });
    const first = registry.get("localTodos", def, context);
    const again = registry.get("localTodos", def, context);
    const otherNamespace = registry.get("localTodos", def, {
      namespace: "entry-2",
    });
    expect(again).toBe(first);
    expect(otherNamespace).not.toBe(first);
    expect(factoryCalls).toEqual(["entry-1", "entry-2"]);
    expect(registry.size).toBe(2);
  });

  test("disposeNamespace disposes only that namespace's adapters", async () => {
    const calls = { dispose: 0 };
    const registry = new AdapterRegistry({
      [DATA_SOURCE_PROVIDERS.localStorage]: () => noopAdapter(calls),
    });
    registry.get("localTodos", def, context);
    registry.get("localTodos", def, { namespace: "entry-2" });
    registry.disposeNamespace("entry-1");
    await Promise.resolve();
    expect(calls.dispose).toBe(1);
    expect(registry.size).toBe(1);
  });

  test("an unknown provider throws a coded DataError", () => {
    const registry = new AdapterRegistry({});
    expect(() => registry.get("remote", def, context)).toThrow(DataError);
    try {
      registry.get("remote", def, context);
    } catch (error) {
      expect((error as DataError).code).toBe(DATA_ERROR_CODES.unknownProvider);
    }
  });

  test("the default registry maps the localStorage provider", () => {
    const storage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    } as unknown as Storage;
    const registry = new AdapterRegistry({
      [DATA_SOURCE_PROVIDERS.localStorage]: (d, ctx) =>
        createLocalStorageAdapter(d, ctx, () => storage),
    });
    expect(registry.get("localTodos", def, context).provider).toBe(
      DATA_SOURCE_PROVIDERS.localStorage,
    );
  });
});
