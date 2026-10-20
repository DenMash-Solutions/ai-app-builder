import { describe, expect, test } from "bun:test";
import { checkApiBaseUrl, normalizeApiBaseUrl } from "./api-url";

describe("checkApiBaseUrl", () => {
  test("accepts public https origins, with or without a path", () => {
    expect(checkApiBaseUrl("https://api.example.com")).toBeNull();
    expect(checkApiBaseUrl("https://api.example.com/v1")).toBeNull();
    expect(checkApiBaseUrl("https://api.example.com/v1/")).toBeNull();
  });

  test("accepts plain http for localhost (development/e2e only)", () => {
    expect(checkApiBaseUrl("http://localhost:3000/api-public")).toBeNull();
    expect(checkApiBaseUrl("http://127.0.0.1:8080")).toBeNull();
  });

  test("rejects a missing, empty or non-string baseUrl", () => {
    expect(checkApiBaseUrl(undefined)).toContain('"baseUrl" string');
    expect(checkApiBaseUrl("")).toContain('"baseUrl" string');
    expect(checkApiBaseUrl(42)).toContain('"baseUrl" string');
  });

  test("rejects relative URLs", () => {
    expect(checkApiBaseUrl("/v1/products")).toContain("absolute URL");
  });

  test("rejects plain http outside localhost", () => {
    expect(checkApiBaseUrl("http://api.example.com")).toContain(
      "https for API baseUrls",
    );
  });

  test("rejects non-http(s) protocols", () => {
    expect(checkApiBaseUrl("ftp://api.example.com")).toContain("must be https");
    expect(checkApiBaseUrl("javascript:alert(1)")).toContain("must be https");
  });

  test("rejects userinfo, query strings and fragments", () => {
    expect(checkApiBaseUrl("https://user:pass@api.example.com")).toContain(
      "credentials",
    );
    expect(checkApiBaseUrl("https://api.example.com?key=sk-123")).toContain(
      "query string",
    );
    expect(checkApiBaseUrl("https://api.example.com/#frag")).toContain(
      "fragment",
    );
  });

  test("rejects literal private/link-local/metadata addresses", () => {
    const blocked = [
      "https://192.168.1.5",
      "https://10.0.0.1",
      "https://172.16.0.1",
      "https://172.31.255.255",
      "https://100.64.0.1",
      "https://169.254.169.254", // cloud metadata
      "https://0.0.0.0",
      "https://[fc00::1]",
      "https://[fe80::1]",
    ];
    for (const url of blocked) {
      expect(checkApiBaseUrl(url)).toMatch(/private\/link-local/);
    }
  });

  test("allows 172.32.x (outside the 172.16/12 private block)", () => {
    expect(checkApiBaseUrl("https://172.32.0.1")).toBeNull();
  });
});

describe("normalizeApiBaseUrl", () => {
  test("strips trailing slashes so paths compose cleanly", () => {
    expect(normalizeApiBaseUrl("https://api.example.com/v1/")).toBe(
      "https://api.example.com/v1",
    );
    expect(normalizeApiBaseUrl("https://api.example.com/v1///")).toBe(
      "https://api.example.com/v1",
    );
    expect(normalizeApiBaseUrl("https://api.example.com")).toBe(
      "https://api.example.com",
    );
  });
});
