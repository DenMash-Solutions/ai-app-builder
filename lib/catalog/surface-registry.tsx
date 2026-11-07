"use client";

/**
 * Registry for the marketplace surface catalog (plan 073, decision 10): the
 * playground's renderers plus the nested `SpecPreview` element. The two
 * custom actions are inert here — `<CatalogActions>` registers the real
 * handlers at runtime inside the provider tree (the admin-actions
 * precedent), so an unhandled press can never throw.
 */
import { defineRegistry } from "@json-render/react";
import type { Components } from "@json-render/react";
import { SpecPreviewImpl } from "@/components/catalog/spec-preview";
import { playgroundComponentImpls } from "@/lib/playground/registry";
import { CATALOG_ACTIONS, catalogSurfaceCatalog } from "@/lib/catalog/surface";

const components = {
  ...playgroundComponentImpls,
  SpecPreview: SpecPreviewImpl,
} as unknown as Components<typeof catalogSurfaceCatalog>;

const { registry: marketplaceRegistry } = defineRegistry(
  catalogSurfaceCatalog,
  {
    components,
    actions: {
      [CATALOG_ACTIONS.open]: async () => {},
      [CATALOG_ACTIONS.preview]: async () => {},
      [CATALOG_ACTIONS.use]: async () => {},
      [CATALOG_ACTIONS.back]: async () => {},
    },
  },
);

export { marketplaceRegistry };
