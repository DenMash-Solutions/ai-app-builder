import type { Spec } from "@json-render/core";
import { asPublishClient } from "@/lib/publish/publish";
import type { PublishClient } from "@/lib/publish/publish";
import { createPublicReadClient } from "@/lib/supabase/server";

/**
 * Live handle lookup (plan 069 task 4, decision 17): the SECURITY DEFINER
 * `live_project(p_value)` RPC answers which PUBLISHED project serves a
 * value — the current handle directly, or a `route_redirects` predecessor
 * (then `handle` differs from the looked-up value and the caller hops).
 *
 * The function is the only read path: `projects` stays owner-only and
 * `route_claims` stays policy-less, and only `project_id` + `handle` of a
 * published project ever leave the RPC (no owner, state or name).
 * Fail-closed: an error or a malformed row answers `null`, so the surface
 * 404s rather than serving a guessed project.
 */
export interface LiveProjectRef {
  projectId: string;
  /** The project's CURRENT handle — differs from the value on a redirect. */
  handle: string;
}

/** A resolved live route: the snapshot spec + the path's captured params. */
export interface LiveProjectPage extends LiveProjectRef {
  /** The `published_entry_points` snapshot spec (decision 18). */
  spec: Spec;
  /** `{param}` captures from the snapshot's route pattern (empty for exact). */
  params: Record<string, string>;
}

/** One `live_project` call against an injected client (mockable in tests). */
export async function getLiveProjectFrom(
  client: PublishClient,
  value: string,
): Promise<LiveProjectRef | null> {
  const { data, error } = await client.rpc("live_project", { p_value: value });
  if (error || data === null || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  const projectId = row.project_id;
  const handle = row.handle;
  if (typeof projectId !== "string" || projectId === "") return null;
  if (typeof handle !== "string" || handle === "") return null;
  return { projectId, handle };
}

/**
 * Existence probe for the bare-segment decision (`resolveRootServing`): a
 * bare `/{value}` must redirect when a live project holds the value, and
 * 404 otherwise (drafts answer null — the site is dark either way).
 */
export async function liveProjectExistsFrom(
  client: PublishClient,
  value: string,
): Promise<boolean> {
  return (await getLiveProjectFrom(client, value)) !== null;
}

/** Convenience reader for RSC pages — the cookie-free anon projection client. */
export async function getLiveProject(
  value: string,
): Promise<LiveProjectRef | null> {
  return getLiveProjectFrom(asPublishClient(createPublicReadClient()), value);
}
