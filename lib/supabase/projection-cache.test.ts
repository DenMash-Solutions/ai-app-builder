import { describe, expect, test } from "bun:test";
import { projectionRestFetch, sanitizeTags } from "./projection-cache";

const BASE = "https://project.supabase.co/rest/v1";

function capture(): {
  fetchImpl: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>;
  calls: { url: string; init?: RequestInit }[];
} {
  const calls: { url: string; init?: RequestInit }[] = [];
  return {
    calls,
    fetchImpl: (input, init) => {
      calls.push({
        url: typeof input === "string" ? input : String(input),
        init,
      });
      return Promise.resolve(new Response("{}"));
    },
  };
}

describe("projectionRestFetch", () => {
  test("tags whitelisted GETs with force-cache + the table tag", async () => {
    const { fetchImpl, calls } = capture();
    await projectionRestFetch(
      `${BASE}/published_pages?select=slug,spec&eq(slug)=pokedex`,
      undefined,
      fetchImpl,
    );
    const next = (calls[0].init as { next?: Record<string, unknown> }).next;
    expect(next?.cache).toBe("force-cache");
    expect(next?.tags).toEqual(["published_pages"]);
    expect(next?.revalidate).toBe(60);

    await projectionRestFetch(`${BASE}/site_settings`, undefined, fetchImpl);
    const siteNext = (calls[1].init as { next?: Record<string, unknown> }).next;
    expect(siteNext?.tags).toEqual(["site_settings"]);
  });

  test("passes private tables through untouched (page_versions must never cache)", async () => {
    const { fetchImpl, calls } = capture();
    await projectionRestFetch(
      `${BASE}/page_versions?select=*`,
      undefined,
      fetchImpl,
    );
    await projectionRestFetch(
      `${BASE}/profiles?select=id`,
      undefined,
      fetchImpl,
    );
    expect(calls[0].init?.next).toBeUndefined();
    expect(calls[1].init?.next).toBeUndefined();
    expect(calls[1].init).toBeUndefined();
  });

  test("only GETs are tagged — writes pass through with their init", async () => {
    const { fetchImpl, calls } = capture();
    const init: RequestInit = { method: "POST", body: "{}" };
    await projectionRestFetch(`${BASE}/published_pages`, init, fetchImpl);
    expect(calls[0].init).toBe(init);
    expect(calls[0].init?.next).toBeUndefined();
  });

  test("non-REST and rpc URLs pass through", async () => {
    const { fetchImpl, calls } = capture();
    await projectionRestFetch(
      "https://api.example.com/data",
      undefined,
      fetchImpl,
    );
    await projectionRestFetch(`${BASE}/rpc/is_admin`, undefined, fetchImpl);
    expect(calls[0].init?.next).toBeUndefined();
    expect(calls[1].init?.next).toBeUndefined();
  });
});

describe("sanitizeTags", () => {
  test("keeps only known projection tags", () => {
    expect(sanitizeTags(["published_pages", "site_settings"])).toEqual([
      "published_pages",
      "site_settings",
    ]);
  });

  test("rejects unknown, non-string, and non-array input", () => {
    expect(sanitizeTags(["page_versions", "evil"])).toEqual([]);
    expect(sanitizeTags([42, null, { a: 1 }])).toEqual([]);
    expect(sanitizeTags("published_pages")).toEqual([]);
    expect(sanitizeTags(undefined)).toEqual([]);
    expect(sanitizeTags({ tags: ["published_pages"] })).toEqual([]);
  });
});
