import {
  availableLanguages,
  seedLocale,
  SPEC_STATE_KEYS,
} from "@/lib/i18n/spec-languages";
import type { Spec } from "@json-render/core";

/**
 * Editor content-language selection: a device-local override layered over the
 * spec's seed. The chosen tag drives the canvas merge, the EditPanel's resolved
 * values, and where copy edits are written (`state.copy` for the seed,
 * `state.i18n.<tag>` for any other language). Contract:
 * `docs/plan/038-spec-languages/convention.md` → "Editor semantics".
 */

export const GLOBAL_LANG_KEY = "genui-content-lang";
const perEntryKey = (entryId: string) => `genui-editor-lang:${entryId}`;

function safeRead(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * The persisted selection for an entry: per-entry first, then the global
 * default. `null` when the device has never chosen (→ the spec's seed).
 */
export function readPersistedContentLang(
  entryId: string | null,
): string | null {
  const global = safeRead(GLOBAL_LANG_KEY);
  if (entryId === null) return global;
  return safeRead(perEntryKey(entryId)) ?? global;
}

/** Persist the selection: global default + this entry's own override. */
export function writeContentLang(entryId: string | null, tag: string): void {
  try {
    window.localStorage.setItem(GLOBAL_LANG_KEY, tag);
    if (entryId !== null)
      window.localStorage.setItem(perEntryKey(entryId), tag);
  } catch {
    // Quota / private mode — selection stays for this session only.
  }
}

/**
 * Resolve the language the editor should open a spec in: the session
 * override wins, then the persisted selection, then the seed — each falling
 * through when absent from the spec (a stored tag from a since-edited spec
 * can go stale). Deterministic given device storage; safe to call while
 * computing render state (client-only: the canvas is never server-rendered).
 */
export function resolveContentLang(
  spec: Spec | null | undefined,
  entryId: string | null,
  override?: string | null,
): string {
  if (!spec) return "en";
  const seed = seedLocale(spec.state);
  const langs = availableLanguages(spec);
  const persisted = readPersistedContentLang(entryId);
  const candidates = [override, persisted, seed];
  for (const candidate of candidates) {
    if (candidate && langs.includes(candidate)) return candidate;
  }
  return seed;
}

const COPY_PREFIX = `/${SPEC_STATE_KEYS.copy}/`;

/**
 * Where a data-bound copy edit should land. Edits to a `/copy/*` path while a
 * NON-seed language is active are redirected to that language's `i18n` overlay
 * (`/i18n/<tag>/<key>`, create-if-missing at write time) so the seed stays
 * intact. Any other path — or a seed-language edit — writes as-is.
 */
export function copyWriteTarget(
  dataPath: string,
  activeLang: string,
  seedLang: string,
): string {
  if (!dataPath.startsWith(COPY_PREFIX)) return dataPath;
  if (activeLang === seedLang) return dataPath;
  const key = dataPath.slice(COPY_PREFIX.length);
  return `/${SPEC_STATE_KEYS.i18n}/${activeLang}/${key}`;
}

/**
 * Whether the active language has an `i18n` overlay layer at all — gates the
 * "Revert to source" affordance (nothing to revert until an edit lands).
 */
export function hasOverlayLayer(
  state: Record<string, unknown> | undefined,
  lang: string,
): boolean {
  const i18n = state?.[SPEC_STATE_KEYS.i18n];
  if (typeof i18n !== "object" || i18n === null) return false;
  const layer = (i18n as Record<string, unknown>)[lang];
  return (
    typeof layer === "object" && layer !== null && Object.keys(layer).length > 0
  );
}
