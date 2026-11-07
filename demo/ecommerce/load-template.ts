/**
 * The ecommerce demo as a first-party project TEMPLATE (plan 073, P5): one
 * shared assembly of the committed screen specs, the component specs and the
 * slot mappings, used by the seed generator, its unit test and (optionally)
 * e2e. No spec is duplicated here — the JSON files stay the source of truth.
 *
 * Fixed ids keep the SQL seed idempotent and let a manifest reference its
 * components before either row exists. The product grid is seeded COMPOSED
 * with the product card: the card's slot lives inside the grid component, so
 * a screen-level slot map cannot reach it — composing at seed time gives the
 * template a working grid in one expansion.
 */
import type { Spec } from "@json-render/core";
import { insertTemplate } from "@/lib/editor/structure";
import { CATALOG_TYPES, CATALOG_VISIBILITIES } from "@/lib/catalog/catalog";
import type { ProjectManifest } from "@/lib/catalog/manifest";

import cartSpec from "./screens/cart.spec.json";
import checkoutSpec from "./screens/checkout.spec.json";
import homeSpec from "./screens/home.spec.json";
import orderDetailsSpec from "./screens/order-details.spec.json";
import ordersSpec from "./screens/orders.spec.json";
import productDetailsSpec from "./screens/product-details.spec.json";
import productsSpec from "./screens/products.spec.json";

import cartItem from "./components/cart-item.v2.spec.json";
import cartSidebar from "./components/cart-sidebar.v2.spec.json";
import checkoutSummary from "./components/checkout-summary.v2.spec.json";
import navigationBar from "./components/navigation-bar.v2.spec.json";
import priceDisplay from "./components/price-display.v2.spec.json";
import productCard from "./components/product-card.v2.spec.json";
import productGrid from "./components/product-grid.v2.spec.json";

/** Deterministic ids: `<group>-<slot>` so a row is findable by name too. */
export const TEMPLATE_IDS = {
  template: "b2400000-0000-4000-8000-000000000001",
  templateVersion: "b2400000-0000-4000-8000-000000000002",
  components: {
    grid: "b2400000-0000-4000-8000-00000000000a",
    card: "b2400000-0000-4000-8000-00000000000b",
    navbar: "b2400000-0000-4000-8000-00000000000c",
    sidebar: "b2400000-0000-4000-8000-00000000000d",
    price: "b2400000-0000-4000-8000-00000000000e",
    cartItem: "b2400000-0000-4000-8000-00000000000f",
    summary: "b2400000-0000-4000-8000-000000000010",
  },
  versions: {
    grid: "b2410000-0000-4000-8000-00000000000a",
    card: "b2410000-0000-4000-8000-00000000000b",
    navbar: "b2410000-0000-4000-8000-00000000000c",
    sidebar: "b2410000-0000-4000-8000-00000000000d",
    price: "b2410000-0000-4000-8000-00000000000e",
    cartItem: "b2410000-0000-4000-8000-00000000000f",
    summary: "b2410000-0000-4000-8000-000000000010",
  },
} as const;

export const TEMPLATE_NAME = "Ecommerce storefront";
export const TEMPLATE_DESCRIPTION =
  "A complete storefront — navigation, product grid and details, cart, checkout and order history, with local fixture data so it runs with no configuration.";

/** The product grid with the product card expanded into its nested slot. */
function composeGrid(): Spec {
  const grid = productGrid as unknown as Spec;
  const card = productCard as unknown as Spec;
  const composed = insertTemplate(grid, {
    parentKey: "slot-card",
    subtree: { rootKey: card.root, elements: card.elements },
    templateId: TEMPLATE_IDS.components.card,
  });
  if (!composed) {
    throw new Error("ecommerce template: product grid lost its slot-card slot");
  }
  return composed.spec;
}

export interface TemplateComponentSeed {
  id: string;
  versionId: string;
  name: string;
  description: string;
  spec: Spec;
}

