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
import { getByPath } from "@json-render/core";
import { getActiveProjectId, type Project } from "./projects";
import type { ProjectMembership } from "./memberships";
import {
  buildRoutePath,
  projectHomeScreenId,
  routePatternParams,
  specRoutePattern,
} from "./screen-routes";

/** The declared catalog action (params: `{ screen: <ref>, … }`). */
export const NAVIGATE_ACTION = "navigate";

/** The one param that names the target; every other param is a route value. */
const SCREEN_KEY = "screen";

/** Which surface is resolving — decides the route form it can push. */
export type ScreenSurface = "editor" | "preview" | "live";

/** See the module docstring: project id | unprojected bucket | unscoped. */
export type ScreenScope = string | null | undefined;

/** A screen as navigation cares about it. */
export interface ScreenTarget {
  id: string;
  slug?: string | undefined;
  name: string;
  /** Which project's route namespace the screen sits in (061-3). */
  projectId?: string | undefined;
  /** The screen's spec — carries the top-level `route` pattern. */
  spec?: unknown;
}

/**
 * Structural shape of a history entry as far as navigation cares — the
 * entry itself (plus the ordering hint the home-screen rule reads).
 */
export interface ScreenSource extends ScreenTarget {
  createdAt?: number | undefined;
}

/**
 * The `{ref, name}` pair the prompt lists and the editor tile offers — `ref`
 * is the screen id (stable; resolution falls back to slug/name anyway).
 * `route` (061-3, reworked 065) is the URL contract the target resolves at:
 * the MEMBERSHIP row's configured pattern when the caller passes the scope's
 * memberships, else the legacy spec-level pattern (project-less screens —
 * the preview's flat paths still match it). The tile reads it to offer the
 * "send record id" toggle; the prompt block renders it so the model knows
 * which URLs exist. `home` marks the scope project's explicit home screen
 * (065 decision 5) — the prompt teaches the bare-namespace front door.
 */
export interface ScreenListing {
  ref: string;
  name: string;
  route?: string | null;
  home?: boolean;
}

/**
 * Scope context for listings (065): membership rows supply each screen's
 * configured route, `homeScreenId` the front-door marker. Omitted by
 * callers with no project scope — listings then fall back to the
 * spec-level route and carry no home flag.
 */
export interface ScreenListingContext {
  memberships?: readonly ProjectMembership[];
  homeScreenId?: string | null;
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
  context?: ScreenListingContext,
): ScreenListing[] {
  const rows = context?.memberships;
  const homeId = context?.homeScreenId ?? null;
  return screens.map((screen) => {
    // Row must belong to the SCREEN's project — scope-filtered callers pass
    // that project's rows, and a foreign row must never claim a flat screen.
    const row = rows?.find(
      (candidate) =>
        candidate.screenId === screen.id &&
        candidate.projectId === screen.projectId,
    );
    return {
      ref: screen.id,
      name: screen.name,
      // Membership route wins (065 — that is what resolves); the spec-level
      // pattern stays the fallback for project-less screens.
      route: row ? row.route : specRoutePattern(screen.spec),
      ...(screen.id === homeId ? { home: true } : {}),
    };
  });
}

/**
 * The record param a `navigate` target expects (061-3, §C): the FIRST
 * `{placeholder}` of the selected screen's route pattern, or null when the
 * target declares no pattern (the "send record id" toggle then has nothing
 * to write). One derivation shared by the tile (show/hide + the key it
 * writes) and the edit panel (the element's current state for that key).
 */
export function recordRouteParam(
  screens: readonly ScreenListing[],
  ref: string | null,
): string | null {
  if (ref === null) return null;
  const target = screens.find((screen) => screen.ref === ref);
  if (!target?.route) return null;
  return routePatternParams(target.route)[0] ?? null;
}

