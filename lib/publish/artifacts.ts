import type { Spec } from "@json-render/core";
import {
  baseTag,
  canonicalizeTag,
  seedLocale,
} from "@/lib/i18n/spec-languages";

/**
 * Baked per-language artifacts stored on `published_pages.artifacts` (jsonb,
 * keyed by canonical tag). Serving maps the route locale → an artifact via the
 * same fallback chain as the copy merge (exact → base → seed), so a page is
 * never un-renderable for a locale it merely lacks a translation for.
 * Contract: `docs/plan/spec-languages/convention.md` → "Publish-time bake".
 */

export type SpecKind = "content" | "stateful";

export interface BakedArtifact {
  /** `renderToStaticMarkup` of the spec tree, merged for this tag. */
  html: string;
  /** Compiled Tailwind for the spec's class tokens (one shared build). */
  css: string;
  kind: SpecKind;
  /** The `published_pages.version` this was baked from — staleness guard. */
  version: number;
}

/** Parse the `artifacts` jsonb column, dropping malformed tags/entries. */
export function parseArtifacts(
  value: unknown,
): Record<string, BakedArtifact> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const out: Record<string, BakedArtifact> = {};
  for (const [tag, entry] of Object.entries(value as Record<string, unknown>)) {
    const canonical = canonicalizeTag(tag);
    if (!canonical || typeof entry !== "object" || entry === null) continue;
    const a = entry as Record<string, unknown>;
    if (typeof a.html !== "string" || typeof a.css !== "string") continue;
    out[canonical] = {
      html: a.html,
      css: a.css,
      kind: a.kind === "stateful" ? "stateful" : "content",
      version: typeof a.version === "number" ? a.version : 0,
    };
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Route locale → the artifact to serve, via the fallback chain
 * `exact tag → base language → seed`. Returns the first hit; `null` when the
 * spec carries no usable artifact (caller falls back to client rendering).
 */
export function lookupArtifact(
  artifacts: Record<string, BakedArtifact> | null | undefined,
  locale: string,
  seed: string,
): BakedArtifact | null {
  if (!artifacts) return null;
  const canonical = canonicalizeTag(locale) ?? "en";
  const seedCanonical = canonicalizeTag(seed) ?? "en";
  const chain = [canonical, baseTag(canonical), seedCanonical];
  for (const tag of chain) {
    const hit = artifacts[tag];
    if (hit) return hit;
  }
  return null;
}

/**
 * The artifact to serve for a page + route locale: the fallback-chain hit, but
 * only when it was baked from the page's CURRENT version. A stale artifact
 * (page re-published before the bake landed) returns null → the caller degrades
 * to client rendering rather than serving markup from an older snapshot.
 */
export function servingArtifact(
  page: {
    artifacts: Record<string, BakedArtifact> | null;
    spec: Spec;
    version: number;
  },
  locale: string,
): BakedArtifact | null {
  const artifact = lookupArtifact(
    page.artifacts,
    locale,
    seedLocale(page.spec?.state),
  );
  return artifact && artifact.version === page.version ? artifact : null;
}
