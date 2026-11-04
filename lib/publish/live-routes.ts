import type { ProjectEntryPoint } from "@/lib/publish/project-publish";
import {
  matchRoutePattern,
  routePatternParams,
} from "@/lib/projects/screen-routes";

/** What serves a live path — the snapshot row + the pattern's captures. */
export interface LiveRouteMatch {
  entry: ProjectEntryPoint;
  /** `{id}` captures (`items/4` → `{ id: "4" }`); exact runs carry `{}`. */
  params: Record<string, string>;
}

/**
 * Resolve a post-handle path against the PUBLISHED snapshot (plan 069 task
 * 4, decision 18) — the live twin of `resolveProjectRoute` over the row
 * set the publish already ordered (slug rungs → configured patterns → home):
 *
 *  1. `''` — the home rung serves ONLY the bare segment (`clean === ""`),
 *  2. the exact route value (a slug rung or a literal pattern), scanned in
 *     row order so a slug always beats a later pattern claiming its path,
 *  3. dynamic `{param}` patterns in row order.
 *
 * Static patterns need no separate pass: without `{}` a pattern matches
 * only its own literal value, which the exact rung already covers. Row
 * order comes back from the reader (`.order("route")`) — the snapshot has
 * no position column, so within-class ties resolve alphabetically rather
 * than nondeterministically.
 *
 * No match → null; the caller 404s (decision 19) rather than serving a
 * wrong screen into the wrong state. Pure: rows and path are injected.
 */
export function resolveLiveRoute(
  entryPoints: readonly ProjectEntryPoint[],
  path: string,
): LiveRouteMatch | null {
  const clean = path.replace(/^\/+|\/+$/g, "");
  if (clean === "") {
    const home = entryPoints.find((row) => row.route === "");
    return home ? { entry: home, params: {} } : null;
  }
  const exact = entryPoints.find(
    (row) => row.route !== "" && row.route === clean,
  );
  if (exact) return { entry: exact, params: {} };
  for (const row of entryPoints) {
    if (routePatternParams(row.route).length === 0) continue;
    const params = matchRoutePattern(row.route, clean);
    if (params) return { entry: row, params };
  }
  return null;
}
