/**
 * Marketplace surface catalog (plan 073, decision 10): the committed
 * `catalog.spec.json` / `catalog-detail.spec.json` frames render against
 * their OWN catalog so the nested-render element (`SpecPreview`) can exist
 * without entering the playground's model vocabulary — `playgroundCatalog`
 * feeds `catalog.prompt()`, and a thumbnail element the model can neither
 * obtain an asset id for nor usefully emit would only be noise.
 *
 * Everything else is reused: the playground's component definitions (with
 * the shared STYLE_PROPS extension), its computed functions and the
 * `setState` house pattern. The two custom actions are declared here (typed
 * params) and their real handlers are registered at runtime by
 * `<CatalogActions>` (the admin-actions precedent).
 */
import { z } from "zod";
import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import {
  playgroundComponentDefinitions,
  STYLE_PROPS,
} from "@/lib/playground/catalog";
import { PLAYGROUND_FUNCTIONS } from "@/lib/playground/computed-functions";

export const CATALOG_ACTIONS = {
  /** Open an asset's detail page. */
  open: "catalog.open",
  /** Open the asset in a throwaway `Preview: …` project. */
  preview: "catalog.preview",
  /** Install the asset into a new project of its own. */
  use: "catalog.use",
  /** Back to the browse route. */
  back: "catalog.back",
} as const;

export type CatalogAction =
  (typeof CATALOG_ACTIONS)[keyof typeof CATALOG_ACTIONS];

/**
 * Decorative, non-interactive render of a catalog asset's latest version at
 * a fixed viewport, scaled into the card. A `project` asset renders its home
 * screen with the manifest's slot components composed in, so a template
 * thumbnail shows the assembled page rather than empty placeholders.
 */
const specPreviewDefinition = {
  props: z
    .object({
      assetId: z
        .string()
        .describe(
          "Catalog asset id — the thumbnail renders its latest version (a project asset renders its home screen with slots filled)",
        ),
      width: z
        .number()
        .nullable()
        .optional()
        .describe("Render viewport width in px (default 1280)"),
      height: z
        .number()
        .nullable()
        .optional()
        .describe("Render viewport height in px (default 800)"),
      scale: z
        .number()
        .nullable()
        .optional()
        .describe("CSS scale applied to the viewport (default 0.25)"),
    })
    .extend(STYLE_PROPS),
  description:
    "Read-only scaled render of a catalog asset for browse thumbnails. The box is the viewport times the scale; the render itself ignores pointer input.",
  events: [] as const,
  example: { assetId: "<asset-id>", scale: 0.25 },
};

export const catalogSurfaceCatalog = defineCatalog(schema, {
  components: {
    ...(playgroundComponentDefinitions as unknown as Record<string, unknown>),
    SpecPreview: specPreviewDefinition,
  } as unknown as typeof playgroundComponentDefinitions & {
    SpecPreview: typeof specPreviewDefinition;
  },
  functions: PLAYGROUND_FUNCTIONS,
  actions: {
    [CATALOG_ACTIONS.open]: {
      params: z.object({ assetId: z.string() }),
    },
    [CATALOG_ACTIONS.preview]: {
      params: z.object({ assetId: z.string() }),
    },
    [CATALOG_ACTIONS.use]: {
      params: z.object({ assetId: z.string() }),
    },
    [CATALOG_ACTIONS.back]: { params: z.object({}) },
  },
});
