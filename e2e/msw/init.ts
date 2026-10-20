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
  __MSW_READY__?: boolean;
}

const mockWindow = window as unknown as MockWindow;

/** The public API's own store for the api-provider journeys (M3). */
let apiTodos: Array<{ id: string; title: string; done: boolean }> = [
  { id: "api-1", title: "Ship M3", done: false },
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
