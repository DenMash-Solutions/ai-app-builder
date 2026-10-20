import { describe, expect, test } from "bun:test";
import type { Spec } from "@json-render/core";
import { describeDataIssues, validateDataSources } from "./validate";
import type { DataSourcesSpec } from "./types";

const baseSpec: Spec = {
  root: "page",
  elements: {
    page: { type: "Stack", props: { direction: "vertical" }, children: [] },
  },
};

const withBlocks = (blocks: Partial<DataSourcesSpec>): Spec =>
  ({ ...baseSpec, ...blocks }) as Spec;

const goodBlocks: Partial<DataSourcesSpec> = {
  dataSources: { localTodos: { provider: "localStorage", config: {} } },
  resources: {
    todos: {
      dataSource: "localTodos",
      schema: { title: "string", done: "boolean" },
    },
  },
  queries: { todoList: { resource: "todos", operation: "list" } },
};

describe("validateDataSources", () => {
  test("a spec without data blocks is valid (the common case)", () => {
    expect(validateDataSources(baseSpec)).toEqual([]);
  });

  test("well-formed declarations with resolving references are valid", () => {
    expect(validateDataSources(withBlocks(goodBlocks))).toEqual([]);
  });

  test("flags a resource that references an unknown dataSource", () => {
    const issues = validateDataSources(
      withBlocks({
        resources: { todos: { dataSource: "missing" } },
      }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe("resources.todos.dataSource");
    expect(issues[0].message).toContain('Unknown dataSource "missing"');
    expect(issues[0].message).toContain("none"); // nothing declared
  });

  test("flags a query that references an unknown resource", () => {
    const issues = validateDataSources(
      withBlocks({
        dataSources: { localTodos: { provider: "localStorage" } },
        queries: { todoList: { resource: "ghost", operation: "list" } },
      }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe("queries.todoList.resource");
    expect(issues[0].message).toContain('Unknown resource "ghost"');
  });

  test("rejects credential-shaped config keys (specs never carry secrets)", () => {
    const issues = validateDataSources(
      withBlocks({
        dataSources: {
          remote: { provider: "localStorage", config: { apiKey: "sk-123" } },
        },
      }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe("dataSources.remote.config.apiKey");
    expect(issues[0].message).toContain("credential");
  });

  test("accepts the supabase provider with no config (M2 plan T4)", () => {
    const issues = validateDataSources(
      withBlocks({
        dataSources: { db: { provider: "supabase", config: {} } },
        resources: {
          todos: {
            dataSource: "db",
            schema: { title: "string", done: "boolean" },
          },
        },
        queries: { todoList: { resource: "todos", operation: "list" } },
      }),
    );
    expect(issues).toEqual([]);
  });

  test("rejects any config field on a supabase data source", () => {
    const issues = validateDataSources(
      withBlocks({
        dataSources: {
          db: { provider: "supabase", config: { storageKeyPrefix: "x" } },
        },
      }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe("dataSources.db.config");
    expect(issues[0].message).toContain("takes no config");
    expect(issues[0].message).toContain("RLS");
  });

  test("accepts an api data source with a validated https baseUrl", () => {
    const issues = validateDataSources(
      withBlocks({
        dataSources: {
          shop: {
            provider: "api",
            config: { baseUrl: "https://shop.example/v1", itemsPath: "/data" },
          },
        },
        resources: {
          products: { dataSource: "shop", schema: { title: "string" } },
        },
      }),
    );
    expect(issues).toEqual([]);
  });

  test("rejects an api data source without baseUrl", () => {
    const issues = validateDataSources(
      withBlocks({ dataSources: { shop: { provider: "api", config: {} } } }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe("dataSources.shop.config.baseUrl");
    expect(issues[0].message).toContain('"baseUrl"');
  });

  test("rejects http baseUrls outside localhost (api policy)", () => {
    const issues = validateDataSources(
      withBlocks({
        dataSources: {
          shop: { provider: "api", config: { baseUrl: "http://shop.example" } },
        },
      }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe("dataSources.shop.config.baseUrl");
    expect(issues[0].message).toContain("https");
  });

  test("rejects unexpected config keys on an api data source (headers/auth are Lane 2)", () => {
    const issues = validateDataSources(
      withBlocks({
        dataSources: {
          shop: {
            provider: "api",
            config: {
              baseUrl: "https://shop.example",
              headers: { "X-Key": "nope" },
            },
          },
        },
      }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe("dataSources.shop.config.headers");
    expect(issues[0].message).toContain('takes only "baseUrl" and "itemsPath"');
  });

  test("rejects a malformed itemsPath (must be a JSON pointer)", () => {
    const issues = validateDataSources(
      withBlocks({
        dataSources: {
          shop: {
            provider: "api",
            config: { baseUrl: "https://shop.example", itemsPath: "data" },
          },
        },
      }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe("dataSources.shop.config.itemsPath");
    expect(issues[0].message).toContain("JSON pointer");
  });

  test("localStorage keeps its provider-specific config keys", () => {
    const issues = validateDataSources(
      withBlocks({
        dataSources: {
          localTodos: {
            provider: "localStorage",
            config: { storageKeyPrefix: "my-app" },
          },
        },
      }),
    );
    expect(issues).toEqual([]);
  });

  test("rejects unsupported providers", () => {
    const issues = validateDataSources(
      withBlocks({
        dataSources: {
          // Intentionally invalid — the validator must reject it at runtime.
          remote: { provider: "postgres" as never },
        },
      }),
    );
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].path).toContain("dataSources.remote.provider");
  });

  test("flags non-object blocks with a shape hint", () => {
    const issues = validateDataSources(
      withBlocks({ queries: "todos" as never }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe("queries");
    expect(issues[0].message).toContain("must be an object");
  });
});

describe("describeDataIssues", () => {
  test("is empty for no issues", () => {
    expect(describeDataIssues([])).toBe("");
  });

  test("leads with the first issue and counts the rest", () => {
    const text = describeDataIssues([
      { path: "resources.todos.dataSource", message: "Unknown dataSource." },
      { path: "queries.a.resource", message: "Unknown resource." },
    ]);
    expect(text).toContain("resources.todos.dataSource: Unknown dataSource.");
    expect(text).toContain("+1 more issue");
  });
});
