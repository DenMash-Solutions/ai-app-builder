import { THEMES, THEME_STORAGE_KEY, type Theme } from "@/lib/theme";

/**
 * Spec-driven theme (docs/plan/042-tool-rail-and-spec-theme) — the design's
 * theme lives in the spec like its language does: a state convention
 * (`state.theme`), a declared catalog action (`switch_theme`), and a
 * catalog component (ThemeSwitcher) whose press flips the bound state and
 * dispatches it. Mirrors decision 13's switch_language shape.
 *
 * Persistence splits by audience (decision D3): the AUTHOR's persistence is
 * the spec state itself (the model seeds `state.theme`; it ships with the
 * entry and the publish). A PUBLIC visitor can't write the spec, so public
 * surfaces persist their toggle decision to the same `genui-theme` key
 * ThemeInit already honors pre-paint — their decision then beats the spec
 * default on every future visit.
 */

/** The catalog action that switches the spec's theme. */
export const SWITCH_THEME_ACTION = "switch_theme";

/** Spec state convention: `state.theme` seeds the design's default theme. */
export const SPEC_THEME_STATE_KEY = "theme";

export function isTheme(value: unknown): value is Theme {
  return value === THEMES.light || value === THEMES.dark;
}

/** The spec's seeded theme — null when the spec carries none (older designs). */
export function specTheme(
  state: Record<string, unknown> | null | undefined,
): Theme | null {
  const value = state?.[SPEC_THEME_STATE_KEY];
  return isTheme(value) ? value : null;
}

/**
 * The visitor's stored theme decision — null when absent or unreadable.
 * The key is the app's own (genui-theme): one decision, honored site-wide.
 */
export function readStoredDecision(): string | null {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Effective theme for a PUBLIC surface: the visitor's stored decision wins
 * (site-wide, the very key ThemeInit applies) → else the spec default →
 * else light.
 */
export function effectiveTheme(
  stored: string | null | undefined,
  specDefault: Theme | null,
): Theme {
  if (isTheme(stored)) return stored;
  return specDefault ?? THEMES.light;
}

/**
 * Public-surface toggle: persist the visitor's decision and apply it to
 * <html> in the same step. Deliberately NOT `setTheme` — that early-returns
 * when the module snapshot already equals `next` (e.g. spec default dark,
 * visitor picks light), which would drop the very decision that must stick.
 */
export function persistThemeDecision(next: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Storage unavailable — the decision lives for this session only.
  }
  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle(
      THEMES.dark,
      next === THEMES.dark,
    );
  }
}

/**
 * Pre-paint inline script for PUBLIC surfaces: apply the spec's default ONLY
 * when the visitor has no stored decision (ThemeInit already applies a
 * stored one; the spec default is add-only — no decision means the page
 * starts unthemed, exactly like the app). Same SSR/CSR technique as
 * ThemeInit: `text/javascript` on the server so the parser executes it
 * before first paint, `text/plain` on the client (React never executes
 * scripts it creates). Empty string = nothing to apply.
 */
export function specThemeInitScript(specDefault: Theme | null): string {
  if (specDefault !== THEMES.dark) return "";
  return `try{if(!localStorage.getItem(${JSON.stringify(
    THEME_STORAGE_KEY,
  )}))document.documentElement.classList.add(${JSON.stringify(
    THEMES.dark,
  )})}catch{}`;
}
