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

describe("keyed data sources (Lane 2 proxy, plan 050)", () => {
  const keyedDef: DataSourceDef = {
    provider: "api",
    config: {
      baseUrl: "https://shop.example/v1",
      auth: { type: "bearer", ref: "shop" },
    },
  };
  const keyed = (fetchImpl: ApiFetch | null) =>
    createApiAdapter(keyedDef, context, () => fetchImpl);

  test("auth.ref rewrites requests to /api/data-proxy with {ref, path}", async () => {
    const { fetchImpl, calls } = fakeFetch(() => json([lamp]));
    const adapter = keyed(fetchImpl);
    await adapter.initialize();
    expect(await adapter.list(resource)).toEqual([lamp]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/data-proxy");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].body).toMatchObject({
      ref: "shop",
      path: "/v1/products",
      method: "GET",
    });
  });

  test("writes carry the inner record through the proxy body", async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      json({ ...lamp, id: "server-7" }, 201),
    );
    const adapter = keyed(fetchImpl);
    await adapter.initialize();
    await adapter.create(resource, { title: "Lamp", price: 10 });
    expect(calls[0].body).toMatchObject({
      ref: "shop",
      path: "/v1/products",
      method: "POST",
    });
    const inner = (calls[0].body as { body?: Record<string, unknown> }).body;
    expect(inner).toMatchObject({ title: "Lamp", price: 10 });
  });

  test("an unconfigured auth ref fails unavailable naming the ref", async () => {
    const { fetchImpl } = fakeFetch(() =>
      json({ error: "unknown_ref", ref: "shop" }, 404),
    );
    const adapter = keyed(fetchImpl);
    await adapter.initialize();
    await expect(adapter.list(resource)).rejects.toMatchObject({
      code: DATA_ERROR_CODES.unavailable,
      message: expect.stringContaining('auth ref "shop"'),
    });
  });

  test("a genuine upstream 404 through the proxy still reads as notFound", async () => {
    const { fetchImpl } = fakeFetch(() => json({ error: "nope" }, 404));
    const adapter = keyed(fetchImpl);
    await adapter.initialize();
    // Missing records stay null through the proxy (contract unchanged).
    expect(await adapter.get(resource, "ghost")).toBeNull();
    await expect(adapter.delete(resource, "ghost")).rejects.toMatchObject({
      code: DATA_ERROR_CODES.notFound,
    });
  });

  test("initialize rejects a malformed auth declaration (defense in depth)", async () => {
    const adapter = createApiAdapter(
      {
        provider: "api",
        config: {
          baseUrl: "https://shop.example",
          auth: { type: "bearer", ref: "shop", key: "sk-123" },
        },
      },
      context,
      () => null,
    );
    await expect(adapter.initialize()).rejects.toMatchObject({
      code: DATA_ERROR_CODES.malformed,
    });
  });

  test("keyless sources still fetch the absolute URL directly (Lane 1 regression)", async () => {
    const { fetchImpl, calls } = fakeFetch(() => json([lamp]));
    const adapter = createApiAdapter(def, context, () => fetchImpl);
    await adapter.initialize();
    await adapter.list(resource);
    expect(calls[0].url).toBe("https://shop.example/v1/products");
    expect(calls[0].method).toBe("GET");
  });
});

