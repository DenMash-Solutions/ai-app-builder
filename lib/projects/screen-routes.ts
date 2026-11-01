/**
 * Route helpers for the project route namespace (plan 061-3 decision 9,
 * reworked by plan 065):
 *
 * - `/{locale}/{project-slug}` serves the project's EXPLICIT home screen
 *   (`project.homeScreenId`, decision 5),
 * - `/{locale}/{project-slug}/{…}` resolves an in-project screen from its
 *   MEMBERSHIP row's configured `route` pattern (`"{id}"` — same syntax as
 *   the old spec-level route) with deterministic precedence: exact screen
 *   slug > static pattern > dynamic pattern > position (decision 6), whose
 *   `{name}` segments bind into the target's state seed so the screen
 *   loads the right record (a detail screen's `get` query reads
 *   `params.id = {$state: "/id"}`),
 * - `navigate` params ride the URL as path segments: a target with a
 *   buildable pattern gets `/{locale}/{project-slug}` + built path (the
 *   target's own slug is skipped — the pattern already names the route),
 *   anything else appends to the plain screen route.
 *
 * Pure functions only (dependency-injected — the membership lookups take a
 * rows parameter that defaults to the store) — the editor route
 * (`/ui/[ref]/[[...param]]`) and the preview route (`/[locale]/[slug]/
 * [[...route]]`) own the `window`/`router` side.
 */

import type { HistoryEntry } from "@/lib/history";
import { getProjectMemberships } from "@/lib/projects/memberships";
import type { ProjectMembership } from "@/lib/projects/memberships";
import type { Project } from "@/lib/projects/projects";

/* ------------------------------------------------------------------ */
/* Pattern parse / match / build                                       */
/* ------------------------------------------------------------------ */

/**
 * The spec-level route pattern of a screen (`{ "route": "{id}" }`), or null
 * when the screen declares none (most screens — a bare slug route). Top-level
 * extension like `urlSync`, so it reads as `unknown` (the closed `Spec` type
 * does not know about it) — same shape as `specUrlSync`.
 */
export function specRoutePattern(spec: unknown): string | null {
  if (typeof spec !== "object" || spec === null) return null;
  const raw = (spec as { route?: unknown }).route;
  if (typeof raw !== "string") return null;
  const trimmed = raw
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .trim();
  return trimmed === "" ? null : trimmed;
}

/** The `{name}` placeholders of a pattern, in order (`["id", "slug"]`). */
export function routePatternParams(pattern: string): string[] {
  return [...pattern.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]);
}

/**
 * Match a post-project path against a pattern: same segment count, literal
 * segments equal, `{param}` segments capture. Returns the captured values
 * (in pattern order) or null. A malformed pattern never matches.
 */
export function matchRoutePattern(
  pattern: string,
  path: string,
): Record<string, string> | null {
  const patternSegs = pattern.split("/").filter(Boolean);
  const pathSegs = path.split("/").filter(Boolean);
  if (patternSegs.length === 0 || patternSegs.length !== pathSegs.length) {
    return null;
  }
  const params: Record<string, string> = {};
  for (let i = 0; i < patternSegs.length; i += 1) {
    const p = patternSegs[i];
    const seg = pathSegs[i];
    const placeholder = p.match(/^\{([^{}]+)\}$/);
    if (placeholder) params[placeholder[1]] = seg;
    else if (p !== seg) return null;
  }
  return params;
}

/**
 * Build a concrete path from a pattern: `{id}` → the param's value, a
 * literal → itself. Params and pattern must correspond **exactly** — a
 * value with no placeholder (or a placeholder with no value) means the
 * author and the route disagree — as do a nil/empty/non-primitive value.
 * Any mismatch is unbuildable → null: the caller then falls back to the
 * plain route and warns, never a half-built path.
 */
export function buildRoutePath(
  pattern: string,
  params: Record<string, unknown>,
): string | null {
  const segments = pattern.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  const declared = new Set(
    segments
      .map((segment) => segment.match(/^\{([^{}]+)\}$/)?.[1])
      .filter((name): name is string => name !== undefined),
  );
  const provided = Object.keys(params);
  if (
    declared.size !== provided.length ||
    provided.some((key) => !declared.has(key))
  ) {
    return null;
  }
  const built = segments.map((segment) => {
    const name = segment.match(/^\{([^{}]+)\}$/)?.[1];
    if (name === undefined) return segment;
    const value = params[name];
    if (value === undefined || value === null) return null;
    // Objects/arrays have no URL spelling — unbuildable rather than
    // "[object Object]".
    if (typeof value === "object" || typeof value === "function") {
      return null;
    }
    const text = String(value);
    return text === "" ? null : text;
  });
  if (built.some((segment) => segment === null)) return null;
  return built.join("/");
}

/* ------------------------------------------------------------------ */
/* State seeding                                                       */
/* ------------------------------------------------------------------ */

