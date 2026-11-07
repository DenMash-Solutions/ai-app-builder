/**
 * Project manifest (plan 073, decision 1): the payload a `project`
 * catalog asset's version carries — screen membership plus the slot map
 * of a template. It lives in the SAME `spec` jsonb column as
 * screen/component versions and is discriminated by the OWNING ASSET's
 * type; it is not renderable and must never reach a Renderer.
 *
 * Import direction is `catalog.ts → this module` (publish/create
 * validation), so this file stays import-free of `catalog.ts` — a cycle
 * would only buy a shared copy of the six-line spec shape check.
 */
import type { Spec } from "@json-render/core";

export interface ProjectManifest {
  screens: Array<{
    /** Display name (the template's screen label). */
    name: string;
    /** Membership route ("products/{id}") or null for route-less screens. */
    route: string | null;
    /** At most one screen flags home; install defaults to the first. */
    home?: boolean;
    /** Committed demo screen spec — `slot-*` element keys intact. */
    spec: Spec;
    /** Slot element key → component asset id (expanded at install). */
    slots?: Record<string, string>;
  }>;
  /** Component asset ids the template needs — the pins it adopts on install
   *  and F22 lists as project components. Every slot target must appear. */
  components: string[];
}

/** Mirrors `catalog.ts`'s private `isSpec` — the import direction above
 *  keeps the two copies independent on purpose. */
function isSpecShape(value: unknown): value is Spec {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Spec>;
  return (
    typeof candidate.root === "string" &&
    typeof candidate.elements === "object" &&
    candidate.elements !== null
  );
}

/**
 * Structural validation for a project manifest: non-empty screen list;
 * per screen a non-empty name, a `string | null` route, an optional
 * boolean home flag (at most ONE screen may claim it — install supplies
 * the first-screen default), a spec-shaped spec, and — when a `slots`
 * map is present — non-empty component ids whose element keys exist in
 * THAT screen's spec. A slot id must also be LISTED in `components`
 * (the adoption/pin set), which is unique and non-empty. Component-id
 * EXISTENCE in the catalog store is an installer concern (this
 * validator is pure).
 */
export function isProjectManifest(value: unknown): value is ProjectManifest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ProjectManifest>;
  const screens = candidate.screens;
  if (!Array.isArray(screens) || screens.length === 0) return false;
  const components = candidate.components;
  if (!Array.isArray(components) || components.length === 0) return false;
  const listed = new Set<string>();
  for (const id of components) {
    if (typeof id !== "string" || id === "") return false;
    if (listed.has(id)) return false; // a duplicate entry is a broken list
    listed.add(id);
  }
  let homes = 0;
  for (const entry of screens) {
    if (typeof entry !== "object" || entry === null) return false;
    const screen = entry as Partial<ProjectManifest["screens"][number]>;
    if (typeof screen.name !== "string" || screen.name.trim() === "")
      return false;
    if (screen.route !== null && typeof screen.route !== "string") return false;
    if (screen.home !== undefined) {
      if (typeof screen.home !== "boolean") return false;
      if (screen.home) homes += 1;
    }
    if (!isSpecShape(screen.spec)) return false;
    if (screen.slots !== undefined) {
      if (
        typeof screen.slots !== "object" ||
        screen.slots === null ||
        Array.isArray(screen.slots)
      )
        return false;
      for (const [key, componentId] of Object.entries(screen.slots)) {
        if (typeof componentId !== "string" || componentId === "") return false;
        if (!(key in screen.spec.elements)) return false;
        if (!listed.has(componentId)) return false;
      }
    }
  }
  return homes <= 1;
}
