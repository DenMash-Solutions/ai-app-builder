import {
  SPEC_STATE_KEYS,
  canonicalizeTag,
  getCopy,
  seedLocale,
} from "@/lib/i18n/spec-languages";

type SpecState = Record<string, unknown>;

export interface TagCoverage {
  /** Canonical tag as stored (raw key when it failed canonicalization). */
  tag: string;
  /** False when the stored key is not a valid BCP-47 tag (merge ignores it). */
  valid: boolean;
  /** True when the layer's language is the seed — redundant, ignored by the merge. */
  redundant: boolean;
  /** Seed keys with no string value in this layer (translate these). */
  missing: string[];
  /** Layer keys that don't exist in the seed (stale — consider deleting). */
  orphaned: string[];
}

export interface I18nCoverage {
  seed: string;
  copyKeys: string[];
  tags: TagCoverage[];
}

/**
 * Non-blocking coverage report: per-tag key diff + tag-format check. Never
 * throws, never rejects a spec — models drift, so this is a flag, not a gate.
 */
export function validateSpecI18n(
  state: SpecState | undefined | null,
): I18nCoverage {
  const seed = seedLocale(state);
  const copy = getCopy(state);
  const copyKeys = Object.keys(copy);
  const i18n = (state?.[SPEC_STATE_KEYS.i18n] ?? {}) as Record<string, unknown>;
  const tags: TagCoverage[] = [];

  for (const [rawTag, layer] of Object.entries(i18n)) {
    const canonical = canonicalizeTag(rawTag);
    const valid = canonical !== null;
    const values =
      typeof layer === "object" && layer !== null && !Array.isArray(layer)
        ? (layer as Record<string, unknown>)
        : {};

    const missing = copyKeys.filter((key) => typeof values[key] !== "string");
    const orphaned = Object.keys(values).filter(
      (key) => !(key in copy) && typeof values[key] === "string",
    );

    const tag = canonical ?? rawTag;
    tags.push({
      tag,
      valid,
      redundant: valid && tag === seed,
      missing,
      orphaned,
    });
  }

  tags.sort((a, b) => a.tag.localeCompare(b.tag));
  return { seed, copyKeys, tags };
}

/** Tags with at least one missing translation (the entry-level flag). */
export function missingTranslationTags(coverage: I18nCoverage): string[] {
  return coverage.tags
    .filter((tag) => tag.valid && !tag.redundant && tag.missing.length > 0)
    .map((tag) => tag.tag);
}

/** Coverage in one call — the source of the per-entry `i18nMissing` flag. */
export function i18nMissingTags(state: SpecState | undefined | null): string[] {
  return missingTranslationTags(validateSpecI18n(state));
}
