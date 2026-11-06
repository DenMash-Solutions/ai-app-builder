/**
 * data-component-ref expansion (plan 072, F22, decision 1) — the client
 * half of the marker contract: the model emits an EMPTY container
 * carrying the component id, and this module replaces it in place with
 * the real component through the same seams the picker uses
 * (`insertTemplate`: fresh keys + `data-template-id` provenance).
 *
 * Two phases (the host ui id only exists once the entry does):
 *  - Phase A — `expandComponentRefs` (pure): rewrites the spec and
 *    returns the install rows still to record. Runs in the completion
 *    pipeline AFTER validateDataSources and BEFORE the dangling-ref heal
 *    (072 decision 3), so a marker is never mistaken for a dangling ref
 *    and an expanded subtree still gets healed.
 *  - Phase B — `recordComponentInstalls`: called once the host entry
 *    exists (generate: right after createProjectEntry; edit: after the
 *    entry lookup), pinning each expansion like any other install.
 *
 * Resolution order (072 decision 7): catalog first — an install row makes
 * the copy pinnable/updatable (071 fan-out) — then saved templates
 * (provenance only, the existing template contract). Unknown ids are
 * dropped with a warning; the commit always proceeds.
 */
import type { Spec, UIElement } from "@json-render/core";
import type { CatalogAsset, CatalogAssetVersion } from "@/lib/catalog/catalog";
import { addCatalogInstall } from "@/lib/catalog/catalog";
import type { TemplateSubtree } from "@/lib/editor/templates";
import {
  findParentKey,
  insertTemplate,
  removeElement,
} from "@/lib/editor/structure";
import { COMPONENT_REF_PROP } from "@/lib/playground/catalog-rules";

export { COMPONENT_REF_PROP };

/** An install to record once the host entry exists (phase B). */
export interface PendingComponentInstall {
  assetId: string;
  versionId: string;
  targetKey: string;
}

export interface ComponentRefResolution {
  projectId: string | null;
  /** Catalog component id → usable asset + the version to pin (latest). */
  resolveCatalog?: (
    id: string,
  ) => { asset: CatalogAsset; version: CatalogAssetVersion } | null;
  /** Saved-template id → its subtree (fallback when not in the catalog). */
  resolveTemplate?: (id: string) => TemplateSubtree | null;
}

export interface ComponentRefExpansion {
  spec: Spec;
  installs: PendingComponentInstall[];
  dropped: string[];
}

function markerRef(element: UIElement): string | null {
  const raw = element.props?.[COMPONENT_REF_PROP];
  return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
}

/** Strip the marker prop, leaving the element otherwise untouched. */
function stripMarkerProp(spec: Spec, key: string): Spec {
  const element = spec.elements[key];
  if (!element) return spec;
  const props = { ...element.props };
  delete props[COMPONENT_REF_PROP];
  return {
    ...spec,
    elements: { ...spec.elements, [key]: { ...element, props } },
  };
}

/**
 * Expand every `data-component-ref` marker in place. Pure: no store
 * reads (resolution is injected) and no writes — installs come back as
 * pending rows for phase B. Markers the model put where they cannot be
 * replaced (spec root, a slot, or with children of their own) are
 * expanded INTO as a wrapper and the prop is stripped, so a marker can
 * never fire twice across completions.
 */
