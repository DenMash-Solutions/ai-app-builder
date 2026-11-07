/**
 * Pure composition for the marketplace surfaces (plan 073, decision 10): the
 * committed frames own the layout, these builders own the DATA — rows for the
 * browse grid and the detail summary. The interactive filtering itself is
 * spec-native (the D7 `$bindState` + `change` → `setState` + `$computed
 * filterItems` pipeline), so a builder run seeds the initial arrays only.
 *
 * Rows are shaped for the spec, not for React: `type` and `scope` are the
 * two facet fields the pipeline filters on (`filterItems` matches fields by
 * query text — an empty query is a pass-through), and `summary` is a
 * pre-rendered label so no spec-side string math is needed.
 */
import type { Spec } from "@json-render/core";
import {
  CATALOG_TYPES,
  isSpecPayload,
  type CatalogAsset,
  type CatalogAssetVersion,
} from "@/lib/catalog/catalog";
import { isProjectManifest } from "@/lib/catalog/manifest";

/** Card row the browse frame's grid repeats over. */
export interface CatalogCardRow {
  assetId: string;
  name: string;
  description: string;
  /** Asset type — the Type facet's filter field. */
  type: string;
  /** `mine` | `public` — the My-content facet's filter field. */
  scope: string;
  summary: string;
}

export interface CatalogCardLabels {
  template: string;
  screen: string;
  component: string;
  screensUnit: string;
}

export interface CatalogDetailModel {
  assetId: string;
  name: string;
  description: string;
  typeLabel: string;
  summary: string;
  screens: Array<{ name: string; route: string }>;
  screenCount: number;
  componentCount: number;
  empty: boolean;
}

const ROW_SCOPES = {
  mine: "mine",
  public: "public",
} as const;

function typeLabel(
  type: CatalogAsset["type"],
  labels: CatalogCardLabels,
): string {
  if (type === CATALOG_TYPES.project) return labels.template;
  if (type === CATALOG_TYPES.screen) return labels.screen;
  return labels.component;
}

/** A browse row for one asset, or null when its payload is unusable. */
export function catalogCardRow(
  asset: CatalogAsset,
  version: CatalogAssetVersion | null,
  ownerId: string,
  labels: CatalogCardLabels,
): CatalogCardRow | null {
  if (!version) return null;
  const mine = asset.ownerId === "" || asset.ownerId === ownerId;
  const label = typeLabel(asset.type, labels);

  if (asset.type === CATALOG_TYPES.project) {
    if (!isProjectManifest(version.spec)) return null;
    const count = version.spec.screens.length;
    return {
      assetId: asset.id,
      name: asset.name,
      description: asset.description ?? "",
      type: asset.type,
      scope: mine ? ROW_SCOPES.mine : ROW_SCOPES.public,
      summary: `${label} · ${count} ${labels.screensUnit}`,
    };
  }
  if (!isSpecPayload(version.spec)) return null;
  return {
    assetId: asset.id,
    name: asset.name,
    description: asset.description ?? "",
    type: asset.type,
    scope: mine ? ROW_SCOPES.mine : ROW_SCOPES.public,
    summary: label,
  };
}

/** Detail summary for one asset — the screen list a template installs. */
export function catalogDetailModel(
  asset: CatalogAsset,
  version: CatalogAssetVersion | null,
  labels: CatalogCardLabels,
): CatalogDetailModel | null {
  const row = catalogCardRow(asset, version, asset.ownerId, labels);
  if (!row || !version) return null;
  if (asset.type === CATALOG_TYPES.project) {
    if (!isProjectManifest(version.spec)) return null;
    const screens = version.spec.screens.map((screen) => ({
      name: screen.name,
      route: screen.route ?? "—",
    }));
    return {
      assetId: asset.id,
      name: asset.name,
      description: asset.description ?? "",
      typeLabel: typeLabel(asset.type, labels),
      summary: row.summary,
      screens,
      screenCount: screens.length,
      componentCount: version.spec.components.length,
      empty: false,
    };
  }
  return {
    assetId: asset.id,
    name: asset.name,
    description: asset.description ?? "",
    typeLabel: typeLabel(asset.type, labels),
    summary: row.summary,
    screens: [],
    screenCount: 0,
    componentCount: 0,
    empty: false,
  };
}

/** Seeds the browse frame's data (grid rows + the pass-through stages). */
export function buildCatalogSpec(base: Spec, rows: CatalogCardRow[]): Spec {
  const state = base.state ?? {};
  return {
    ...base,
    state: {
      ...state,
      catalog: {
        ...((state.catalog as Record<string, unknown> | undefined) ?? {}),
        query: "",
        type: "",
        scope: "",
        items: rows,
        stageSearch: rows,
        stageType: rows,
        visible: rows,
        empty: rows.length === 0,
      },
    },
  } as Spec;
}

/** Seeds the detail frame's data (header, summary and screen list). */
export function buildCatalogDetailSpec(
  base: Spec,
  detail: CatalogDetailModel,
): Spec {
  const state = base.state ?? {};
  return {
    ...base,
    state: {
      ...state,
      detail,
    },
  } as Spec;
}
