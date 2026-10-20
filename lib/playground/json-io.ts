import type { Spec } from "@json-render/core";
import {
  describeDataIssues,
  validateDataSources,
} from "@/lib/data-sources/validate";

/** Object-based error constants — keys map 1:1 to i18n messages. */
export const PARSE_SPEC_ERRORS = {
  invalidJson: "invalidJson",
  invalidShape: "invalidShape",
  invalidDataSources: "invalidDataSources",
} as const;

export type ParseSpecError =
  (typeof PARSE_SPEC_ERRORS)[keyof typeof PARSE_SPEC_ERRORS];

export type ParseSpecResult =
  | { ok: true; spec: Spec }
  /** `details` carries the data-source issue list (developer English). */
  | { ok: false; error: ParseSpecError; details?: string };

/**
 * Parses pasted text into a renderable json-render spec.
 *
 * Shape checks: a JSON object with a string `root`, an `elements` object that
 * contains `root`, and every element being an object with a string `type`.
 * Anything stricter (per-element props/children validation) is the renderer's
 * ValidationProvider job — this only guards the failure modes that would
 * throw or render nothing at all.
 */
export function parseSpecJson(text: string): ParseSpecResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: PARSE_SPEC_ERRORS.invalidJson };
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: PARSE_SPEC_ERRORS.invalidShape };
  }

  const { root, elements } = raw as { root?: unknown; elements?: unknown };
  if (typeof root !== "string" || root.length === 0) {
    return { ok: false, error: PARSE_SPEC_ERRORS.invalidShape };
  }
  if (
    typeof elements !== "object" ||
    elements === null ||
    Array.isArray(elements)
  ) {
    return { ok: false, error: PARSE_SPEC_ERRORS.invalidShape };
  }

  const entries = Object.values(elements as Record<string, unknown>);
  if (entries.length === 0) {
    return { ok: false, error: PARSE_SPEC_ERRORS.invalidShape };
  }
  for (const entry of entries) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      Array.isArray(entry) ||
      typeof (entry as { type?: unknown }).type !== "string"
    ) {
      return { ok: false, error: PARSE_SPEC_ERRORS.invalidShape };
    }
  }

  if (!(root in (elements as Record<string, unknown>))) {
    return { ok: false, error: PARSE_SPEC_ERRORS.invalidShape };
  }

  // Data sources (docs/plan/043-data-sources, D3): the import seam validates
  // the data blocks too — a pasted spec with dangling references or
  // credential-shaped config is rejected with its issue list.
  const dataIssues = validateDataSources(raw as Spec);
  if (dataIssues.length > 0) {
    return {
      ok: false,
      error: PARSE_SPEC_ERRORS.invalidDataSources,
      details: describeDataIssues(dataIssues),
    };
  }

  return { ok: true, spec: raw as Spec };
}

/** Pretty-printed spec for the clipboard (both export paths share this). */
export function serializeSpec(spec: Spec): string {
  return JSON.stringify(spec, null, 2);
}

/** Writes the serialized spec to the clipboard; throws for the caller's toast. */
export async function copySpecToClipboard(spec: Spec): Promise<void> {
  await navigator.clipboard.writeText(serializeSpec(spec));
}