export function expandComponentRefs(
  spec: Spec,
  resolution: ComponentRefResolution,
): ComponentRefExpansion {
  const markerKeys = Object.keys(spec.elements).filter(
    (key) => markerRef(spec.elements[key]) !== null,
  );
  let current = spec;
  const installs: PendingComponentInstall[] = [];
  const dropped: string[] = [];

  for (const markerKey of markerKeys) {
    const marker = current.elements[markerKey];
    if (!marker) continue; // consumed by an earlier expansion — impossible today, defensive
    const ref = markerRef(marker);
    if (ref === null) continue;

    // Resolve first: an unknown id must never leave a live marker behind.
    let subtree: TemplateSubtree | null = null;
    let catalog: { asset: CatalogAsset; version: CatalogAssetVersion } | null =
      null;
    if (resolution.projectId !== null && resolution.resolveCatalog) {
      catalog = resolution.resolveCatalog(ref);
    }
    if (catalog) {
      subtree = {
        rootKey: catalog.version.spec.root,
        elements: catalog.version.spec.elements,
      };
    } else if (resolution.resolveTemplate) {
      subtree = resolution.resolveTemplate(ref);
    }

    const parentKey = findParentKey(current, markerKey);
    const children = parentKey
      ? (current.elements[parentKey]?.children ?? [])
      : [];
    const childIndex = parentKey ? children.indexOf(markerKey) : -1;
    const replaceable =
      parentKey !== null &&
      childIndex >= 0 &&
      (marker.children ?? []).length === 0 &&
      Object.keys(marker.slots ?? {}).length === 0;

    if (!subtree) {
      dropped.push(ref);
      console.warn(`[component-refs] dropped unknown component ref "${ref}"`);
      // Empty placeholder → gone; a wrapper position (slot/root/non-empty)
      // keeps its content and only loses the prop.
      if (replaceable) {
        const removed = removeElement(current, markerKey);
        if (removed) current = removed;
      } else {
        current = stripMarkerProp(current, markerKey);
      }
      continue;
    }

    if (replaceable) {
      const expanded = insertTemplate(current, {
        parentKey,
        subtree,
        templateId: catalog ? catalog.asset.id : ref,
        index: childIndex,
      });
      if (!expanded) {
        dropped.push(ref);
        console.warn(
          `[component-refs] could not expand component ref "${ref}" — marker removed`,
        );
        const removed = removeElement(current, markerKey);
        if (removed) current = removed;
        continue;
      }
      // Inserted at the marker's index, so removing the marker leaves the
      // expanded root exactly where the placeholder sat.
      const removed = removeElement(expanded.spec, markerKey);
      current = removed ?? expanded.spec;
      if (catalog) {
        installs.push({
          assetId: catalog.asset.id,
          versionId: catalog.version.id,
          targetKey: expanded.key,
        });
      }
      continue;
    }

    // Wrapper position: expand INTO the marker (it holds a slot, has
    // content of its own, or is the spec root) and strip the prop.
    const expanded = insertTemplate(current, {
      parentKey: markerKey,
      subtree,
      templateId: catalog ? catalog.asset.id : ref,
    });
    if (!expanded) {
      dropped.push(ref);
      console.warn(
        `[component-refs] could not expand component ref "${ref}" — marker kept as wrapper`,
      );
      current = stripMarkerProp(current, markerKey);
      continue;
    }
    current = stripMarkerProp(expanded.spec, markerKey);
    if (catalog) {
      installs.push({
        assetId: catalog.asset.id,
        versionId: catalog.version.id,
        targetKey: expanded.key,
      });
    }
  }

  return { spec: current, installs, dropped };
}

/**
 * Phase B: record the pending installs against the host entry. Best-effort
 * by design — a failed row logs and never blocks the committed screen
 * (the spec expansion already landed). Returns how many rows were written.
 */
export function recordComponentInstalls(
  pending: readonly PendingComponentInstall[],
  target: { hostUiId: string; projectId: string | null },
): number {
  if (pending.length === 0 || target.projectId === null) return 0;
  let recorded = 0;
  for (const install of pending) {
    const row = addCatalogInstall({
      projectId: target.projectId,
      assetId: install.assetId,
      versionId: install.versionId,
      targetUiId: target.hostUiId,
      targetKey: install.targetKey,
    });
    if (row) {
      recorded++;
    } else {
      console.warn(
        `[component-refs] install not recorded for asset ${install.assetId} (host ${target.hostUiId})`,
      );
    }
  }
  return recorded;
}

/** Union of two pending-install batches, deduped by asset + target key. */
export function mergePendingInstalls(
  a: readonly PendingComponentInstall[],
  b: readonly PendingComponentInstall[],
): PendingComponentInstall[] {
  const seen = new Set(a.map((row) => `${row.assetId}:${row.targetKey}`));
  const merged = [...a];
  for (const row of b) {
    const key = `${row.assetId}:${row.targetKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
  }
  return merged;
}
