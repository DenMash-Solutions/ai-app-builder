import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Spec } from "@json-render/core";
import { classifySpec } from "./bake";
import { bakeProjectEntryPoints, isStaticRoute } from "./bake-client";

/**
 * The project bake (plan 069 task 5): filters to static routes (decision 3),
 * bakes one `/api/tailwind` call per route sequentially (decision 22), and
 * posts the per-route artifacts keyed `(projectId, route, version)` — while
 * staying entirely best-effort, like the screen bake it mirrors.
 */

const globals = globalThis as { fetch?: unknown };
const originalFetch = globals.fetch;

interface Call {
  url: string;
  body: Record<string, unknown>;
}

let calls: Call[] = [];
/** Status the stub answers with, one per call, last repeats. */
let statuses: number[] = [];

function makeSpec(heading: string): Spec {
  return {
    root: "root",
    elements: { root: { type: "Card", props: { title: heading } } },
  };
}

beforeEach(() => {
  calls = [];
  statuses = [];
  globals.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<
      string,
      unknown
    >;
    const status = statuses.length > 0 ? (statuses.shift() ?? 200) : 200;
    calls.push({ url, body });
    return new Response(
      status === 200 && url.includes("tailwind")
        ? JSON.stringify({ css: ".stub-css{}" })
        : JSON.stringify({ ok: status < 400 }),
      { status, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
});

afterEach(() => {
  globals.fetch = originalFetch;
  statuses = [];
  calls = [];
});

const artifactsPosts = (): Call[] =>
  calls.filter((call) => call.url.includes("publish-artifacts"));
const tailwindCalls = (): Call[] =>
  calls.filter((call) => call.url.includes("tailwind"));

describe("isStaticRoute (decision 3: dynamic routes never bake)", () => {
  test("the home rung and literal patterns are static; {param} segments are not", () => {
    expect(isStaticRoute("")).toBe(true);
    expect(isStaticRoute("settings")).toBe(true);
    expect(isStaticRoute("items/{id}")).toBe(false);
  });
});

describe("bakeProjectEntryPoints", () => {
  test("bakes every static route once — one tailwind call each, sequential", async () => {
    const rows = [
      { route: "", spec: makeSpec("home"), version: 1 },
      { route: "settings", spec: makeSpec("settings"), version: 2 },
      { route: "items/{id}", spec: makeSpec("dynamic"), version: 3 },
    ];

    await bakeProjectEntryPoints("proj-1", rows);

    expect(artifactsPosts()).toHaveLength(2);
    expect(tailwindCalls()).toHaveLength(2);
    // The dynamic row never compiles nor persists (decision 3).
    expect(
      artifactsPosts().map((call) => [
        call.body.projectId,
        call.body.route,
        call.body.version,
      ]),
    ).toEqual([
      ["proj-1", "", 1],
      ["proj-1", "settings", 2],
    ]);
  });

  test("posts the per-tag artifact shape keyed to the route's version", async () => {
    const spec = makeSpec("home");

    await bakeProjectEntryPoints("proj-1", [{ route: "", spec, version: 7 }]);

    const post = artifactsPosts()[0];
    const artifacts = post.body.artifacts as Record<
      string,
      { html: string; css: string; kind: string; version: number }
    >;
    for (const entry of Object.values(artifacts)) {
      expect(entry.css).toBe(".stub-css{}");
      expect(entry.version).toBe(7);
      expect(entry.kind).toBe(classifySpec(spec));
      expect(typeof entry.html).toBe("string");
      expect(entry.html.length).toBeGreaterThan(0);
    }
  });

  test("a failing CSS compile skips that route without blocking the rest", async () => {
    statuses = [500, 200];

    await bakeProjectEntryPoints("proj-1", [
      { route: "a", spec: makeSpec("a"), version: 1 },
      { route: "b", spec: makeSpec("b"), version: 1 },
    ]);

    expect(tailwindCalls()).toHaveLength(2);
    expect(artifactsPosts().map((call) => call.body.route)).toEqual(["b"]);
  });

  test("a failing persist never throws, later routes still land", async () => {
    // Same default stub, but the second route's persist throws — the loop
    // stays best-effort: the throw is swallowed and route c still posts.
    // (The failing call is still logged — the record happens before the
    // throw.)
    globals.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = String(input instanceof Request ? input.url : input);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<
        string,
        unknown
      >;
      calls.push({ url, body });
      if (url.includes("publish-artifacts") && body.route === "b") {
        throw new Error("network down");
      }
      return url.includes("tailwind")
        ? new Response(JSON.stringify({ css: ".stub-css{}" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        : new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
    }) as typeof fetch;

    await bakeProjectEntryPoints("proj-1", [
      { route: "a", spec: makeSpec("a"), version: 1 },
      { route: "b", spec: makeSpec("b"), version: 1 },
      { route: "c", spec: makeSpec("c"), version: 1 },
    ]);

    expect(artifactsPosts().map((call) => call.body.route)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});
