/**
 * Component template library (plan 060): named snapshots of an element subtree
 * the visitor can re-insert anywhere. **Visitor-level** — one global library in
 * localStorage, shared across projects (project namespaces come later, F14).
 *
 * Copy-expand semantics (decided 2026-10-27): a template is an inert snapshot
 * (`{ rootKey, elements }` detached from the source spec at save time) that
 * `insertTemplate` expands with fresh keys; live-instance sync is deferred, so
 * the provenance stamp (`props["data-template-id"]`) is what ties an expanded
 * copy back to its template.
 *
 * Follows the `model-store.ts`/`device-preview.ts` module-store pattern:
 * `getServerTemplates()` returns the default so SSR/hydration never mismatches,
 * and localStorage is best-effort (quota/unavailable → library stays for the
 * session).
 */

import { subtreeKeys } from "@/lib/editor/structure";
import type { Spec } from "@json-render/core";

export const TEMPLATE_STORAGE_KEY = "genui-component-templates";

/** Detached copy of one element and its descendants, keyed independently of any spec. */
export interface TemplateSubtree {
  rootKey: string;
  elements: Spec["elements"];
}

export interface ComponentTemplate {
  id: string;
  name: string;
  createdAt: number;
  subtree: TemplateSubtree;
}

function isValidSubtree(value: unknown): value is TemplateSubtree {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<TemplateSubtree>;
  return (
    typeof candidate.rootKey === "string" &&
    typeof candidate.elements === "object" &&
    candidate.elements !== null &&
    Object.hasOwn(candidate.elements, candidate.rootKey)
  );
}

function isValidTemplate(value: unknown): value is ComponentTemplate {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ComponentTemplate>;
  return (
    typeof candidate.id === "string" &&
    candidate.id !== "" &&
    typeof candidate.name === "string" &&
    typeof candidate.createdAt === "number" &&
    isValidSubtree(candidate.subtree)
  );
}

/** Drop anything that doesn't parse as a template — corrupt entries never reach the UI. */
function sanitize(raw: unknown): ComponentTemplate[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidTemplate);
}

function readStored(): ComponentTemplate[] {
  try {
    const stored = window.localStorage.getItem(TEMPLATE_STORAGE_KEY);
    if (!stored) return [];
    return sanitize(JSON.parse(stored));
  } catch {
    // Unreadable/corrupt value — fall back to an empty library.
    return [];
  }
}

const listeners = new Set<() => void>();

let current: ComponentTemplate[] =
  typeof window === "undefined" ? [] : readStored();

/** Client snapshot for `useSyncExternalStore`. */
export function getTemplates(): ComponentTemplate[] {
  return current;
}

/** Server snapshot — the client re-renders with the stored library after hydration. */
export function getServerTemplates(): ComponentTemplate[] {
  return [];
}

export function subscribeTemplates(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function persist(): void {
  try {
    window.localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Quota exceeded or storage unavailable — library stays for this session.
  }
  for (const listener of listeners) listener();
}

/**
 * Snapshot `key`'s subtree (detached — later edits to the source spec never
 * affect the saved template) and add it to the library. Returns the stored
 * template, or `null` when the name is empty or the key is unknown.
 */
export function saveTemplate(
  name: string,
  spec: Spec,
  key: string,
): ComponentTemplate | null {
  const trimmed = name.trim();
  const source = spec.elements[key];
  if (trimmed === "" || !source) return null;

  const elements: Spec["elements"] = {};
  for (const member of subtreeKeys(spec, key)) {
    // A dangling child reference in the source stays dangling — skip it rather
    // than store `undefined` (the root is guaranteed present above).
    const memberElement = spec.elements[member];
    if (memberElement) elements[member] = structuredClone(memberElement);
  }

  const template: ComponentTemplate = {
    id: crypto.randomUUID(),
    name: trimmed,
    createdAt: Date.now(),
    subtree: { rootKey: key, elements },
  };
  current = [...current, template];
  persist();
  return template;
}

/** Rename a template. Empty names are rejected (no-op). */
export function renameTemplate(id: string, name: string): void {
  const trimmed = name.trim();
  const target = current.find((template) => template.id === id);
  if (trimmed === "" || !target || target.name === trimmed) return;
  current = current.map((template) =>
    template.id === id ? { ...template, name: trimmed } : template,
  );
  persist();
}

/** Remove a template from the library (already-inserted copies are untouched). */
export function removeTemplate(id: string): void {
  if (!current.some((template) => template.id === id)) return;
  current = current.filter((template) => template.id !== id);
  persist();
}
