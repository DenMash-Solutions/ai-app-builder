import { describe, expect, test } from "bun:test";
import type { Spec } from "@json-render/core";
import { withDataBlocksFromLines } from "./stream-blocks";
import { withDataBlocks } from "./types";

/**
 * The recovery targets exactly what `useUIStream`'s `setSpecValue` drops:
 * root members other than /root, /state, /elements/*. The "streamed" base
 * specs below imitate its output (elements + state applied, blocks gone).
 */

const line = (path: string, value: unknown): string =>
  JSON.stringify({ op: "add", path, value });

const BLOCK_LINES = [
  line("/dataSources", {
    localTodos: { provider: "localStorage", config: {} },
  }),
  line("/resources", {
    todos: {
      dataSource: "localTodos",
      schema: { title: "string", done: "boolean" },
    },
  }),
  line("/queries", { todoList: { resource: "todos", operation: "list" } }),
];

describe("withDataBlocksFromLines", () => {
  test("recovers all three data blocks the stream applier dropped", () => {
    const streamed = {
      root: "todo-root",
      state: { newTodo: "" },
      elements: { "todo-root": { type: "Stack", props: {}, children: [] } },
    } as unknown as Spec;
    const recovered = withDataBlocks(
      withDataBlocksFromLines(streamed, BLOCK_LINES),
    );
    expect(recovered.dataSources).toEqual({
      localTodos: { provider: "localStorage", config: {} },
    });
    expect(recovered.resources).toEqual({
      todos: {
        dataSource: "localTodos",
        schema: { title: "string", done: "boolean" },
      },
    });
    expect(recovered.queries).toEqual({
      todoList: { resource: "todos", operation: "list" },
    });
    // Everything else keeps coming from the streamed spec.
    expect(recovered.root).toBe("todo-root");
    expect(recovered.state).toEqual({ newTodo: "" });
  });

  test("a stream without block lines returns the spec untouched (same identity)", () => {
    const streamed = {
      root: "p",
      elements: {},
      state: {},
    } as unknown as Spec;
    const lines = [line("/root", "p"), line("/state", { n: 1 })];
    expect(withDataBlocksFromLines(streamed, lines)).toBe(streamed);
  });

  test("steer: this stream's block edits merge over the base spec's blocks", () => {
    const base = {
      root: "p",
      elements: {},
      state: {},
      dataSources: { old: { provider: "localStorage", config: {} } },
      queries: { oldList: { resource: "old", operation: "list" } },
    } as unknown as Spec;
    const merged = withDataBlocks(
      withDataBlocksFromLines(base, [
        line("/resources", { todos: { dataSource: "old" } }),
      ]),
    );
    // Base blocks not touched by this stream survive…
    expect(merged.dataSources).toEqual({
      old: { provider: "localStorage", config: {} },
    });
    // …and this stream's block line wins.
    expect(merged.resources).toEqual({ todos: { dataSource: "old" } });
  });

  test("malformed lines are ignored, never thrown", () => {
    const streamed = { root: "p", elements: {} } as unknown as Spec;
    expect(withDataBlocksFromLines(streamed, ["{oops", "// comment"])).toBe(
      streamed,
    );
  });
});
