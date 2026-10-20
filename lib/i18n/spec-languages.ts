import type { Spec } from "@json-render/core";

/**
 * In-spec languages: `state.copy` is the single-language seed, translations
 * live in `state.i18n.<bcp47-tag>` and every surface merges the active
 * language over the seed before rendering. Contract: see
 * `docs/plan/038-spec-languages/convention.md`.
 */

type SpecState = Record<string, unknown>;

export const SPEC_STATE_KEYS = {
  locale: "locale",
  copy: "copy",
  i18n: "i18n",
} as const;

const DEFAULT_SEED_LOCALE = "en";

/** Canonicalize a BCP-47 tag (`"ES"` → `"es"`, `"es-mx"` → `"es-MX"`); null when invalid. */
export function canonicalizeTag(tag: string): string | null {
  try {
    const [canonical] = Intl.getCanonicalLocales(tag);
    return canonical ?? null;
  } catch {
    return null;
  }
}

/** Primary language subtag (`"es-MX"` → `"es"`). Input must already be canonical. */
export function baseTag(tag: string): string {
  const dash = tag.indexOf("-");
  return dash === -1 ? tag : tag.slice(0, dash);
}

/**
 * The seed language of a spec's copy: canonicalized `state.locale`
 * (the app locale the spec was generated under), `en` when absent/invalid.
 */
export function seedLocale(state: SpecState | undefined | null): string {
  const locale = state?.[SPEC_STATE_KEYS.locale];
  if (typeof locale === "string") {
    const canonical = canonicalizeTag(locale);
    if (canonical) return canonical;
  }
  return DEFAULT_SEED_LOCALE;
}

export function getCopy(state: SpecState | undefined | null): SpecState {
  const copy = state?.[SPEC_STATE_KEYS.copy];
  return typeof copy === "object" && copy !== null && !Array.isArray(copy)
    ? (copy as SpecState)
    : {};
}

function getI18n(state: SpecState | undefined | null): Record<string, unknown> {
  const i18n = state?.[SPEC_STATE_KEYS.i18n];
  return typeof i18n === "object" && i18n !== null && !Array.isArray(i18n)
    ? (i18n as Record<string, unknown>)
    : {};
}

function isStringLayer(value: unknown): value is Record<string, string> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Merge the translations for `tag` over the seed copy and return the state
 * to render. Fallback chain per key: `i18n[exact] → i18n[base] → copy`.
 * Layers whose tag equals the seed language are skipped — the seed is the
 * source of truth for its own language. `locale` is never touched (it keeps
 * following app routing). Invalid tags / nothing to merge → the input state
 * is returned unchanged.
 */
export function mergeI18n(
  state: SpecState | undefined | null,
  tag: string,
): SpecState | undefined | null {
  if (state === undefined || state === null) return state;
  const canonical = canonicalizeTag(tag);
  if (!canonical) return state;

  const copy = state[SPEC_STATE_KEYS.copy];
  if (typeof copy !== "object" || copy === null || Array.isArray(copy)) {
    return state;
  }

  const seed = seedLocale(state);
  const exact = canonical;
  const base = baseTag(canonical);
  const i18n = getI18n(state);

  const layers: Array<string> = [];
  for (const layer of [base, exact]) {
    if (layer !== seed && !layers.includes(layer)) layers.push(layer);
  }

  const merged: SpecState = { ...(copy as SpecState) };
  let mergedAny = false;
  for (const layer of layers) {
    const values = i18n[layer];
    if (!isStringLayer(values)) continue;
    for (const [key, value] of Object.entries(values)) {
      if (typeof value !== "string") continue;
      merged[key] = value;
      mergedAny = true;
    }
  }

  if (!mergedAny) return state;
  return { ...state, [SPEC_STATE_KEYS.copy]: merged };
}

/**
 * Every language a spec carries: the seed first, then the canonicalized
 * `state.i18n` keys (invalid tags dropped, duplicates collapsed).
 */
export function availableLanguages(spec: Spec): string[] {
  const seed = seedLocale(spec.state);
  const tags: string[] = [seed];
  const i18n = getI18n(spec.state);
  for (const key of Object.keys(i18n)) {
    const canonical = canonicalizeTag(key);
    if (canonical && !tags.includes(canonical)) tags.push(canonical);
  }
  return tags;
}
