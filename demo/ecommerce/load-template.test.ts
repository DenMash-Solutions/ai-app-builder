import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Spec } from "@json-render/core";
import { isProjectManifest } from "@/lib/catalog/manifest";
import {
  ecommerceTemplateManifest,
  ecommerceTemplateSeed,
  TEMPLATE_IDS,
} from "./load-template";

const SQL_PATH = resolve(import.meta.dir, "../../db/07_project_templates.sql");

describe("ecommerce template manifest (plan 073 P5)", () => {
  const manifest = ecommerceTemplateManifest();
  const seed = ecommerceTemplateSeed();

  test("carries seven screens with one home and the canonical routes", () => {
    expect(isProjectManifest(manifest)).toBe(true);
    expect(manifest.screens.map((screen) => screen.name)).toEqual([
      "Home",
      "Products",
      "Product details",
      "Cart",
      "Checkout",
      "Orders",
      "Order details",
    ]);
    expect(
      manifest.screens.filter((screen) => screen.home === true),
    ).toHaveLength(1);
    expect(manifest.screens[0].home).toBe(true);
    expect(manifest.screens.map((screen) => screen.route)).toEqual([
      null,
      "products",
      "products/{id}",
      "cart",
      "checkout",
      "orders",
      "orders/{id}",
    ]);
  });

  test("every slot key exists in its screen spec and every target is listed", () => {
    const listed = new Set(manifest.components);
    for (const screen of manifest.screens) {
      const spec = screen.spec as Spec;
      for (const [slotKey, assetId] of Object.entries(screen.slots ?? {})) {
        expect(spec.elements[slotKey]).toBeDefined();
        expect(listed.has(assetId)).toBe(true);
      }
    }
    // Every expandable component is a direct slot target — except the
    // product card, which lives inside the seeded grid (its own nested slot).
    const targets = new Set(
      manifest.screens.flatMap((screen) => Object.values(screen.slots ?? {})),
    );
    expect([...targets].sort()).toEqual(
      [
        TEMPLATE_IDS.components.cartItem,
        TEMPLATE_IDS.components.grid,
        TEMPLATE_IDS.components.navbar,
        TEMPLATE_IDS.components.price,
        TEMPLATE_IDS.components.sidebar,
        TEMPLATE_IDS.components.summary,
      ].sort(),
    );
    expect(targets.has(TEMPLATE_IDS.components.card)).toBe(false);
  });

  test("the seeded grid ships the product card already composed in", () => {
    const grid = seed.components.find(
      (component) => component.id === TEMPLATE_IDS.components.grid,
    )!;
    const spec = grid.spec;
    const slot = spec.elements["slot-card"];
    expect(slot.children).toHaveLength(1);
    const cardRoot = spec.elements[slot.children![0]];
    expect(cardRoot.props["data-template-id"]).toBe(
      TEMPLATE_IDS.components.card,
    );
  });

  test("asset rows use fixed ids and the template is public", () => {
    expect(seed.asset.id).toBe(TEMPLATE_IDS.template);
    expect(seed.asset.type).toBe("project");
    expect(seed.asset.visibility).toBe("public");
    expect(seed.version.id).toBe(TEMPLATE_IDS.templateVersion);
    expect(seed.components).toHaveLength(7);
  });

  test("the committed SQL seed matches the assembled data", () => {
    const sql = readFileSync(SQL_PATH, "utf8");
    for (const id of [
      TEMPLATE_IDS.template,
      TEMPLATE_IDS.templateVersion,
      ...Object.values(TEMPLATE_IDS.components),
      ...Object.values(TEMPLATE_IDS.versions),
    ]) {
      expect(sql).toContain(id);
    }
    expect(sql).toContain("on conflict (id) do nothing;");
    expect(sql).toContain("'project'");
    expect(sql.match(/^insert into/gm) ?? []).toHaveLength(16);
  });
});
