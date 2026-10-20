import { describe, expect, test } from "bun:test";
import { dataProxyAuthHeaders, parseDataProxyRefs } from "./refs";

/** Minimal env surface — only the DATA_PROXY_* keys matter to the parser. */
const env = (pairs: Record<string, string>) => pairs;

describe("parseDataProxyRefs", () => {
  test("collects a complete ORIGIN/KEY pair (bearer default)", () => {
    const refs = parseDataProxyRefs(
      env({
        DATA_PROXY_WEATHER_ORIGIN: "https://api.example.com",
        DATA_PROXY_WEATHER_KEY: "k-123",
      }),
    );
    expect([...refs.keys()]).toEqual(["weather"]);
    expect(refs.get("weather")).toEqual({
      origin: "https://api.example.com",
      key: "k-123",
      headerName: null,
    });
  });

  test("multi-word env parts fold back into an underscore ref", () => {
    const refs = parseDataProxyRefs(
      env({
        DATA_PROXY_WEATHER_API_ORIGIN: "https://api.example.com",
        DATA_PROXY_WEATHER_API_KEY: "k",
      }),
    );
    expect(refs.has("weather_api")).toBe(true);
  });

  test("a custom HEADER env replaces the bearer default", () => {
    const refs = parseDataProxyRefs(
      env({
        DATA_PROXY_SHOP_ORIGIN: "https://shop.example",
        DATA_PROXY_SHOP_KEY: "k",
        DATA_PROXY_SHOP_HEADER: "X-Api-Key",
      }),
    );
    expect(refs.get("shop")?.headerName).toBe("X-Api-Key");
    expect(dataProxyAuthHeaders(refs.get("shop")!)).toEqual({
      "X-Api-Key": "k",
    });
  });

  test("bearer refs inject Authorization: Bearer <key>", () => {
    const refs = parseDataProxyRefs(
      env({
        DATA_PROXY_SHOP_ORIGIN: "https://shop.example",
        DATA_PROXY_SHOP_KEY: "k",
      }),
    );
    expect(dataProxyAuthHeaders(refs.get("shop")!)).toEqual({
      Authorization: "Bearer k",
    });
  });

  test("skips incomplete pairs (ORIGIN without KEY and vice versa)", () => {
    const refs = parseDataProxyRefs(
      env({
        DATA_PROXY_NO_KEY_ORIGIN: "https://b.example",
        DATA_PROXY_NO_ORIGIN_KEY: "k2",
      }),
    );
    expect(refs.has("no_key")).toBe(false);
    expect(refs.has("no_origin")).toBe(false);
  });

  test("skips origins that fail the URL policy or are not bare", () => {
    const refs = parseDataProxyRefs(
      env({
        // http on a public host
        DATA_PROXY_PLAIN_ORIGIN: "http://api.example.com",
        DATA_PROXY_PLAIN_KEY: "k",
        // path component
        DATA_PROXY_WITH_PATH_ORIGIN: "https://api.example.com/v1",
        DATA_PROXY_WITH_PATH_KEY: "k",
        // userinfo credential smuggling
        DATA_PROXY_USERINFO_ORIGIN: "https://user:pass@api.example.com",
        DATA_PROXY_USERINFO_KEY: "k",
        // private address literal
        DATA_PROXY_PRIVATE_ORIGIN: "https://192.168.1.10",
        DATA_PROXY_PRIVATE_KEY: "k",
        // localhost http is allowed (dev/e2e parity with baseUrl policy)
        DATA_PROXY_LOCAL_ORIGIN: "http://localhost:8080",
        DATA_PROXY_LOCAL_KEY: "k",
      }),
    );
    expect(refs.has("plain")).toBe(false);
    expect(refs.has("with_path")).toBe(false);
    expect(refs.has("userinfo")).toBe(false);
    expect(refs.has("private")).toBe(false);
    expect(refs.get("local")?.origin).toBe("http://localhost:8080");
  });

  test("skips a ref with an invalid custom header name", () => {
    const refs = parseDataProxyRefs(
      env({
        DATA_PROXY_SHOP_ORIGIN: "https://shop.example",
        DATA_PROXY_SHOP_KEY: "k",
        DATA_PROXY_SHOP_HEADER: "Bad Header!",
      }),
    );
    expect(refs.has("shop")).toBe(false);
  });

  test("ignores unrelated and empty env vars", () => {
    const refs = parseDataProxyRefs(
      env({
        DATA_PROXY_NOT_A_REF: "x",
        DATA_PROXY_ORIGIN: "https://a.example", // no ref part
        SOMETHING_ELSE: "y",
        DATA_PROXY_EMPTY_ORIGIN: "",
      }),
    );
    expect(refs.size).toBe(0);
  });
});
