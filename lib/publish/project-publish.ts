import type { Spec } from "@json-render/core";
import type { HistoryEntry } from "@/lib/history";
import type { PublishClient } from "@/lib/publish/publish";
import { isClaimConflictError } from "@/lib/publish/publish";
import { revalidateProjection } from "@/lib/publish/revalidate";
import type { ProjectMembership } from "@/lib/projects/memberships";
import type { Project } from "@/lib/projects/projects";
import { projectHomeScreenId } from "@/lib/projects/screen-routes";

/**
 * Project publish flow (plan 069, task 3): the GLOBAL handle claim, the
 * entry-point snapshot and the `projects.status` flip that gates the live
 * projection. The per-screen flow in `publish.ts` stays untouched — a
 * project is a different claimant (decision 10 keeps the two kinds apart).
 *
 * **Fail-closed ordering, no RPC (decision 15).** `published_entry_points`
 * SELECT is gated by `project_is_published`, so:
 *
 *   publish   → upsert/delete entry points, THEN flip `status` — a failure
 *               midway leaves the site dark (rows exist but read as nothing)
 *   unpublish → delete entry points + redirects, THEN flip to draft — a
 *               failure midway leaves the site already dark, never serving
 *               a route that no longer exists
 *
 * The handle claim itself cannot half-land: `claim_project_handle` is an
 * AFTER trigger inside the same `UPDATE projects` statement, so the claim,
 * the old value's redirect row and the status flip commit together or not
 * at all (an AFTER-trigger exception still rolls the statement back).
 *
 * `status` / `handle` are read on demand here and never modelled locally
 * (decision 13) — `lib/history/sync.ts` deliberately drops them on push.
 */

export const PROJECT_PUBLISH_STATUS = {
  draft: "draft",
  published: "published",
  archived: "archived",
} as const;

export type ProjectPublishStatus =
  (typeof PROJECT_PUBLISH_STATUS)[keyof typeof PROJECT_PUBLISH_STATUS];

export interface ProjectPublishState {
  status: ProjectPublishStatus;
  /** The claimed global handle — null until the first publish. */
  handle: string | null;
  /** ISO timestamp of the last successful publish. */
  publishedAt: string | null;
}

/** One route of the snapshot: what serves `/{locale}/{handle}/{route}`. */
export interface ProjectEntryPoint {
  /** `''` is the home route; otherwise a slug or a membership pattern. */
  route: string;
  screenId: string;
  spec: Spec;
}

export interface ProjectPublishResult {
  ok: boolean;
  /** True when the handle is held by another claim (23505). */
  handleTaken?: boolean;
  error?: string;
  /** ISO timestamp stamped by a successful publish. */
  publishedAt?: string;
}

/** Unreadable/unknown status answers `draft` — the badge never guesses live. */
function toStatus(value: unknown): ProjectPublishStatus {
  if (value === PROJECT_PUBLISH_STATUS.published) {
    return PROJECT_PUBLISH_STATUS.published;
  }
  if (value === PROJECT_PUBLISH_STATUS.archived) {
    return PROJECT_PUBLISH_STATUS.archived;
  }
  return PROJECT_PUBLISH_STATUS.draft;
}

function toState(row: Record<string, unknown>): ProjectPublishState {
  const handle = row.handle;
  const publishedAt = row.published_at;
  return {
    status: toStatus(row.status),
    handle: typeof handle === "string" && handle !== "" ? handle : null,
    publishedAt: typeof publishedAt === "string" ? publishedAt : null,
  };
}

/**
 * The publish state of several projects in ONE explicit-column read (the
 * drawer badge needs every visible project). Missing ids simply have no
 * entry — a project the caller cannot see reads as "no state", never as an
 * error. An error answers `{}` (fail-closed: nothing shows as live).
 */
export async function getProjectPublishStates(
  client: PublishClient,
  projectIds: readonly string[],
): Promise<Record<string, ProjectPublishState>> {
  if (projectIds.length === 0) return {};
  const { data, error } = await client
    .from("projects")
    .select("id, status, handle, published_at")
    .in("id", [...projectIds]);
  if (error || !Array.isArray(data)) return {};
  const states: Record<string, ProjectPublishState> = {};
  for (const row of data) {
    const id = row.id;
    if (typeof id === "string" && id !== "") states[id] = toState(row);
  }
  return states;
}

/**
 * One project's state (the dialog). `null` means "could not be read" — the
 * caller must not paint a publish button from a guess (068's lesson: never
 * show a mode before the read settles).
 */
export async function getProjectPublishState(
  client: PublishClient,
  projectId: string,
): Promise<ProjectPublishState | null> {
  const states = await getProjectPublishStates(client, [projectId]);
  return states[projectId] ?? null;
}

/** The spec a screen publishes — identical to `publishEntry`'s choice. */
function headSpec(entry: HistoryEntry): Spec {
  return entry.revisions[entry.head]?.spec ?? entry.spec;
}

/**
 * The whole snapshot of a project's routes, in resolver precedence order
 * (mirrors `resolveProjectRoute`):
 *
 *   1. a member's own slug — the exact rung, so a slug always wins the path
 *      it shares with another member's pattern (the resolver checks exact
 *      matches first)
 *   2. the configured membership patterns (`settings`, `items/{id}`)
 *   3. `''` — the home screen, which serves the bare `/{locale}/{handle}`
 *
 * A member without a configured route is reachable at its slug; its id is
 * NOT published (the id rung is a preview convenience, and a uuid would
 * pollute the live namespace). Two members claiming one route value keep the
 * earlier position — deterministic, same tie-break the store uses.
 *
 * Pure: rows, entries and memberships are injected, so tests never touch
 * the localStorage-backed stores.
 */
