/**
 * URL ↔ spec-state pagination sync (docs/plan/052, D9): a spec that
 * declares `urlSync: ["page", "limit"]` gets those top-level state keys
 * mirrored in the browser's query string, so `?page=2&limit=6` is a
 * shareable deep link. Two helpers, pure functions (dependency-injected —
 * the playground owns `window`/`history`):
 *
 * - `overlayUrlState` — deep-link IN: URL values overlay the spec's state
 *   seed before the surface mounts (the first query run already reads the
 *   linked page; json-render's `watch` never fires for the seed, only for
 *   later changes). `page` is 1-based in the URL (human/REST convention)
 *   and 0-based in state (`stepPage`/`pageLabel` convention) — the ±1
 *   lives here, never in the spec. Invalid/absent values keep the seed.
 * - `urlSearchAfterStateChange` — shareable OUT: a `/page`/`/limit` state
 *   change rewrites those params in place (`history.replaceState` — no
 *   history spam) while every unrelated param survives untouched.
 *
 * State values are numeric (`stepPage` math), so writes are numeric-only;
 * keys whose seeded value is a string pass through as strings.
 */

/** The one param whose URL spelling differs from state (0-based → 1-based). */
const PAGE_KEY = "page";

const toNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number.isFinite(Number(value))
        ? Number(value)
        : null
      : null;

/**
 * The spec's declared `urlSync` keys (top-level extension, same style as
 * the data blocks): only non-empty, "/"-free TOP-LEVEL state keys
 * qualify — anything else is ignored and sync becomes a no-op.
 */
export function specUrlSync(spec: unknown): string[] {
  if (typeof spec !== "object" || spec === null) return [];
  const value = (spec as { urlSync?: unknown }).urlSync;
  if (!Array.isArray(value)) return [];
  return value.filter(
    (key): key is string =>
      typeof key === "string" && key.length > 0 && !key.includes("/"),
  );
}

/**
 * Overlay declared URL params onto a spec's state seed. Only `urlSync`
 * keys are read; a key's URL value must parse to a finite number when the
 * seed is numeric (state is numeric — pagination math depends on it), or
 * it passes as a raw string when the seed is a string. `page` converts
 * 1-based URL → 0-based state and clamps at 0 (`?page=0`/`page=abc`
 * keep the seed).
 */
export function overlayUrlState(
  seed: Record<string, unknown>,
  search: string,
  urlSync: readonly string[],
): Record<string, unknown> {
  if (urlSync.length === 0 || search === "") return seed;
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  let overlaid: Record<string, unknown> | null = null;
  for (const key of urlSync) {
    const raw = params.get(key);
    if (raw === null) continue;
    const seeded = seed[key];
    let value: unknown;
    if (key === PAGE_KEY) {
      const parsed = toNumber(raw);
      if (parsed === null) continue; // page=abc / page= → seed wins
      value = Math.max(0, Math.trunc(parsed) - 1); // 1-based URL → 0-based
    } else if (typeof seeded === "number") {
      const parsed = toNumber(raw);
      if (parsed === null) continue;
      value = parsed;
    } else {
      value = raw;
    }
    overlaid = overlaid ?? { ...seed };
    overlaid[key] = value;
  }
  return overlaid ?? seed;
}

/**
 * The search string after state changes — `null` when nothing declared
 * moved (the caller then skips the `replaceState`). `page` writes back
 * 1-based; non-page keys write their raw value. Params outside `urlSync`
 * are preserved as-is.
 */
export function urlSearchAfterStateChange(
  currentSearch: string,
  changes: ReadonlyArray<{ path: string; value: unknown }>,
  urlSync: readonly string[],
): string | null {
  if (urlSync.length === 0) return null;
  const params = new URLSearchParams(
    currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch,
  );
  let touched = false;
  for (const change of changes) {
    const key = change.path.startsWith("/")
      ? change.path.slice(1)
      : change.path;
    if (!urlSync.includes(key) || key.includes("/")) continue;
    if (key === PAGE_KEY) {
      const page = toNumber(change.value);
      if (page === null) continue;
      params.set(key, String(Math.max(0, Math.trunc(page)) + 1)); // 1-based
    } else if (change.value === undefined || change.value === null) {
      if (!params.has(key)) continue;
      params.delete(key);
    } else if (typeof change.value === "object") {
      continue;
    } else {
      if (params.get(key) === String(change.value)) continue;
      params.set(key, String(change.value));
    }
    touched = true;
  }
  if (!touched) return null;
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}