export function ecommerceTemplateComponents(): TemplateComponentSeed[] {
  return [
    {
      id: TEMPLATE_IDS.components.navbar,
      versionId: TEMPLATE_IDS.versions.navbar,
      name: "Store navigation",
      description:
        "Top bar with Home, Products and Orders links plus the cart.",
      spec: navigationBar as unknown as Spec,
    },
    {
      id: TEMPLATE_IDS.components.grid,
      versionId: TEMPLATE_IDS.versions.grid,
      name: "Product grid",
      description: "Responsive product grid that repeats the storefront API.",
      spec: composeGrid(),
    },
    {
      id: TEMPLATE_IDS.components.card,
      versionId: TEMPLATE_IDS.versions.card,
      name: "Product card",
      description: "One product with price, sale badge, view and add buttons.",
      spec: productCard as unknown as Spec,
    },
    {
      id: TEMPLATE_IDS.components.sidebar,
      versionId: TEMPLATE_IDS.versions.sidebar,
      name: "Cart sidebar",
      description: "Slide-over cart with quantities, subtotal and checkout.",
      spec: cartSidebar as unknown as Spec,
    },
    {
      id: TEMPLATE_IDS.components.price,
      versionId: TEMPLATE_IDS.versions.price,
      name: "Price display",
      description: "Current price with a compare-at price and discount.",
      spec: priceDisplay as unknown as Spec,
    },
    {
      id: TEMPLATE_IDS.components.cartItem,
      versionId: TEMPLATE_IDS.versions.cartItem,
      name: "Cart item",
      description: "Cart row with quantity stepper, line total and remove.",
      spec: cartItem as unknown as Spec,
    },
    {
      id: TEMPLATE_IDS.components.summary,
      versionId: TEMPLATE_IDS.versions.summary,
      name: "Checkout summary",
      description: "Subtotal, shipping, tax and order total.",
      spec: checkoutSummary as unknown as Spec,
    },
  ];
}

/** Screens in navigation order; the first is the home screen. */
export function ecommerceTemplateManifest(): ProjectManifest {
  const screens: Array<{
    name: string;
    route: string | null;
    spec: Spec;
    slots: Record<string, string>;
  }> = [
    {
      name: "Home",
      route: null,
      spec: homeSpec as unknown as Spec,
      slots: {
        "slot-navbar": TEMPLATE_IDS.components.navbar,
        "slot-grid": TEMPLATE_IDS.components.grid,
        "slot-sidebar": TEMPLATE_IDS.components.sidebar,
      },
    },
    {
      name: "Products",
      route: (productsSpec as { route?: string }).route ?? null,
      spec: productsSpec as unknown as Spec,
      slots: {
        "slot-navbar": TEMPLATE_IDS.components.navbar,
        "slot-grid": TEMPLATE_IDS.components.grid,
        "slot-sidebar": TEMPLATE_IDS.components.sidebar,
      },
    },
    {
      name: "Product details",
      route: (productDetailsSpec as { route?: string }).route ?? null,
      spec: productDetailsSpec as unknown as Spec,
      slots: {
        "slot-navbar": TEMPLATE_IDS.components.navbar,
        "slot-price": TEMPLATE_IDS.components.price,
        "slot-sidebar": TEMPLATE_IDS.components.sidebar,
      },
    },
    {
      name: "Cart",
      route: (cartSpec as { route?: string }).route ?? null,
      spec: cartSpec as unknown as Spec,
      slots: {
        "slot-navbar": TEMPLATE_IDS.components.navbar,
        "slot-cart-item": TEMPLATE_IDS.components.cartItem,
      },
    },
    {
      name: "Checkout",
      route: (checkoutSpec as { route?: string }).route ?? null,
      spec: checkoutSpec as unknown as Spec,
      slots: {
        "slot-navbar": TEMPLATE_IDS.components.navbar,
        "slot-summary": TEMPLATE_IDS.components.summary,
      },
    },
    {
      name: "Orders",
      route: (ordersSpec as { route?: string }).route ?? null,
      spec: ordersSpec as unknown as Spec,
      slots: { "slot-navbar": TEMPLATE_IDS.components.navbar },
    },
    {
      name: "Order details",
      route: (orderDetailsSpec as { route?: string }).route ?? null,
      spec: orderDetailsSpec as unknown as Spec,
      slots: {
        "slot-navbar": TEMPLATE_IDS.components.navbar,
        "slot-price": TEMPLATE_IDS.components.price,
      },
    },
  ];

  return {
    screens: screens.map((screen, index) => ({
      name: screen.name,
      route: screen.route,
      ...(index === 0 ? { home: true } : {}),
      spec: screen.spec,
      slots: screen.slots,
    })),
    components: ecommerceTemplateComponents().map((component) => component.id),
  };
}

/** Asset + version rows the seed writes — one shape for SQL and tests. */
export function ecommerceTemplateSeed(): {
  asset: {
    id: string;
    name: string;
    description: string;
    type: string;
    visibility: string;
  };
  version: { id: string; spec: ProjectManifest };
  components: TemplateComponentSeed[];
} {
  return {
    asset: {
      id: TEMPLATE_IDS.template,
      name: TEMPLATE_NAME,
      description: TEMPLATE_DESCRIPTION,
      type: CATALOG_TYPES.project,
      visibility: CATALOG_VISIBILITIES.public,
    },
    version: {
      id: TEMPLATE_IDS.templateVersion,
      spec: ecommerceTemplateManifest(),
    },
    components: ecommerceTemplateComponents(),
  };
}
