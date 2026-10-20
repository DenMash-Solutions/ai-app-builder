import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  DATA_PROXY_MAX_RESPONSE_BYTES,
  POST,
} from "@/app/api/data-proxy/route";

/**
 * Route-level tests for the keyed-API proxy (docs/plan/050-keyed-api-lane):
 * the request surface is `{ ref, path, method?, body? }` and the security
 * invariants are origin-pairing (the client can never name a URL), key
 * redaction (the key appears in no response), and bounded upstream calls.
 * Env pairs are injected through process.env and the upstream through a
 * fetch stub — no network, no real secrets.
 */

const KEY = "sk-test-key-never-echoed";
const ORIGIN = "https://api.example.com";

const ORIGINAL_ENV = { ...process.env };
const originalFetch = globalThis.fetch;

let fetchCalls: Array<{ url: string; init: RequestInit }> = [];

const stubFetch = (
  handler: (call: {
    url: string;
    init: RequestInit;
  }) => Response | Promise<Response>,
) => {
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init: RequestInit = {},
  ) => {
    const call = { url: String(input), init };
    fetchCalls.push(call);
    return handler(call);
  }) as typeof fetch;
};

const upstreamJson = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const proxy = (body: unknown): Promise<Response> =>
  POST(
    new Request("http://localhost:3000/api/data-proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  fetchCalls = [];
  process.env = {
    ...ORIGINAL_ENV,
    DATA_PROXY_WEATHER_ORIGIN: ORIGIN,
    DATA_PROXY_WEATHER_KEY: KEY,
  };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  globalThis.fetch = originalFetch;
});

describe("POST /api/data-proxy", () => {
  test("a configured ref fetches the configured origin with the bearer key", async () => {
    stubFetch(() => upstreamJson([{ id: "f1" }]));
    const response = await proxy({ ref: "weather", path: "/v1/forecast" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ id: "f1" }]);
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe("https://api.example.com/v1/forecast");
    const init = fetchCalls[0].init;
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${KEY}`,
    );
    expect(init.redirect).toBe("error"); // no key-bearing redirect hops
  });

  test("a HEADER env pair injects the custom header instead of Bearer", async () => {
    process.env.DATA_PROXY_WEATHER_HEADER = "X-Api-Key";
    stubFetch(() => upstreamJson([]));
    await proxy({ ref: "weather", path: "/v1/forecast" });
    const headers = fetchCalls[0].init.headers as Record<string, string>;
    expect(headers["X-Api-Key"]).toBe(KEY);
    expect(headers.Authorization).toBeUndefined();
  });

  test("an unknown ref answers 404 unknown_ref and never fetches", async () => {
    stubFetch(() => upstreamJson([]));
    const response = await proxy({ ref: "unset", path: "/v1/forecast" });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "unknown_ref",
      ref: "unset",
    });
    expect(fetchCalls).toHaveLength(0);
  });

  test("an invalid env pair degrades the ref to unconfigured", async () => {
    process.env.DATA_PROXY_WEATHER_ORIGIN = "http://api.example.com"; // http → skipped
    stubFetch(() => upstreamJson([]));
    const response = await proxy({ ref: "weather", path: "/v1/forecast" });
    expect(response.status).toBe(404);
    expect(fetchCalls).toHaveLength(0);
  });

  test("paths that could leave the origin are refused before any fetch", async () => {
    stubFetch(() => upstreamJson([]));
    for (const path of [
      "//evil.example/steal", // scheme-relative
      "/\\evil.example", // backslash trick
      "https://evil.example/x", // absolute
      "v1/forecast", // relative
      "", // empty
    ]) {
      const response = await proxy({ ref: "weather", path });
      expect(response.status).toBe(400);
    }
    expect(fetchCalls).toHaveLength(0);
  });

  test("only CRUD verbs are forwarded", async () => {
    stubFetch(() => upstreamJson([]));
    for (const method of ["TRACE", "HEAD", "OPTIONS", 42]) {
      const response = await proxy({ ref: "weather", path: "/x", method });
      expect(response.status).toBe(400);
    }
    expect(fetchCalls).toHaveLength(0);
  });

  test("a write's JSON body and content type ride through", async () => {
    stubFetch(() => upstreamJson({ id: "f1" }, 201));
    const response = await proxy({
      ref: "weather",
      path: "/v1/forecast",
      method: "POST",
      body: { city: "Oslo" },
    });
    expect(response.status).toBe(201);
    const init = fetchCalls[0].init;
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ city: "Oslo" }));
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
  });

  test("a GET never carries a body", async () => {
    stubFetch(() => upstreamJson([]));
    await proxy({
      ref: "weather",
      path: "/v1/forecast",
      body: { smuggled: 1 },
    });
    expect(fetchCalls[0].init.body).toBeUndefined();
  });

  test("upstream statuses and bodies pass through untouched", async () => {
    stubFetch(() => upstreamJson({ error: "nope" }, 404));
    const response = await proxy({
      ref: "weather",
      path: "/v1/forecast/ghost",
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "nope" });
  });

  test("an unreachable upstream is 502 with no key anywhere in the body", async () => {
    stubFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    const response = await proxy({ ref: "weather", path: "/v1/forecast" });
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).toContain("upstream_unreachable");
    expect(text).not.toContain(KEY);
  });

  test("a timed-out upstream is 504", async () => {
    stubFetch(() => {
      throw new DOMException("timed out", "TimeoutError");
    });
    const response = await proxy({ ref: "weather", path: "/v1/forecast" });
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ error: "upstream_timeout" });
  });

  test("an oversized upstream response is refused with 502", async () => {
    stubFetch(
      () =>
        new Response("x".repeat(DATA_PROXY_MAX_RESPONSE_BYTES + 1), {
          status: 200,
        }),
    );
    const response = await proxy({ ref: "weather", path: "/v1/forecast" });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "upstream_too_large" });
  });

  test("non-JSON bodies and204s pass through as-is", async () => {
    stubFetch(() => new Response(null, { status: 204 }));
    const deleted = await proxy({
      ref: "weather",
      path: "/v1/forecast/f1",
      method: "DELETE",
    });
    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");
  });

  test("a malformed body or ref shape is a 400 before anything runs", async () => {
    stubFetch(() => upstreamJson([]));
    const notJson = await POST(
      new Request("http://localhost:3000/api/data-proxy", {
        method: "POST",
        body: "not json",
      }),
    );
    expect(notJson.status).toBe(400);
    const badRef = await proxy({ ref: "Weather!", path: "/x" });
    expect(badRef.status).toBe(400);
    expect(fetchCalls).toHaveLength(0);
  });
});
