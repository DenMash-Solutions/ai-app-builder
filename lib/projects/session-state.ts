/**
 * Shared-state helpers (plan 061-4, A3 decision 5) — pure functions, no
 * hooks (the lib/ dependency-injection rule).
 *
 * Two independent halves of "one project = one app":
 *
 * - `mergeSessionState` — the seed side: the project store's `/session`
 *   value joins every member screen's initial state so a value written on
 *   screen A is readable on screen B.
 * - `dataNamespaceFor` — the data side: `QueryLoader namespace = projectId`
 *   makes two screens' `genui-data:{projectId}:{collection}` rows and
 *   `genui_records.app_id` coincide, so records written on one screen are
 *   visible from the other (043 D6 derives both from the namespace — zero
 *   adapter changes).
 */

/**
 * Strip the shared subtree from a screen's seed (061-4, A3 decision 5,
 * revised): project screens NEVER seed `session` from their spec. The seed
 * is computed at render from a snapshot that can predate a concurrent
 * write — under Next 16's `<Activity>` (plan 059) routes stay mounted, so
 * a seed applied after a fresher value landed would re-add a STALE session
 * (the race the e2e proved). A seed omitting the key makes the provider's
 * `initialState` diff DELETE `/session` on every screen change, and
 * `<SessionSync>` pulls the live store value back pre-paint instead.
 * Non-project screens keep their spec defaults — no SessionSync mounts
 * there.
 */
export function omitSessionState(
  base: Record<string, unknown>,
): Record<string, unknown> {
  const rest = { ...base };
  delete rest.session;
  return rest;
}

/**
 * The `QueryLoader` namespace for an entry: the project id when the screen
 * belongs to one, else the caller's per-screen fallback (entry id in the
 * editor, slug on preview — 043 D6's isolation rule for project-less
 * screens stays exactly as it was).
 */
export function dataNamespaceFor(
  entry: { projectId?: string | null } | null | undefined,
  fallback: string,
): string {
  return entry?.projectId ?? fallback;
}