/**
 * Seed overlay for path params — the `overlayUrlState` sibling (plan 061-3).
 * Callers pass only the route pattern's captures, so — unlike an arbitrary
 * query string — nothing foreign can inject state keys: the pattern itself
 * is the declaration that `{id}` belongs on the target's state.
 *
 * A segment coerces to number only when the round-trip is exact
 * (`"4"` → 4, `"4.5"` → 4.5): the detail `get` binds
 * `params.id = {$state: "/id"}` and PokeAPI's `/pokemon/{id}` is numeric —
 * while `"007"` and `"4x"` stay strings (no information lost).
 * Returns `state` unchanged when there are no params.
 */
export function overlayPathState(
  state: Record<string, unknown>,
  params: Record<string, string | undefined> | null | undefined,
): Record<string, unknown> {
  if (!params) return state;
  const declared = Object.entries(params).filter(
    ([, value]) => value !== undefined,
  );
  if (declared.length === 0) return state;
  const next = { ...state };
  for (const [key, value] of declared) {
    if (value === undefined) continue;
    const asNumber = Number(value);
    next[key] =
      value.trim() !== "" &&
      Number.isFinite(asNumber) &&
      String(asNumber) === value
        ? asNumber
        : value;
  }
  return next;
}

/* ------------------------------------------------------------------ */
/* Resolution                                                          */
/* ------------------------------------------------------------------ */

/** What a project-path match resolved to — the caller seeds and routes. */
export interface ProjectRouteMatch {
  /** The screen whose spec serves this path. */
  screen: HistoryEntry;
  /** Pattern captures (`{id}` → `"4"`) + exact-slug matches (empty object). */
  params: Record<string, string>;
}

/**
 * Resolve the path after a project slug against MEMBERSHIP rows (plan 065 —
 * `route` and `position` live on `project_screens`, no longer on the spec).
 * Precedence (decision 6's deterministic order):
 *
 *  1. exact screen slug (or id) — a literal screen always owns its own URL,
 *  2. STATIC pattern (no `{}`) match — a concrete path contract beats a
 *     parameterized one regardless of position,
 *  3. DYNAMIC pattern (has `{}`) match,
 *  4. within a class: `position` order (the store's sort: position →
 *     createdAt → id), so ties resolve identically on every device.
 *
 * No match → null (the caller 404s rather than silently falling back — a
 * wrong screen at a project URL would seed the wrong state).
 * `memberships` defaults to the store's rows for this project; tests inject
 * rows directly (dependency-injected purity, module docstring).
 */
export function resolveProjectRoute(
  project: Project,
  entries: readonly HistoryEntry[],
  path: string,
  memberships: readonly ProjectMembership[] = getProjectMemberships(project.id),
): ProjectRouteMatch | null {
  const clean = path.replace(/^\/+|\/+$/g, "");
  if (clean === "") return null;
  // Membership rows, in deterministic order, joined to their screens —
  // a row whose screen entry is gone resolves nothing (dangling id).
  const members = memberships
    .filter((row) => row.projectId === project.id)
    .sort(
      (a, b) =>
        a.position - b.position ||
        a.createdAt - b.createdAt ||
        a.id.localeCompare(b.id),
    )
    .map((row) => ({ row, entry: entries.find((e) => e.id === row.screenId) }))
    .filter(
      (m): m is { row: ProjectMembership; entry: HistoryEntry } =>
        m.entry !== undefined,
    );
  // 1. exact slug/id — the screen's own URL.
  const exact = members.find(
    (m) => m.entry.slug === clean || m.entry.id === clean,
  );
  if (exact) return { screen: exact.entry, params: {} };
  // 2./3. static patterns before dynamic, position order within each class.
  for (const dynamic of [false, true]) {
    for (const m of members) {
      if (m.row.route === null) continue;
      if (routePatternParams(m.row.route).length > 0 !== dynamic) continue;
      const params = matchRoutePattern(m.row.route, clean);
      if (params) return { screen: m.entry, params };
    }
  }
  return null;
}

/**
 * The project's home screen — what serves the bare `/{locale}/{slug}`
 * segment (plan 065 decision 5): the EXPLICIT `project.homeScreenId`,
 * validated at resolve time — it must still be a member (decision 10's
 * app-side check) and its entry must exist (dangling ids after a screen
 * delete leave the root empty, never a wrong screen). No/unknown home →
 * null (the caller 404s the bare namespace); the oldest-member rule is
 * gone (decision 5 rejects relying on creation order).
 * `memberships` defaults to the store — injected in tests.
 */
export function projectHomeScreenId(
  project: Project,
  entries: readonly { id: string }[],
  memberships: readonly ProjectMembership[] = getProjectMemberships(project.id),
): string | null {
  const homeId = project.homeScreenId ?? null;
  if (homeId === null) return null;
  const isMember = memberships.some(
    (row) => row.projectId === project.id && row.screenId === homeId,
  );
  if (!isMember) return null;
  return entries.some((entry) => entry.id === homeId) ? homeId : null;
}
