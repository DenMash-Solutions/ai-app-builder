/**
 * screen-nav (plan 061 step 2) — the `navigate` action's contract.
 *
 * A spec binds `{"action": "navigate", "params": {"screen": "<ref>"}}` and an
 * app-side handler resolves the ref at CLICK time (decision 2): routes are
 * locale- and surface-specific and unknowable to the model before publish,
 * while a ref (screen id → slug → name) resolves against this device's own
 * screens on whichever surface is rendering.
 *
 * Scope semantics (decision 2 + the cross-project-navigation descope): a ref
 * never crosses a project boundary.
 *   - `"<project id>"` — only screens grouped under that project
 *   - `null` — the device's "no project" bucket (an unprojected screen's
 *     siblings are the other unprojected screens, exactly like the
 *     history-drawer's legacy group)
 *   - `undefined` — every screen on the device. Only the published root uses
 *     this: `published_pages` rows carry no projectId (projects are
 *     device-local), so that surface has no project context; it resolves
 *     against the device's own screens, and a visitor holds none.
 *
 * Every surface derives its scope through {@link screenScope} so the prompt's
 * sibling list, the editor tile, and the runtime handlers agree on what a ref
 * can resolve to.
 *
 * Failure is loud-but-safe (decision 4): `console.warn` everywhere, and a
 * `false` return the editor turns into a toast — a stale ref never throws.
 */
import { getActiveProjectId } from "./projects";

/** The declared catalog action (params: `{ screen: <ref> }`). */
export const NAVIGATE_ACTION = "navigate";

/** Which surface is resolving — decides the route form it can push. */
export type ScreenSurface = "editor" | "preview" | "live";

/** See the module docstring: project id | unprojected bucket | unscoped. */
export type ScreenScope = string | null | undefined;

/** A screen as navigation cares about it. */
export interface ScreenTarget {
  id: string;
  slug?: string | undefined;
  name: string;
}

/** Structural shape of a history entry as far as navigation cares. */
export interface ScreenSource extends ScreenTarget {
  projectId?: string | undefined;
}

/**
 * The `{ref, name}` pair the prompt lists and the editor tile offers — `ref`
 * is the screen id (stable; resolution falls back to slug/name anyway).
 */
export interface ScreenListing {
  ref: string;
  name: string;
}

/** Filter entries down to the screens a ref may resolve to. */
export function screensInScope(
  entries: readonly ScreenSource[],
  scope: ScreenScope,
): ScreenTarget[] {
  return entries.filter((entry) =>
    scope === undefined ? true : (entry.projectId ?? null) === scope,
  );
}

/**
 * Resolve a screen ref: id first (what the prompt lists and the tile
 * writes), then slug (short hand-typed URLs), then name (case-insensitive —
 * names are model- and human-authored copy). First match in scope wins;
 * unknown refs return `null` (decision 4 — never throw).
 */
export function resolveScreenRef(
  ref: unknown,
  screens: readonly ScreenTarget[],
): ScreenTarget | null {
  if (typeof ref !== "string") return null;
  const needle = ref.trim();
  if (needle === "") return null;
  const lowered = needle.toLowerCase();
  return (
    screens.find((screen) => screen.id === needle) ??
    screens.find((screen) => screen.slug === needle) ??
    screens.find((screen) => screen.name.trim().toLowerCase() === lowered) ??
    null
  );
}

/**
 * The route a surface pushes for a resolved screen: the editor's
 * `/ui/[ref]` (resolved by id first, then slug) or the public
 * `/{locale}/{slug}`. Public surfaces need a locale — without one there is
 * no safe route, so `null`.
 */
export function screenRoute(
  target: ScreenTarget,
  surface: ScreenSurface,
  locale?: string,
): string | null {
  if (surface === "editor") return `/ui/${target.id}`;
  if (typeof locale !== "string" || locale === "") return null;
  return `/${locale}/${target.slug ?? target.id}`;
}

/**
 * The scope chain every authoring/preview surface uses: the current screen's
 * project, else the device's active project (where new screens land), else
 * the unprojected bucket. One chain for prompt, tile and handlers means a
 * ref listed at generation time resolves exactly where it was listed.
 */
export function screenScope(
  current?: { projectId?: string | undefined } | null,
): ScreenScope {
  return current?.projectId ?? getActiveProjectId() ?? null;
}

/** Map resolved screens to the `{ref, name}` pairs the prompt/tile offer. */
export function toScreenListings(
  screens: readonly ScreenTarget[],
): ScreenListing[] {
  return screens.map((screen) => ({ ref: screen.id, name: screen.name }));
}

export interface NavigateContext {
  entries: readonly ScreenSource[];
  scope: ScreenScope;
  surface: ScreenSurface;
  /** Required for `preview`/`live` (`/{locale}/{slug}`), ignored by the editor. */
  locale?: string;
  /** Injected push — the editor uses the i18n router, public surfaces raw. */
  navigate: (route: string) => void;
}

/**
 * Run a `navigate` binding: resolve `params.screen` inside the scope and
 * push its route. Returns whether it navigated — `false` means the ref (or
 * the route) could not be resolved; the caller warns via this function and
 * the editor adds a toast (decision 4).
 */
export function runNavigate(
  params: Record<string, unknown>,
  context: NavigateContext,
): boolean {
  const target = resolveScreenRef(
    params.screen,
    screensInScope(context.entries, context.scope),
  );
  if (target === null) {
    console.warn(
      `[navigate] no screen matches ref ${JSON.stringify(params.screen)} ` +
        `in scope ${JSON.stringify(context.scope)} — the link may be stale`,
    );
    return false;
  }
  const route = screenRoute(target, context.surface, context.locale);
  if (route === null) {
    console.warn(
      `[navigate] screen ${target.id} has no route on ${context.surface} ` +
        `(missing locale)`,
    );
    return false;
  }
  context.navigate(route);
  return true;
}
