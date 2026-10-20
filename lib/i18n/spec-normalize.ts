import type { Spec, UIElement } from "@json-render/core";
import { SPEC_STATE_KEYS, getCopy } from "@/lib/i18n/spec-languages";

/**
 * Ingest normalizer: lifts inline user-facing strings into stable
 * `state.copy` keys and replaces them with `{ $state: "/copy/<key>" }`
 * refs, so generated/imported specs satisfy the in-spec language contract
 * (see `docs/plan/038-spec-languages/convention.md`). Non-blocking: anything
 * not covered (nested copy, non-whitelisted props) stays inline.
 */

/** Top-level shadcn-catalog props that carry user-facing copy. */
export const COPY_PROPS = [
  "text",
  "label",
  "title",
  "description",
  "placeholder",
  "caption",
  "message",
  "alt",
  "content",
] as const;

export type CopyProp = (typeof COPY_PROPS)[number];

export interface LiftedCopy {
  /** Copy key created in `state.copy`. */
  key: string;
  elementId: string;
  prop: CopyProp;
}

export interface NormalizeCopyResult {
  /** The normalized spec — the same object when nothing changed. */
  spec: Spec;
  /** Keys newly added to `state.copy` (reused keys are not listed). */
  lifted: LiftedCopy[];
  /** Props rewritten to `$state` refs (lifts + reuse of existing keys). */
  rewritten: number;
}

const COPY_PATH_PREFIX = "/copy/";
const MAX_SLUG_LENGTH = 48;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
  return slug || "copy";
}

/**
 * Stable, collision-free key for a lifted string: slugged from the value
 * (identical strings share one key — translate once), suffixed `-2`, `-3`
 * … when a different string lands on the same slug.
 */
function uniqueKey(
  value: string,
  taken: Map<string, string | undefined>,
): string {
  const base = slugify(value);
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export function normalizeSpecCopy(spec: Spec): NormalizeCopyResult {
  const state = spec.state ?? {};
  const existingCopy = getCopy(state);
  const elements = spec.elements ?? {};
  if (Object.keys(elements).length === 0) {
    return { spec, lifted: [], rewritten: 0 };
  }

  // Existing seed values dedupe lifts: identical strings reuse one key.
  const keyByValue = new Map<string, string>();
  const taken = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(existingCopy)) {
    taken.set(key, typeof value === "string" ? value : undefined);
    if (typeof value === "string" && !keyByValue.has(value)) {
      keyByValue.set(value, key);
    }
  }

  const nextCopy: Record<string, unknown> = { ...existingCopy };
  const lifted: LiftedCopy[] = [];
  const nextElements: Record<string, UIElement> = {};
  let rewritten = 0;
  let changed = false;

  const copyRef = (key: string) => ({ $state: `${COPY_PATH_PREFIX}${key}` });

  for (const [elementId, element] of Object.entries(elements)) {
    const props = element.props;
    if (!isRecord(props)) {
      nextElements[elementId] = element;
      continue;
    }

    const nextProps: Record<string, unknown> = { ...props };
    let elementChanged = false;

    for (const prop of COPY_PROPS) {
      const value = nextProps[prop];
      if (typeof value !== "string" || value.trim() === "") continue;

      let key = keyByValue.get(value);
      if (key === undefined) {
        key = uniqueKey(value, taken);
        taken.set(key, value);
        keyByValue.set(value, key);
        nextCopy[key] = value;
        lifted.push({ key, elementId, prop });
      }
      nextProps[prop] = copyRef(key);
      rewritten += 1;
      elementChanged = true;
    }

    if (elementChanged) {
      nextElements[elementId] = { ...element, props: nextProps };
      changed = true;
    } else {
      nextElements[elementId] = element;
    }
  }

  if (!changed) return { spec, lifted: [], rewritten: 0 };

  return {
    spec: {
      ...spec,
      state: { ...state, [SPEC_STATE_KEYS.copy]: nextCopy },
      elements: nextElements,
    },
    lifted,
    rewritten,
  };
}