describe("itemDetail fan-out (per-row detail reads, plan 051)", () => {
  const pokedexBase = {
    provider: "api",
    config: {
      baseUrl: "https://pokeapi.example/api/v2",
      itemDetail: { path: "/pokemon/{id}" },
    },
  } as const;
  const pokedex: NamedResourceDef = {
    name: "pokemon",
    dataSource: "pokedex",
    collection: "pokemon",
  };
  // pokeapi list-row convention: no `id`, just name + a url carrying it.
  const row = (n: number) => ({
    name: `pkmn-${n}`,
    url: `https://pokeapi.example/api/v2/pokemon/${n}/`,
  });
  const detail = (n: number) => ({
    id: n,
    label: `Pokemon ${n}`,
    types: ["grass", "poison"],
    typeKey: "grass",
  });

  test("fans one detail read per row through the keyed proxy and merges", async () => {
    const { fetchImpl, calls } = fakeFetch((call) => {
      const path = (call.body as { path?: string }).path;
      if (path === "/api/v2/pokemon") return json([row(1), row(2)]);
      const id = Number(path?.split("/").pop());
      return json(detail(id));
    });
    const adapter = createApiAdapter(
      {
        ...pokedexBase,
        config: {
          ...pokedexBase.config,
          auth: { type: "bearer", ref: "pokedex" },
        },
      },
      context,
      () => fetchImpl,
    );
    await adapter.initialize();
    const rows = await adapter.list(pokedex);
    // 1 list + 2 detail reads — every request rode the keyed proxy.
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.url === "/api/data-proxy")).toBe(true);
    expect(
      calls.slice(1).map((c) => (c.body as { path: string }).path),
    ).toEqual(["/api/v2/pokemon/1", "/api/v2/pokemon/2"]);
    // Each row merged: base fields kept, detail fields added.
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ ...row(1), ...detail(1) });
    expect(rows[1]).toEqual({ ...row(2), ...detail(2) });
  });

  test("resolves the id from row.id first, else the last url segment", async () => {
    const { fetchImpl, calls } = fakeFetch((call) => {
      if (call.url === "https://pokeapi.example/api/v2/pokemon")
        return json([{ id: 7, name: "by-id" }, row(3)]);
      const id = Number(call.url.split("/").pop());
      return json(detail(id));
    });
    const adapter = createApiAdapter(pokedexBase, context, () => fetchImpl);
    await adapter.initialize();
    await adapter.list(pokedex);
    expect(
      calls.slice(1).map((c) => c.url.replace("https://pokeapi.example", "")),
    ).toEqual(["/api/v2/pokemon/7", "/api/v2/pokemon/3"]);
  });

  test("the detail wins on field collisions (merge order)", async () => {
    const { fetchImpl } = fakeFetch((call) => {
      if (call.url === "https://pokeapi.example/api/v2/pokemon")
        return json([{ ...row(1), label: "list-label" }]);
      return json({ ...detail(1), label: "detail-label" });
    });
    const adapter = createApiAdapter(pokedexBase, context, () => fetchImpl);
    await adapter.initialize();
    const rows = await adapter.list(pokedex);
    expect(rows[0].label).toBe("detail-label");
  });

  test("a failed detail degrades to the base row — the list still succeeds", async () => {
    const { fetchImpl } = fakeFetch((call) => {
      if (call.url === "https://pokeapi.example/api/v2/pokemon")
        return json([row(1), row(2)]);
      return call.url.endsWith("/1")
        ? json({ error: "boom" }, 500)
        : json(detail(2));
    });
    const adapter = createApiAdapter(pokedexBase, context, () => fetchImpl);
    await adapter.initialize();
    const rows = await adapter.list(pokedex);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(row(1)); // base row kept, no detail fields
    expect(rows[1]).toEqual({ ...row(2), ...detail(2) });
  });

  test("a non-object detail body and an unresolvable id both keep the base row", async () => {
    const { fetchImpl, calls } = fakeFetch((call) => {
      if (call.url === "https://pokeapi.example/api/v2/pokemon")
        return json([{ name: "no-url" }, { ...row(2), url: "" }, row(3)]);
      if (call.url.endsWith("/3")) return json("not-an-object");
      return json(detail(2));
    });
    const adapter = createApiAdapter(pokedexBase, context, () => fetchImpl);
    await adapter.initialize();
    const rows = await adapter.list(pokedex);
    expect(rows[0]).toEqual({ name: "no-url" }); // no id/url → base row
    expect(rows[1]).toEqual({ ...row(2), url: "" }); // empty url → base row
    expect(rows[2]).toEqual(row(3)); // scalar detail → base row
    // Only row 2 (id from its url) fired a detail read — rows 0/1 have no
    // resolvable id, row 3's read degraded after the request.
    expect(calls).toHaveLength(2);
  });

  test("keyless sources fan out direct (Lane 1 transport untouched)", async () => {
    const { fetchImpl, calls } = fakeFetch((call) => {
      if (call.url === "https://pokeapi.example/api/v2/pokemon")
        return json([row(1)]);
      return json(detail(1));
    });
    const adapter = createApiAdapter(pokedexBase, context, () => fetchImpl);
    await adapter.initialize();
    const rows = await adapter.list(pokedex);
    expect(calls.map((c) => c.url)).toEqual([
      "https://pokeapi.example/api/v2/pokemon",
      "https://pokeapi.example/api/v2/pokemon/1",
    ]);
    expect(rows[0]).toEqual({ ...row(1), ...detail(1) });
  });

  test("initialize rejects a malformed itemDetail (defense in depth)", async () => {
    for (const itemDetail of [{ path: "/pokemon" }, "nope", { path: 7 }]) {
      const adapter = createApiAdapter(
        {
          provider: "api",
          config: { baseUrl: "https://pokeapi.example", itemDetail },
        },
        context,
        () => null,
      );
      await expect(adapter.initialize()).rejects.toMatchObject({
        code: DATA_ERROR_CODES.malformed,
      });
    }
  });
});
