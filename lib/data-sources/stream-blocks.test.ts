import { describe, expect, test } from "bun:test";
import type { Spec } from "@json-render/core";
import { withRootBlocksFromLines } from "./stream-blocks";
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

describe("withRootBlocksFromLines", () => {
  test("recovers all three data blocks the stream applier dropped", () => {
    const streamed = {
      root: "todo-root",
      state: { newTodo: "" },
      elements: { "todo-root": { type: "Stack", props: {}, children: [] } },
    } as unknown as Spec;
    const recovered = withDataBlocks(
      withRootBlocksFromLines(streamed, BLOCK_LINES),
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

  // Plan 054: urlSync is a FOURTH extension member the stream applier
  // drops — a generated paged spec that declares it must keep it, or both
  // URL sync directions no-op (the live failure: the model correctly
  // emitted `add /urlSync ["page","limit"]` and the spec committed without
  // it, so ?page= deep links never restored and the URL never wrote back).
  test("recovers urlSync — a non-data root member the applier drops", () => {
    const streamed = {
      root: "pokedex",
      state: { page: 0, limit: 12 },
      elements: {},
    } as unknown as Spec;
    const recovered = withRootBlocksFromLines(streamed, [
      line("/urlSync", ["page", "limit"]),
    ]) as Spec & { urlSync?: string[] };
    expect(recovered.urlSync).toEqual(["page", "limit"]);
    // Renderer-owned members keep coming from the streamed spec, even when
    // the lines carry ops for them (the applier already applied those).
    expect(recovered.root).toBe("pokedex");
    expect(recovered.state).toEqual({ page: 0, limit: 12 });
  });

  test("never merges renderer-owned members that the lines also define", () => {
    const streamed = {
      root: "p",
      state: { page: 1 },
      elements: { a: { type: "Text", props: {}, children: [] } },
    } as unknown as Spec;
    const recovered = withRootBlocksFromLines(streamed, [
      line("/state", { page: 9 }),
      line("/elements", { b: { type: "Text", props: {}, children: [] } }),
      line("/urlSync", ["page"]),
    ]) as Spec & { urlSync?: string[] };
    // state/elements identity from the stream hook, not the re-fold.
    expect(recovered.state).toBe(streamed.state);
    expect(recovered.elements).toBe(streamed.elements);
    expect(recovered.urlSync).toEqual(["page"]);
  });

  test("a stream without block lines returns the spec untouched (same identity)", () => {
    const streamed = {
      root: "p",
      elements: {},
      state: {},
    } as unknown as Spec;
    const lines = [line("/root", "p"), line("/state", { n: 1 })];
    expect(withRootBlocksFromLines(streamed, lines)).toBe(streamed);
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
      withRootBlocksFromLines(base, [
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
    expect(withRootBlocksFromLines(streamed, ["{oops", "// comment"])).toBe(
      streamed,
    );
  });
});
