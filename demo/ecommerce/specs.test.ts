import { describe, expect, it } from "bun:test";
import { validateSpec } from "@json-render/core";
import type { Spec } from "@json-render/core";
import { validateDataSources } from "@/lib/data-sources/validate";
import type { DataSourcesSpec } from "@/lib/data-sources/types";
import customers from "./fixtures/customers.json";
import products from "./fixtures/products.json";
import cartItemV1 from "./components/cart-item.v1.spec.json";
import cartItemV2 from "./components/cart-item.v2.spec.json";
import cartSidebarV1 from "./components/cart-sidebar.v1.spec.json";
import cartSidebarV2 from "./components/cart-sidebar.v2.spec.json";
import checkoutSummaryV1 from "./components/checkout-summary.v1.spec.json";
import checkoutSummaryV2 from "./components/checkout-summary.v2.spec.json";
import navigationBarV1 from "./components/navigation-bar.v1.spec.json";
import navigationBarV2 from "./components/navigation-bar.v2.spec.json";
import priceDisplayV1 from "./components/price-display.v1.spec.json";
import priceDisplayV2 from "./components/price-display.v2.spec.json";
import productCardV1 from "./components/product-card.v1.spec.json";
import productCardV2 from "./components/product-card.v2.spec.json";
import productGridV1 from "./components/product-grid.v1.spec.json";
import productGridV2 from "./components/product-grid.v2.spec.json";
import cartSpec from "./screens/cart.spec.json";
import checkoutSpec from "./screens/checkout.spec.json";
import homeSpec from "./screens/home.spec.json";
import orderDetailsSpec from "./screens/order-details.spec.json";
import ordersSpec from "./screens/orders.spec.json";
import productDetailsSpec from "./screens/product-details.spec.json";
import productsSpec from "./screens/products.spec.json";

/**
 * Committed-seed validation (docs/plan/070-ecommerce-reference-demo, task 1):
 * every seed spec must satisfy BOTH seams it will meet in the app —
 * `validateSpec` (structural) and `validateDataSources({ inProject: true })`
 * (the 067 publish gate the go-live dialog runs) — plus the system contracts
 * the demo's e2e asserts: unique routes, the navbar slot on every screen,
 * and sidebar hosts seeding the state the installed components bind.
 * Precedent: `lib/specs/specs.test.ts`.
 */

// JSON imports widen to plain literals; the specs satisfy the shape.
const screens: Array<[string, Spec & { route?: string }]> = [
  ["home", homeSpec as unknown as Spec & { route?: string }],
  ["products", productsSpec as unknown as Spec & { route?: string }],
  [
    "product-details",
    productDetailsSpec as unknown as Spec & { route?: string },
  ],
  ["cart", cartSpec as unknown as Spec & { route?: string }],
  ["checkout", checkoutSpec as unknown as Spec & { route?: string }],
  ["orders", ordersSpec as unknown as Spec & { route?: string }],
  ["order-details", orderDetailsSpec as unknown as Spec & { route?: string }],
];

const componentVersions: Array<[string, Spec]> = [
  ["navigation-bar.v1", navigationBarV1 as unknown as Spec],
  ["navigation-bar.v2", navigationBarV2 as unknown as Spec],
  ["product-grid.v1", productGridV1 as unknown as Spec],
  ["product-grid.v2", productGridV2 as unknown as Spec],
  ["product-card.v1", productCardV1 as unknown as Spec],
  ["product-card.v2", productCardV2 as unknown as Spec],
  ["price-display.v1", priceDisplayV1 as unknown as Spec],
  ["price-display.v2", priceDisplayV2 as unknown as Spec],
  ["cart-item.v1", cartItemV1 as unknown as Spec],
  ["cart-item.v2", cartItemV2 as unknown as Spec],
  ["cart-sidebar.v1", cartSidebarV1 as unknown as Spec],
  ["cart-sidebar.v2", cartSidebarV2 as unknown as Spec],
  ["checkout-summary.v1", checkoutSummaryV1 as unknown as Spec],
  ["checkout-summary.v2", checkoutSummaryV2 as unknown as Spec],
];

