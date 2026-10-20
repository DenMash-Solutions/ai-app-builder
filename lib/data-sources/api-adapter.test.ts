import { describe, expect, test } from "bun:test";
import { createApiAdapter } from "./api-adapter";
import type { ApiFetch } from "./api-adapter";
import { DATA_ERROR_CODES } from "./types";
import type { AdapterContext } from "./adapter";
import type { DataSourceDef, NamedResourceDef } from "./types";

/**
 * A fake `fetch` over scripted responses — the supabase adapter's
 * surface-mock pattern applied to HTTP. Each test records the exact
 * requests the adapter composed (URL, method, body) and returns the
 * canned Response, so CRUD tests exercise the real URL-building and
 * error-normalization logic without a network.
 */

const context: AdapterContext = { namespace: "entry-1" };
const def: DataSourceDef = {
  provider: "api",
  config: { baseUrl: "https://shop.example/v1/" },
};
const resource: NamedResourceDef = {
  name: "products",
  dataSource: "shop",
  collection: "products",
  schema: { title: "string", price: "number" },
};

type Call = { url: string; method: string; body: unknown };

type Handler = (call: Call) => Response | Promise<Response>;

const json = (body: unknown, status = 200): Response =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const fakeFetch = (handler: Handler) => {
  const calls: Call[] = [];
  const fetchImpl: ApiFetch = async (url, init = {}) => {
    const call: Call = {
      url,
      method: init.method ?? "GET",
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return handler(call);
  };
  return { fetchImpl, calls };
};

const ready = async (fetchImpl: ApiFetch | null, cfg = def.config) =>
  createApiAdapter({ ...def, config: cfg }, context, () => fetchImpl);

const lamp = { id: "p1", title: "Lamp", price: 10 };

describe("createApiAdapter", () => {
  test("initialize rejects an invalid baseUrl (defense in depth)", async () => {
    const adapter = createApiAdapter(
      { provider: "api", config: { baseUrl: "http://evil.example" } },
      context,
      () => null,
    );
    await expect(adapter.initialize()).rejects.toMatchObject({
      code: DATA_ERROR_CODES.malformed,
    });
  });

  test("initialize rejects a config without baseUrl", async () => {
    const adapter = createApiAdapter({ provider: "api" }, context, () => null);
    await expect(adapter.initialize()).rejects.toMatchObject({
      code: DATA_ERROR_CODES.malformed,
    });
  });

  test("list GETs the collection path under the normalized baseUrl", async () => {
    const { fetchImpl, calls } = fakeFetch(() => json([lamp]));
    const adapter = await ready(fetchImpl);
    await adapter.initialize();
    const rows = await adapter.list(resource);
    expect(rows).toEqual([lamp]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "https://shop.example/v1/products",
      method: "GET",
    });
  });

  test("list unwraps an enveloped response through itemsPath", async () => {
    const { fetchImpl } = fakeFetch(() => json({ data: [lamp] }));
    const adapter = await ready(fetchImpl, {
      baseUrl: "https://shop.example/v1",
      itemsPath: "/data",
    });
    await adapter.initialize();
    expect(await adapter.list(resource)).toEqual([lamp]);
  });

  test("list fails malformed when the envelope or array is missing", async () => {
    const missingEnvelope = fakeFetch(() => json({ rows: [lamp] }));
    const wrapped = await ready(missingEnvelope.fetchImpl, {
      baseUrl: "https://shop.example/v1",
      itemsPath: "/data",
    });
    await wrapped.initialize();
    await expect(wrapped.list(resource)).rejects.toMatchObject({
      code: DATA_ERROR_CODES.malformed,
    });

    const notArray = fakeFetch(() => json({ data: lamp }));
    const plain = await ready(notArray.fetchImpl);
    await plain.initialize();
    await expect(plain.list(resource)).rejects.toMatchObject({
      code: DATA_ERROR_CODES.malformed,
    });
  });

  test("create POSTs the record and prefers the API's echoed record", async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      json({ ...lamp, id: "server-7" }, 201),
    );
    const adapter = await ready(fetchImpl);
    await adapter.initialize();
    const created = await adapter.create(resource, {
      title: "Lamp",
      price: 10,
    });
    expect(created.id).toBe("server-7");
    expect(calls[0]).toMatchObject({
      url: "https://shop.example/v1/products",
      method: "POST",
    });
    expect(calls[0].body).toMatchObject({ title: "Lamp", price: 10 });
  });

  test("create falls back to the sent record on204/empty responses", async () => {
    const { fetchImpl } = fakeFetch(() => new Response(null, { status: 204 }));
    const adapter = await ready(fetchImpl);
    await adapter.initialize();
    const created = await adapter.create(resource, { title: "Mug", price: 4 });
    expect(created.title).toBe("Mug");
    expect(typeof created.id).toBe("string");
    expect(String(created.id).length).toBeGreaterThan(0);
  });

  test("update reads, merges, validates, then PATCHes the record", async () => {
    const { fetchImpl, calls } = fakeFetch((call) =>
      call.method === "GET" ? json(lamp) : json({ ...lamp, price: 12 }),
    );
    const adapter = await ready(fetchImpl);
    await adapter.initialize();
    const updated = await adapter.update(resource, "p1", { price: 12 });
    expect(updated).toEqual({ ...lamp, price: 12 });
    expect(calls.map((c) => c.method)).toEqual(["GET", "PATCH"]);
    expect(calls[1].url).toBe("https://shop.example/v1/products/p1");
    expect(calls[1].body).toEqual({ ...lamp, price: 12 });
  });

  test("update of a missing record fails notFound before any PATCH", async () => {
    const { fetchImpl, calls } = fakeFetch(() => json({ error: "nope" }, 404));
    const adapter = await ready(fetchImpl);
    await adapter.initialize();
    await expect(
      adapter.update(resource, "ghost", { price: 1 }),
    ).rejects.toMatchObject({ code: DATA_ERROR_CODES.notFound });
    expect(calls).toHaveLength(1); // only the read — nothing was written
  });

  test("get returns null on 404 (missing reads are not errors)", async () => {
    const { fetchImpl } = fakeFetch(() => json({ error: "nope" }, 404));
    const adapter = await ready(fetchImpl);
    await adapter.initialize();
    expect(await adapter.get(resource, "ghost")).toBeNull();
  });

  test("delete DELETEs the record and surfaces 404 as notFound", async () => {
    const ok = fakeFetch(() => json(null));
    const adapter = await ready(ok.fetchImpl);
    await adapter.initialize();
    await expect(adapter.delete(resource, "p1")).resolves.toBeUndefined();

    const missing = fakeFetch(() => json({ error: "nope" }, 404));
    const adapter2 = await ready(missing.fetchImpl);
    await adapter2.initialize();
    await expect(adapter2.delete(resource, "ghost")).rejects.toMatchObject({
      code: DATA_ERROR_CODES.notFound,
    });
  });

  test("HTTP failures normalize to shared DataError codes", async () => {
    const cases: Array<[number, string]> = [
      [401, DATA_ERROR_CODES.unavailable],
      [403, DATA_ERROR_CODES.unavailable],
      [429, DATA_ERROR_CODES.unavailable],
      [500, DATA_ERROR_CODES.unavailable],
      [400, DATA_ERROR_CODES.invalidRecord],
      [422, DATA_ERROR_CODES.invalidRecord],
      [418, DATA_ERROR_CODES.unknown],
    ];
    for (const [status, code] of cases) {
      const { fetchImpl } = fakeFetch(() => json({ error: "x" }, status));
      const adapter = await ready(fetchImpl);
      await adapter.initialize();
      await expect(adapter.list(resource)).rejects.toMatchObject({ code });
    }
  });

  test("network/CORS failures and timeouts become unavailable", async () => {
    const offline = fakeFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    const adapter = await ready(offline.fetchImpl);
    await adapter.initialize();
    await expect(adapter.list(resource)).rejects.toMatchObject({
      code: DATA_ERROR_CODES.unavailable,
      message: expect.stringContaining("network or CORS"),
    });

    const hung = fakeFetch(() => {
      throw new DOMException("timed out", "TimeoutError");
    });
    const adapter2 = await ready(hung.fetchImpl);
    await adapter2.initialize();
    await expect(adapter2.list(resource)).rejects.toMatchObject({
      code: DATA_ERROR_CODES.unavailable,
      message: expect.stringContaining("seconds"),
    });
  });

  test("non-JSON success bodies fail malformed", async () => {
    const { fetchImpl } = fakeFetch(
      () => new Response("<html>oops</html>", { status: 200 }),
    );
    const adapter = await ready(fetchImpl);
    await adapter.initialize();
    await expect(adapter.list(resource)).rejects.toMatchObject({
      code: DATA_ERROR_CODES.malformed,
    });
  });

  test("records are schema-validated on read (malformed upstream rows)", async () => {
    const { fetchImpl } = fakeFetch(() =>
      json([{ id: "p1", title: "Lamp", price: "ten" }]),
    );
    const adapter = await ready(fetchImpl);
    await adapter.initialize();
    await expect(adapter.list(resource)).rejects.toMatchObject({
      code: DATA_ERROR_CODES.invalidRecord,
    });
  });

  test("dispose releases the adapter (later use fails unavailable)", async () => {
    const { fetchImpl } = fakeFetch(() => json([lamp]));
    const adapter = await ready(fetchImpl);
    await adapter.initialize();
    await adapter.dispose();
    await expect(adapter.list(resource)).rejects.toMatchObject({
      code: DATA_ERROR_CODES.unavailable,
    });
  });
});