export function buildProjectEntryPoints(
  project: Project,
  entries: readonly HistoryEntry[],
  memberships: readonly ProjectMembership[],
): ProjectEntryPoint[] {
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

  const byRoute = new Map<string, ProjectEntryPoint>();
  const add = (route: string, entry: HistoryEntry): void => {
    if (route === "" || byRoute.has(route)) return;
    byRoute.set(route, { route, screenId: entry.id, spec: headSpec(entry) });
  };

  for (const m of members) add(m.entry.slug, m.entry);
  for (const m of members) {
    if (m.row.route !== null) add(m.row.route, m.entry);
  }
  const homeId = projectHomeScreenId(project, entries, memberships);
  if (homeId !== null) {
    const home = members.find((m) => m.entry.id === homeId);
    if (home)
      byRoute.set("", {
        route: "",
        screenId: home.entry.id,
        spec: headSpec(home.entry),
      });
  }
  return [...byRoute.values()];
}

/**
 * Publish a project: snapshot every entry point, then claim the handle and
 * flip `status` in one statement (the sequence decision 15 orders).
 *
 * The entry-point write is an UPSERT keyed `(project_id, route)` followed by
 * a delete of routes the snapshot no longer contains (a screen left the
 * project, a route was renamed) — upserting first keeps a republish from
 * ever having a window where a live route is missing.
 *
 * Version: each route bumps its own counter, which is what the per-route
 * artifacts of task 5 key on. The SELECT that supplies it is gated by
 * `project_is_published`, so a draft project reads no rows — exactly the
 * case where none can exist (unpublish removed them before the flip).
 */
export async function publishProject(
  client: PublishClient,
  ownerId: string,
  project: Project,
  entries: readonly HistoryEntry[],
  memberships: readonly ProjectMembership[],
  handle: string,
): Promise<ProjectPublishResult> {
  const rows = buildProjectEntryPoints(project, entries, memberships);
  const publishedAt = new Date().toISOString();

  const { data: existing, error: readError } = await client
    .from("published_entry_points")
    .select("route, version")
    .eq("project_id", project.id);
  if (readError) return { ok: false, error: readError.message };
  const versions = new Map<string, number>();
  if (Array.isArray(existing)) {
    for (const row of existing) {
      versions.set(String(row.route), Number(row.version) || 0);
    }
  }

  if (rows.length > 0) {
    const payload = rows.map((row) => ({
      project_id: project.id,
      route: row.route,
      owner_id: ownerId,
      screen_id: row.screenId,
      spec: row.spec,
      version: (versions.get(row.route) ?? 0) + 1,
      artifacts: null,
      published_at: publishedAt,
    }));
    const { error } = await client
      .from("published_entry_points")
      .upsert(payload, { onConflict: "project_id,route" });
    if (error) return { ok: false, error: error.message };

    const current = new Set(rows.map((row) => row.route));
    const stale = [...versions.keys()].filter((route) => !current.has(route));
    if (stale.length > 0) {
      const { error: staleError } = await client
        .from("published_entry_points")
        .delete()
        .eq("project_id", project.id)
        .in("route", stale);
      if (staleError) return { ok: false, error: staleError.message };
    }
  }

  // The claim + status flip: one statement, so `claim_project_handle` runs
  // inside it (claim new → redirect old → refuse a foreign value).
  const { error: updateError } = await client
    .from("projects")
    .update({
      handle,
      status: PROJECT_PUBLISH_STATUS.published,
      published_at: publishedAt,
    })
    .eq("id", project.id);
  if (updateError) {
    if (isClaimConflictError(updateError.message)) {
      return { ok: false, handleTaken: true, error: updateError.message };
    }
    return { ok: false, error: updateError.message };
  }

  revalidateProjection(["published_entry_points"]);
  return { ok: true, publishedAt };
}

/**
 * Take a project offline: clear its entry points AND its redirect rows
 * first, then flip `status` to draft — the same fail-closed order as the
 * publish, so a failure midway leaves the site dark rather than half-serving
 * (task 3). The handle CLAIM is deliberately kept (decision 14): only the
 * status changes, so `claim_project_handle` early-returns and the owner's
 * URL stays reserved while they are offline.
 */
export async function unpublishProject(
  client: PublishClient,
  projectId: string,
): Promise<ProjectPublishResult> {
  const { error: entryError } = await client
    .from("published_entry_points")
    .delete()
    .eq("project_id", projectId);
  if (entryError) return { ok: false, error: entryError.message };

  const { error: redirectError } = await client
    .from("route_redirects")
    .delete()
    .eq("project_id", projectId);
  if (redirectError) return { ok: false, error: redirectError.message };

  const { error: updateError } = await client
    .from("projects")
    .update({ status: PROJECT_PUBLISH_STATUS.draft })
    .eq("id", projectId);
  if (updateError) return { ok: false, error: updateError.message };

  revalidateProjection(["published_entry_points"]);
  return { ok: true };
}