const allSpecs: Array<[string, Spec]> = [...screens, ...componentVersions];

describe("ecommerce seed specs", () => {
  for (const [name, spec] of allSpecs) {
    it(`${name} is structurally valid`, () => {
      const { valid, issues } = validateSpec(spec);
      expect(issues).toEqual([]);
      expect(valid).toBe(true);
      expect(spec.root).toBeTruthy();
      expect(spec.elements[spec.root]).toBeTruthy();
    });

    it(`${name} passes the in-project data-source gate`, () => {
      const issues = validateDataSources(spec, { inProject: true });
      expect(issues).toEqual([]);
    });
  }

  it("detail screens declare distinct routes", () => {
    const routes = screens
      .map(([, spec]) => spec.route)
      .filter((route): route is string => route !== undefined);
    expect(routes).toHaveLength(6);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it("every screen carries the navbar slot and the cartList declaration", () => {
    for (const [name, spec] of screens) {
      expect(spec.elements["slot-navbar"], name).toBeTruthy();
      const blocks = spec as DataSourcesSpec;
      expect(blocks.resources?.cartItems, name).toBeTruthy();
      expect(blocks.queries?.cartList, name).toBeTruthy();
    }
  });

  it("sidebar hosts seed the state the installed components bind", () => {
    const sidebarHosts = ["home", "products", "product-details"];
    for (const [name, spec] of screens) {
      const state = (spec.state ?? {}) as Record<string, unknown>;
      const isSidebarHost = sidebarHosts.includes(name);
      expect(state.hasSidebar, name).toBe(isSidebarHost);
      if (isSidebarHost) expect(state.cartOpen, name).toBe(false);
    }
  });

  it("hosts that repeat over a mirror seed that mirror path as an array", () => {
    // validateSpec's repeat_state_mismatch guard: a spec that declares
    // `state` must seed every string repeat path with an array (mirrors are
    // manager-owned at runtime — the seed only satisfies validation and the
    // first paint; QueryLoader overwrites it on attach).
    for (const [name, spec] of screens) {
      if (spec.state === undefined) continue;
      for (const element of Object.values(spec.elements)) {
        const repeat = (element as { repeat?: { statePath?: unknown } }).repeat;
        if (typeof repeat?.statePath !== "string") continue;
        const segments = repeat.statePath.split("/").filter(Boolean);
        let value: unknown = spec.state;
        for (const segment of segments) {
          value =
            typeof value === "object" && value !== null
              ? (value as Record<string, unknown>)[segment]
              : undefined;
        }
        expect(Array.isArray(value), `${name} ${repeat.statePath}`).toBe(true);
      }
    }
  });
});

describe("ecommerce fixtures", () => {
  // The api adapter validates every read row against the resource schema —
  // one missing or mistyped field fails the whole query, so the fixtures
  // must satisfy exactly the fields the specs declare.
  const productSchema = {
    id: "string",
    name: "string",
    price: "number",
    onSale: "boolean",
    category: "string",
  } as const;
  const customerSchema = {
    id: "string",
    name: "string",
    email: "string",
    street: "string",
    city: "string",
    postal: "string",
    country: "string",
  } as const;

  it("every product row matches the declared products schema", () => {
    expect(products.length).toBeGreaterThanOrEqual(4);
    for (const row of products) {
      for (const [field, expected] of Object.entries(productSchema)) {
        expect(typeof (row as Record<string, unknown>)[field], field).toBe(
          expected,
        );
      }
    }
  });

  it("every customer row matches the declared customers schema", () => {
    expect(customers.length).toBeGreaterThan(0);
    for (const row of customers) {
      for (const [field, expected] of Object.entries(customerSchema)) {
        expect(typeof (row as Record<string, unknown>)[field], field).toBe(
          expected,
        );
      }
    }
  });

  it("onSale products carry a compareAt above their price", () => {
    for (const row of products.filter((product) => product.onSale)) {
      expect(typeof row.compareAt, row.id).toBe("number");
      expect(row.compareAt as number).toBeGreaterThan(row.price);
    }
  });
});
