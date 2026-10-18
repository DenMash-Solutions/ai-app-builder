import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { JSONUIProvider, Renderer } from "@json-render/react";
import { registry } from "@/lib/playground/registry";
import { QUERY_STATUSES } from "@/lib/data-sources/types";
import type { DataSourcesSpec, QueryMirror } from "@/lib/data-sources/types";

/**
 * Integration (plan T8/T9): the `/queries/<name>` mirror (D1) is ordinary
 * runtime state — repeat, `$item`, and `visible` bindings work unchanged
 * over it — and the spec's data blocks never act as the state source
 * (the mirror comes from the provider's initialState, which the query
 * manager writes through its channel).
 */

const spec = {
  root: "page",
  elements: {
    page: {
      type: "Stack",
      props: { direction: "vertical" },
      children: ["count", "loading", "empty", "error", "list"],
    },
    count: {
      type: "Text",
      props: { text: { $state: "/queries/todoList/count" } },
    },
    loading: {
      type: "Text",
      props: { text: "Loading todos…" },
      visible: { $state: "/queries/todoList/status", eq: "loading" },
    },
    empty: {
      type: "Text",
      props: { text: "No todos yet" },
      visible: [
        { $state: "/queries/todoList/count", eq: 0 },
        { $state: "/queries/todoList/status", eq: "success" },
      ],
    },
    error: {
      type: "Text",
      props: { text: "Todos are unavailable" },
      visible: { $state: "/queries/todoList/status", eq: "error" },
    },
    list: {
      type: "Stack",
      props: { direction: "vertical" },
      repeat: { statePath: "/queries/todoList/data", key: "id" },
      children: ["item"],
    },
    item: { type: "Text", props: { text: { $item: "title" } } },
  },
  // Present in the spec (D8: the manager reads it) — but never the state
  // source; see the initialState-driven assertions below.
  dataSources: { localTodos: { provider: "localStorage", config: {} } },
  resources: {
    todos: {
      dataSource: "localTodos",
      schema: { title: "string", done: "boolean" },
    },
  },
  queries: { todoList: { resource: "todos", operation: "list" } },
} as unknown as DataSourcesSpec;

const render = (mirror: QueryMirror): string =>
  renderToStaticMarkup(
    <JSONUIProvider
      registry={registry}
      initialState={{ queries: { todoList: mirror } }}
      handlers={{}}
      validationFunctions={{}}
    >
      <Renderer spec={spec} registry={registry} />
    </JSONUIProvider>,
  );

const mirror = (partial: Partial<QueryMirror>): QueryMirror => ({
  data: [],
  status: QUERY_STATUSES.idle,
  count: 0,
  error: null,
  ...partial,
});

describe("query mirror bindings (D1)", () => {
  test("success: repeat over the mirror renders every record via $item", () => {
    const html = render(
      mirror({
        status: QUERY_STATUSES.success,
        count: 2,
        data: [
          { id: "a", title: "Buy milk" },
          { id: "b", title: "Walk the dog" },
        ],
      }),
    );
    expect(html).toContain("Buy milk");
    expect(html).toContain("Walk the dog");
    // The count Text renders the mirror's count (no new $computed needed).
    expect(html).toContain("2");
    expect(html).not.toContain("Loading todos…");
    expect(html).not.toContain("No todos yet");
    expect(html).not.toContain("Todos are unavailable");
  });

  test("loading: only the loading branch renders", () => {
    const html = render(mirror({ status: QUERY_STATUSES.loading }));
    expect(html).toContain("Loading todos…");
    expect(html).not.toContain("No todos yet");
    expect(html).not.toContain("Todos are unavailable");
  });

  test("empty: the implicit AND (count 0 + success) renders the empty state", () => {
    const html = render(mirror({ status: QUERY_STATUSES.success, count: 0 }));
    expect(html).toContain("No todos yet");
    expect(html).not.toContain("Loading todos…");
  });

  test("error: the error branch renders the coded failure", () => {
    const html = render(
      mirror({
        status: QUERY_STATUSES.error,
        error: { code: "malformed", message: "Stored data is malformed." },
      }),
    );
    expect(html).toContain("Todos are unavailable");
    expect(html).not.toContain("Loading todos…");
    expect(html).not.toContain("No todos yet");
  });

  test("the spec's data blocks never substitute for runtime mirror state", () => {
    // No initialState mirror at all → idle default, no rows, no branches:
    // having /queries in the spec does NOT seed the state (T9).
    const html = renderToStaticMarkup(
      <JSONUIProvider
        registry={registry}
        initialState={{}}
        handlers={{}}
        validationFunctions={{}}
      >
        <Renderer spec={spec} registry={registry} />
      </JSONUIProvider>,
    );
    expect(html).not.toContain("Buy milk");
    expect(html).not.toContain("Loading todos…");
    expect(html).not.toContain("No todos yet");
  });
});
