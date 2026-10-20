import { http, HttpResponse } from "msw";
import { setupWorker } from "msw/browser";
import {
  MOCK_EDIT_LINES,
  MOCK_UI_LINES,
  type GenerateMockConfig,
} from "./fixture";

interface MockWindow {
  __GENERATE_MOCK__?: GenerateMockConfig;
  __GENERATE_CALLS__?: number;
  /** Prompt of the most recent intercepted /api/generate request. */
  __LAST_GENERATE_PROMPT__?: string;
  /** The most recent intercepted /api/data-proxy call (keyed lane, 050). */
  __LAST_PROXY__?: {
    ref: string;
    path: string;
    method: string;
    clientSentAuth: boolean;
  };
  /** Last non-GET proxy call — the post-mutation refresh re-GETs after
   *  every write, so the write itself needs its own slot. */
  __LAST_PROXY_WRITE__?: {
    ref: string;
    path: string;
    method: string;
    clientSentAuth: boolean;
  };
  __MSW_READY__?: boolean;
}

const mockWindow = window as unknown as MockWindow;

/** The public API's own store for the api-provider journeys (M3). */
let apiTodos: Array<{ id: string; title: string; done: boolean }> = [
  { id: "api-1", title: "Ship M3", done: false },
];

/** The KEYED API's store (Lane 2, 050) — reachable only through the proxy. */
let keyedTodos: Array<{ id: string; title: string; done: boolean }> = [
  { id: "key-1", title: "Keyed seed", done: false },
];

const worker = setupWorker(
  http.post("*/api/generate", async ({ request }) => {
    mockWindow.__GENERATE_CALLS__ = (mockWindow.__GENERATE_CALLS__ ?? 0) + 1;
    const config = mockWindow.__GENERATE_MOCK__ ?? {};

    const body = (await request.json().catch(() => ({}))) as {
      currentSpec?: { root?: string } | null;
      prompt?: string;
    };
    mockWindow.__LAST_GENERATE_PROMPT__ =
      typeof body.prompt === "string" ? body.prompt : "";

    if (config.delayMs && config.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, config.delayMs));
    }

    if (config.status && config.status >= 400) {
      return HttpResponse.json(config.body ?? { error: "Mock failure" }, {
        status: config.status,
      });
    }

    const isEdit =
      typeof body.currentSpec?.root === "string" &&
      body.currentSpec.root.length > 0;
    const lines = isEdit
      ? (config.editLines ?? MOCK_EDIT_LINES)
      : (config.lines ?? MOCK_UI_LINES);
    return new HttpResponse(`${lines.join("\n")}\n`, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }),
  // --- api-provider journeys (M3): in-memory public API on the app origin.
  // Module state = the API's own store; the browser-direct adapter fetches
  // these URLs and the MSW worker answers like any CORS-friendly server.
  http.get("*/api-public/todos", () => HttpResponse.json(apiTodos)),
  // Single-record reads — update() is read-modify-write and calls this first.
  http.get("*/api-public/todos/:id", ({ params }) => {
    const todo = apiTodos.find((item) => item.id === params.id);
    if (!todo) return HttpResponse.json({ error: "nope" }, { status: 404 });
    return HttpResponse.json(todo);
  }),
  http.post("*/api-public/todos", async ({ request }) => {
    const record = (await request.json()) as (typeof apiTodos)[number];
    apiTodos = [...apiTodos, record];
    return HttpResponse.json(record, { status: 201 });
  }),
  http.patch("*/api-public/todos/:id", async ({ request, params }) => {
    const index = apiTodos.findIndex((todo) => todo.id === params.id);
    if (index < 0) return HttpResponse.json({ error: "nope" }, { status: 404 });
    const patch = (await request.json()) as Partial<(typeof apiTodos)[number]>;
    apiTodos = apiTodos.map((todo, i) =>
      i === index ? { ...todo, ...patch } : todo,
    );
    return HttpResponse.json(apiTodos[index]);
  }),
  http.delete("*/api-public/todos/:id", ({ params }) => {
    apiTodos = apiTodos.filter((todo) => todo.id !== params.id);
    return new Response(null, { status: 204 });
  }),
  // The error-branch collection: always fails.
  http.get("*/api-public/failing", () =>
    HttpResponse.json({ error: "boom" }, { status: 500 }),
  ),
  // --- keyed API lane (050): the server proxy's stand-in. The browser POSTs
  // {ref, path, method, body} and NEVER a key; this handler plays the real
  // route's part — only the configured ref "weather" resolves, and the
  // store below is served exactly as the key-injecting origin would.
  http.post("*/api/data-proxy", async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as {
      ref?: unknown;
      path?: unknown;
      method?: unknown;
      body?: unknown;
    };
    const ref = typeof body.ref === "string" ? body.ref : "";
    const path = typeof body.path === "string" ? body.path : "";
    const method = typeof body.method === "string" ? body.method : "GET";
    const clientSentAuth =
      // Invariant the journey asserts: the client holds no credential —
      // any auth header riding this call would be a key leak.
      request.headers.get("authorization") !== null ||
      request.headers.get("x-api-key") !== null;
    const seen = { ref, path, method, clientSentAuth };
    mockWindow.__LAST_PROXY__ = seen;
    if (method !== "GET") mockWindow.__LAST_PROXY_WRITE__ = seen;
    if (ref !== "weather") {
      return HttpResponse.json({ error: "unknown_ref", ref }, { status: 404 });
    }
    const id = path.startsWith("/todos/") ? path.slice("/todos/".length) : null;
    if (method === "GET" && path === "/todos") {
      return HttpResponse.json(keyedTodos);
    }
    if (method === "GET" && id !== null) {
      const todo = keyedTodos.find((item) => item.id === id);
      return todo
        ? HttpResponse.json(todo)
        : HttpResponse.json({ error: "nope" }, { status: 404 });
    }
    if (method === "POST" && path === "/todos") {
      const record = body.body as (typeof keyedTodos)[number];
      keyedTodos = [...keyedTodos, record];
      return HttpResponse.json(record, { status: 201 });
    }
    if (method === "PATCH" && id !== null) {
      const patch = body.body as Partial<(typeof keyedTodos)[number]>;
      keyedTodos = keyedTodos.map((todo) =>
        todo.id === id ? { ...todo, ...patch } : todo,
      );
      return HttpResponse.json(keyedTodos.find((todo) => todo.id === id));
    }
    if (method === "DELETE" && id !== null) {
      keyedTodos = keyedTodos.filter((todo) => todo.id !== id);
      return new Response(null, { status: 204 });
    }
    return HttpResponse.json({ error: "nope" }, { status: 404 });
  }),
);

void worker
  .start({
    // "Frame" covers requests: anything without a registered handler (the
    // supabase host above all) bypasses the worker entirely and reaches
    // the network byte-identical — worker-level hand-off of cross-origin
    // responses strips their bodies (auth-js would see empty JSON), so
    // those requests must never enter a handler. The delay/fail
    // instrumentation for them lives in Playwright routing.
    onUnhandledFrame: "bypass",
  })
  .then(() => {
    mockWindow.__MSW_READY__ = true;
  })
  .catch((error: unknown) => {
    console.error("[msw] failed to start", error);
  });