export interface NavigateContext {
  entries: readonly ScreenSource[];
  scope: ScreenScope;
  surface: ScreenSurface;
  /** Required for `preview`/`live` (`/{locale}/{slug}`), ignored by the editor. */
  locale?: string;
  /**
   * Projects for the route namespace (061-3, decision 9) — editor and
   * preview pass them; `live` stays flat (published rows carry no projectId,
   * multi-screen publishing is F18).
   */
  projects?: readonly Project[];
  /**
   * Membership rows for the home check (065 decision 5) — omitted in
   * production, where `projectHomeScreenId` reads the store itself;
   * injected in tests (the store is empty there).
   */
  memberships?: readonly ProjectMembership[];
  /**
   * Live state for deref: the renderer pre-resolves `{"$item": "id"}` params
   * to the record's ABSOLUTE state path (same as `data_mutate`, see
   * `resolveRecordId`) — a `/`-leading string is read against this snapshot.
   */
  state?: Record<string, unknown>;
  /** Injected push — the editor uses the i18n router, public surfaces raw. */
  navigate: (route: string) => void;
}

/**
 * Resolve one navigate param: `/`-leading strings are dereferenced against
 * the state snapshot (the `$item` path the renderer emitted), everything
 * else passes through. No snapshot → the path is unresolvable (`undefined`),
 * which the route build treats as a missing param.
 */
function resolveNavParam(
  value: unknown,
  state: Record<string, unknown> | undefined,
): unknown {
  if (typeof value === "string" && value.startsWith("/")) {
    return state ? getByPath(state, value) : undefined;
  }
  return value;
}

/**
 * The route for a resolved screen + params (decision 9):
 *
 * - editor → `/ui/<ref>[/<built>]` (its optional catch-all carries params
 *   for any screen, project or not),
 * - preview, target in a project → `/{locale}/{project-slug}` + built path
 *   when the target's `route` pattern builds (the target's own slug is
 *   skipped — the pattern names the route); otherwise the bare namespace:
 *   the home screen serves the bare segment, every other screen its slug,
 * - preview, no project → today's `/{locale}/{slug}` (+ built path when a
 *   pattern exists).
 *
 * Params that cannot build (no pattern, missing/unresolvable value) are
 * **dropped with a warning** and the bare route is pushed — loud but safe.
 */
function buildNavigateRoute(
  target: ScreenTarget,
  params: Record<string, unknown>,
  context: NavigateContext,
): string | null {
  const wanted = Object.keys(params).length > 0;
  const pattern = specRoutePattern(target.spec);
  const built =
    wanted && pattern !== null ? buildRoutePath(pattern, params) : null;
  if (wanted && built === null) {
    console.warn(
      `[navigate] screen ${target.id}: params ${JSON.stringify(params)} ` +
        `do not build against route ${JSON.stringify(pattern)} — ` +
        `navigating without them`,
    );
  }

  if (context.surface === "editor") {
    return built !== null ? `/ui/${target.id}/${built}` : `/ui/${target.id}`;
  }

  const { locale } = context;
  if (typeof locale !== "string" || locale === "") return null;

  const project =
    context.projects?.find((candidate) => candidate.id === target.projectId) ??
    null;
  if (project === null) {
    const base = `/${locale}/${target.slug ?? target.id}`;
    return built !== null ? `${base}/${built}` : base;
  }
  if (built !== null) return `/${locale}/${project.slug}/${built}`;
  const homeId = projectHomeScreenId(
    project,
    context.entries,
    context.memberships,
  );
  if (target.id === homeId) return `/${locale}/${project.slug}`;
  return `/${locale}/${project.slug}/${target.slug ?? target.id}`;
}

/**
 * Run a `navigate` binding: resolve `params.screen` inside the scope, deref
 * every extra param against the state snapshot and push the route the target
 * implies (project namespace + params when available — {@link buildNavigateRoute}).
 * Returns whether it navigated — `false` means the ref (or the route) could
 * not be resolved; the caller warns via this function and the editor adds a
 * toast (decision 4).
 */
export function runNavigate(
  params: Record<string, unknown>,
  context: NavigateContext,
): boolean {
  const target = resolveScreenRef(
    params[SCREEN_KEY],
    screensInScope(context.entries, context.scope),
  );
  if (target === null) {
    console.warn(
      `[navigate] no screen matches ref ${JSON.stringify(params[SCREEN_KEY])} ` +
        `in scope ${JSON.stringify(context.scope)} — the link may be stale`,
    );
    return false;
  }
  const routeParams: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (key === SCREEN_KEY) continue;
    routeParams[key] = resolveNavParam(value, context.state);
  }
  const route = buildNavigateRoute(target, routeParams, context);
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
