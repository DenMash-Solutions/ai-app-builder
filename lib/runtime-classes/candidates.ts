import type { Spec } from "@json-render/core";
import { toClassTokens } from "@/lib/editor/class-tokens";

/** Hard cap per request — overflow tokens are reported as missing instead. */
export const MAX_CANDIDATES = 512;
/** Sanity cap: real utility tokens are far shorter. */
export const MAX_CANDIDATE_LENGTH = 200;

/**
 * Every distinct className token used anywhere in the spec (deduped).
 * Non-string className values (expressions) are skipped by toClassTokens.
 */
export function collectSpecClassTokens(
  spec: Spec | null | undefined,
): string[] {
  const tokens = new Set<string>();
  const elements = spec?.elements;
  if (elements) {
    for (const element of Object.values(elements)) {
      for (const token of toClassTokens(element.props?.className)) {
        tokens.add(token);
      }
    }
  }
  return [...tokens];
}

/** Class tokens are single CSS identifiers: no whitespace, no control bytes. */
function hasUnsuitableChars(value: string): boolean {
  if (/\s/.test(value)) return true;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export interface SanitizedCandidates {
  /** Tokens safe to hand to the Tailwind engine. */
  candidates: string[];
  /**
   * Tokens that cannot be compiled (malformed/oversized/overflow) — reported
   * as missing so they surface as badges instead of failing silently.
   */
  invalid: string[];
}

/**
 * Request payload validation: array of sane class tokens. Returns null when
 * the payload shape is wrong (→ 400); individual bad tokens are split into
 * `invalid` so one broken token never fails the whole batch.
 */
export function sanitizeCandidates(input: unknown): SanitizedCandidates | null {
  if (!Array.isArray(input)) return null;
  const candidates: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") return null;
    if (seen.has(raw)) continue;
    seen.add(raw);
    if (
      raw.length === 0 ||
      raw.length > MAX_CANDIDATE_LENGTH ||
      hasUnsuitableChars(raw)
    ) {
      invalid.push(raw);
      continue;
    }
    if (candidates.length >= MAX_CANDIDATES) {
      invalid.push(raw);
      continue;
    }
    candidates.push(raw);
  }
  return { candidates, invalid };
}
