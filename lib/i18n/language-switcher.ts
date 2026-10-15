import type { Spec } from "@json-render/core";
import { availableLanguages } from "@/lib/i18n/spec-languages";

/**
 * The design's own language switcher (a `ButtonGroup` whose buttons are
 * language codes — `ES | EN | …`) must stay in step with the languages the
 * spec carries: adding a language offers it, removing drops it. Detection is
 * structural: every button value must look like a language tag AND the group
 * must offer at least one language the spec actually carries, so steppers or
 * filters with tag-shaped values are never touched.
 */

/** Language tags look like `es`, `pt-BR`, `zh-Hans` — primary subtag 2–3
 *  letters (the same practical rule the picker's escape hatch uses). */
const TAG_SHAPE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

interface LangButton {
  label?: unknown;
  value: unknown;
}

/** The element's buttons when it is a language switcher, else null. */
function languageButtons(
  element: unknown,
  languages: readonly string[],
): LangButton[] | null {
  if (typeof element !== "object" || element === null) return null;
  const el = element as { type?: unknown; props?: unknown };
  if (el.type !== "ButtonGroup") return null;
  if (typeof el.props !== "object" || el.props === null) return null;
  const buttons = (el.props as { buttons?: unknown }).buttons;
  if (!Array.isArray(buttons) || buttons.length === 0) return null;
  const allTagShaped = buttons.every(
    (button) =>
      typeof button === "object" &&
      button !== null &&
      typeof (button as { value?: unknown }).value === "string" &&
      TAG_SHAPE.test((button as { value: string }).value),
  );
  if (!allTagShaped) return null;
  const offersKnown = buttons.some((button) =>
    languages.includes((button as { value: string }).value),
  );
  return offersKnown ? (buttons as LangButton[]) : null;
}

/** Whether the spec carries a language-switcher ButtonGroup — used to decide
 *  if the add-language steer should mention updating it. */
export function hasLanguageSwitcher(spec: Spec): boolean {
  const languages = availableLanguages(spec);
  return Object.values(spec.elements ?? {}).some(
    (element) => languageButtons(element, languages) !== null,
  );
}

/**
 * Returns a spec whose language-switcher ButtonGroup (when the design has
 * one) offers `tag` exactly when `present` is true — the label is the
 * uppercased tag, matching the existing `ES`/`EN` convention. Pure: the
 * input is never mutated, and it is returned untouched when nothing changes
 * (add → the model steer's fix-up; remove → the local removal op).
 */
export function withLanguageSwitcherOption<T extends Spec>(
  spec: T,
  tag: string,
  present: boolean,
): T {
  const elements = spec.elements;
  if (!elements) return spec;
  const languages = availableLanguages(spec);
  let changed = false;
  const next: Record<string, unknown> = { ...elements };
  for (const [key, element] of Object.entries(elements)) {
    const buttons = languageButtons(element, languages);
    if (!buttons) continue;
    const has = buttons.some((button) => button.value === tag);
    if (has === present) continue;
    const el = element as { props: Record<string, unknown> };
    next[key] = {
      ...el,
      props: {
        ...el.props,
        buttons: present
          ? [...buttons, { label: tag.toUpperCase(), value: tag }]
          : buttons.filter((button) => button.value !== tag),
      },
    };
    changed = true;
  }
  if (!changed) return spec;
  return { ...spec, elements: next } as T;
}
