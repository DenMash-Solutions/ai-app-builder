import type { Spec } from "@json-render/core";
import { availableLanguages, SPEC_STATE_KEYS } from "@/lib/i18n/spec-languages";

/**
 * The design's own language switcher (a `ButtonGroup` whose buttons are
 * language codes — `ES | EN | …`) must stay in step with the languages the
 * spec carries: adding a language offers it, removing drops it. Detection is
 * structural: every button value must look like a language tag AND the group
 * must offer at least one language the spec actually carries, so steppers or
 * filters with tag-shaped values are never touched.
 *
 * Switching itself is a **declared action** (decision 13): the toggle's
 * `change` event binds `switch_language`, whose handler each surface
 * supplies (canvas = in-place switch, live surfaces = navigation). Specs
 * without the binding fall back to the older state-write convention, so
 * already-published designs keep working until their next model commit.
 */

/** The catalog action that switches the design's language. */
export const SWITCH_LANGUAGE_ACTION = "switch_language";

/** The canonical binding on a switcher's `change` event: the group has
 *  written the pressed tag to `/locale` by the time it emits, so the param
 *  resolves to it at dispatch time. */
function switchLanguageBinding(): Record<string, unknown> {
  return {
    action: SWITCH_LANGUAGE_ACTION,
    params: { tag: { $state: `/${SPEC_STATE_KEYS.locale}` } },
  };
}

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

/** Whether an element declares the switch_language action on its change
 *  event (either binding shape the renderer accepts: one or many). */
function declaresSwitchAction(element: unknown): boolean {
  if (typeof element !== "object" || element === null) return false;
  const on = (element as { on?: unknown }).on;
  if (typeof on !== "object" || on === null) return false;
  const change = (on as Record<string, unknown>).change;
  const bindings =
    change === undefined || change === null
      ? []
      : Array.isArray(change)
        ? change
        : [change];
  return bindings.some(
    (binding) =>
      typeof binding === "object" &&
      binding !== null &&
      (binding as { action?: unknown }).action === SWITCH_LANGUAGE_ACTION,
  );
}

/** Whether the spec's switcher declares the switch_language action — surfaces
 *  use this to prefer the action over the state-write fallback (no double
 *  navigation). */
export function hasSwitchLanguageBinding(spec: Spec): boolean {
  const languages = availableLanguages(spec);
  return Object.values(spec.elements ?? {}).some(
    (element) =>
      languageButtons(element, languages) !== null &&
      declaresSwitchAction(element),
  );
}

/**
 * Returns a spec whose language-switcher ButtonGroup (when the design has
 * one) declares the `switch_language` action on its change event — the
 * canonical form the generate prompt asks for. Pure: the input is never
 * mutated, and it is returned untouched when nothing changes (the
 * model-commit fix-up calls it on every completion, so older designs
 * migrate on their next edit).
 */
export function withSwitchLanguageBinding<T extends Spec>(spec: T): T {
  const elements = spec.elements;
  if (!elements) return spec;
  const languages = availableLanguages(spec);
  let changed = false;
  const next: Record<string, unknown> = { ...elements };
  for (const [key, element] of Object.entries(elements)) {
    if (languageButtons(element, languages) === null) continue;
    if (declaresSwitchAction(element)) continue;
    const el = element as { on?: Record<string, unknown> };
    const existing = el.on?.change;
    const changeBindings =
      existing === undefined || existing === null
        ? []
        : Array.isArray(existing)
          ? existing
          : [existing];
    next[key] = {
      ...el,
      on: {
        ...el.on,
        change: [...changeBindings, switchLanguageBinding()],
      },
    };
    changed = true;
  }
  return changed ? ({ ...spec, elements: next } as T) : spec;
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
