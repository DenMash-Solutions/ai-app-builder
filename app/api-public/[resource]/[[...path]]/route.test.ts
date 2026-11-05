import { describe, expect, test } from "bun:test";
import { GET } from "@/app/api-public/[resource]/[[...path]]/route";
import products from "@/demo/ecommerce/fixtures/products.json";

/**
 * Route-level tests for the committed fixture API (docs/plan/070-ecommerce-
 * reference-demo, decision 5): list/get shapes the api adapter builds, the
 * allowlist, and the 404s. No network — the route reads local JSON.
 */

const call = (resource: string, path?: string[]): Promise<Response> =>
  GET(new Request(`http://localhost:3000/api-public/${resource}`), {
    params: Promise.resolve({ resource, path }),
  });

describe("api-public fixture route", () => {
  test("serves the products list", async () => {
    const response = await call("products");
    expect(response.status).toBe(200);
    const rows = (await response.json()) as Array<{ id: string }>;
    expect(rows).toHaveLength(products.length);
    expect(rows[0]?.id).toBe(products[0]?.id);
  });

  test("serves one product by id (the get operation's URL shape)", async () => {
    const response = await call("products", ["linen-tote"]);
    expect(response.status).toBe(200);
    const row = (await response.json()) as { id: string; name: string };
    expect(row.id).toBe("linen-tote");
    expect(row.name).toBe("Linen Tote");
  });

  test("serves the customers list", async () => {
    const response = await call("customers");
    expect(response.status).toBe(200);
    const rows = (await response.json()) as Array<{ id: string }>;
    expect(rows.length).toBeGreaterThan(0);
  });

  test("404s an unknown resource (allowlist)", async () => {
    const response = await call("orders");
    expect(response.status).toBe(404);
  });

  test("404s an unknown id", async () => {
    const response = await call("products", ["no-such-product"]);
    expect(response.status).toBe(404);
  });

  test("404s extra path segments", async () => {
    const response = await call("products", ["linen-tote", "reviews"]);
    expect(response.status).toBe(404);
  });
});
