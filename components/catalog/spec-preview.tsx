"use client";

/**
 * `SpecPreview` (plan 073, decisions 9/10): the nested spec-render element
 * that makes live marketplace thumbnails possible — no upstream package
 * ships an embed element (verified 2026-11-06), so this is the app's own
 * implementation of "render a spec inside an element".
 *
 * Props are deliberately thin: the card passes an `assetId` and the Impl
 * resolves the LATEST version from the catalog store (`useSyncExternalStore`),
 * so a repeat item only needs one string and a later update/rollback moves
 * the thumbnail with the asset.
 *
 * The element renders at a fixed viewport (`width` × `height`, default
 * 1280×800) and is CSS-scaled into an exact `viewport × scale` box with
 * `pointer-events-none`: a decorative preview that can never steal focus,
 * scroll the page or run an action. Each nested render gets its own
 * `JSONUIProvider` + `QueryLoader` namespace, so local-storage data sources
 * never share state with the real playground.
 */
import { useMemo, useSyncExternalStore } from "react";
import type { BaseComponentProps } from "@json-render/react";
import { JSONUIProvider, Renderer } from "@json-render/react";
import type { Spec } from "@json-render/core";
import {
  CATALOG_TYPES,
  getCatalogState,
  getServerCatalog,
  isSpecPayload,
  subscribeCatalog,
} from "@/lib/catalog/catalog";
import type {
  CatalogAsset,
  CatalogAssetVersion,
  CatalogState,
} from "@/lib/catalog/catalog";
import { isProjectManifest } from "@/lib/catalog/manifest";
import type { ProjectManifest } from "@/lib/catalog/manifest";
import { insertTemplate } from "@/lib/editor/structure";
import { QueryLoader } from "@/components/data-sources/query-loader";
import { useRuntimeClasses } from "@/components/playground/use-runtime-classes";
import { appDirectives } from "@/lib/computed/directives";
import { PLAYGROUND_FUNCTIONS } from "@/lib/playground/computed-functions";
import { registry } from "@/lib/playground/registry";

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;
const DEFAULT_SCALE = 0.25;

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

/** Latest version of `asset`, only when its payload matches the type rule. */
function latestVersionOf(
  asset: CatalogAsset,
  state: CatalogState,
): CatalogAssetVersion | null {
  if (!asset.latestVersionId) return null;
  const version = state.versions.find(
    (row) => row.id === asset.latestVersionId,
  );
  if (!version) return null;
  const valid =
    asset.type === CATALOG_TYPES.project
      ? isProjectManifest(version.spec)
      : isSpecPayload(version.spec);
  return valid ? version : null;
}

/**
 * Compose a template screen for DISPLAY ONLY: each `slots` mapping expands
 * the referenced component's latest spec into the placeholder (fresh keys +
 * provenance, the picker's own seam). A missing component is skipped — a
 * partial thumbnail is still a thumbnail.
 */
function composeScreen(
  screen: ProjectManifest["screens"][number],
  state: CatalogState,
): Spec {
  let spec: Spec = structuredClone(screen.spec);
  for (const [slotKey, assetId] of Object.entries(screen.slots ?? {})) {
    const asset = state.assets.find((row) => row.id === assetId);
    if (!asset) continue;
    const version = latestVersionOf(asset, state);
    if (!version || !isSpecPayload(version.spec)) continue;
    const expanded = insertTemplate(spec, {
      parentKey: slotKey,
      subtree: {
        rootKey: version.spec.root,
        elements: version.spec.elements,
      },
      templateId: assetId,
    });
    if (expanded) spec = expanded.spec;
  }
  return spec;
}

/** The spec a card should render for `assetId`, or null when unavailable. */
function previewSpecFor(
  assetId: string,
  state: CatalogState,
): { spec: Spec; namespace: string } | null {
  const asset = state.assets.find((row) => row.id === assetId);
  if (!asset) return null;
  const version = latestVersionOf(asset, state);
  if (!version) return null;
  if (asset.type === CATALOG_TYPES.project) {
    const manifest = version.spec as ProjectManifest;
    const screen =
      manifest.screens.find((entry) => entry.home === true) ??
      manifest.screens[0];
    if (!screen) return null;
    return {
      spec: composeScreen(screen, state),
      namespace: `catalog-preview-${assetId}-${screen.name}`,
    };
  }
  if (!isSpecPayload(version.spec)) return null;
  return { spec: version.spec, namespace: `catalog-preview-${assetId}` };
}

export function SpecPreviewImpl({
  props,
}: BaseComponentProps<Record<string, unknown>>) {
  const assetId = typeof props.assetId === "string" ? props.assetId : "";
  const state = useSyncExternalStore(
    subscribeCatalog,
    getCatalogState,
    getServerCatalog,
  );
  const preview = useMemo(
    () => previewSpecFor(assetId, state),
    [assetId, state],
  );
  useRuntimeClasses(preview?.spec);

  const width = positiveNumber(props.width, DEFAULT_WIDTH);
  const height = positiveNumber(props.height, DEFAULT_HEIGHT);
  const scale = positiveNumber(props.scale, DEFAULT_SCALE);
  const box = {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };

  return (
    <div
      aria-hidden="true"
      data-spec-preview={assetId}
      className="pointer-events-none relative overflow-hidden rounded-md border border-border bg-background select-none"
      style={box}
    >
      {preview ? (
        <div
          style={{
            width,
            height,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          {/* The nested provider is the whole point: an embedded spec gets
              its own state/actions/data runtime, never the host page's. */}
          <JSONUIProvider
            registry={registry}
            initialState={{ ...(preview.spec.state ?? {}) }}
            handlers={{}}
            validationFunctions={{}}
            functions={PLAYGROUND_FUNCTIONS}
            directives={appDirectives}
          >
            <QueryLoader spec={preview.spec} namespace={preview.namespace} />
            <Renderer spec={preview.spec} registry={registry} />
          </JSONUIProvider>
        </div>
      ) : (
        <div className="flex size-full items-center justify-center bg-muted/40" />
      )}
    </div>
  );
}
