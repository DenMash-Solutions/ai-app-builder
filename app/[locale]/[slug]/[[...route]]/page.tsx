import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import PreviewPage from "../preview-client";
import { getPublishedPageBySlug } from "@/lib/publish/featured";
import { servingArtifact } from "@/lib/publish/artifacts";
import { canonicalizeTag } from "@/lib/i18n/spec-languages";
import { getLiveProjectFrom } from "@/lib/publish/live-project";
import type { LiveProjectPage } from "@/lib/publish/live-project";
import { resolveLiveRoute } from "@/lib/publish/live-routes";
import { getPublishedEntryPointsFrom } from "@/lib/publish/project-publish";
import { asPublishClient } from "@/lib/publish/publish";
import { createPublicReadClient } from "@/lib/supabase/server";

/**
 * Blocking by decision (plan 056 F2): the baked `content` artifact must
 * serve as complete static HTML with JavaScript disabled — the zero-JS
 * contract (spec-languages task 5.4, enforced by the `javaScriptEnabled:
 * false` context in `e2e/authed.spec.ts` "publishes an entry and serves its
 * live URL"). A `<Suspense>` boundary (the generic streaming recipe)
 * delivers everything resolved after the first flush behind React's swap
 * scripts, which never run without JS: only the fallback would paint.
 * Measured — the no-JS assertion failed 3/3 runs with the boundary and
 * passed in every run without it. The decision-11 canonical-tag 404 moved
 * upstream to `proxy.ts`, so it sets the real status before the body
 * streams anyway; this export disables validation, not prerendering.
 */
export const instant = false;

/**
 * /{locale}/{slug}: local entries resolve client-side (owner preview); the
 * server resolves the published projection so anonymous visitors get the
 * live page. Local wins when both exist — the owner previewing their own
 * slug keeps the playground affordances, so this route always client-renders;
 * the publish-baked CSS is injected server-side to kill the FOUC.
 *
 * Plan 069 task 4 — the value may also be a project HANDLE (decision 17):
 * the `live_project` RPC answers when the slug table misses (the arbiter
 * keeps the two mutually exclusive, decisions 2/10), and a redirect
 * predecessor hops permanently to the current handle with the sub-path
 * preserved (one hop — decision 4's row can only point at one successor).
 * The handle's route resolves against the `published_entry_points`
 * snapshot (decision 18); a path nothing matches is a real 404
 * (decision 19).
 *
 * Content routes serve canonical tags only (decision 11): the layout lets
 * any segment through so the root can resolve bare slugs, and this page
 * re-establishes the guard the layout used to carry. `proxy.ts` already
 * decides it for every path its matcher reaches (real 404 before the body
 * streams); this check is the defense for dot-paths, which the matcher
 * excludes (`.*\..*`) — here it still sets a real 404, because this page
 * renders blocking (see above).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  // The share-cached slug read first: the arbiter makes a published slug
  // and a project handle mutually exclusive (decisions 2/10), so a hit can
  // never be a handle — the `live_project` RPC only fires on a slug miss.
  const published = await getPublishedPageBySlug(slug);
  if (published) return { title: published.name };
  const live = await getLiveProjectFrom(
    asPublishClient(createPublicReadClient()),
    slug,
  );
  return live ? { title: live.handle } : {};
}

export default async function SlugPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string; route?: string[] }>;
}) {
  const { locale, slug, route } = await params;
  if (canonicalizeTag(locale) === null) notFound();
  // 061-3 (§A): the catch-all carries the post-slug path — the flat screen
  // route's own `route` pattern (`/en/{slug}/{id}`) or a project namespace
  // (`/en/{project-slug}/…`). `null` = bare slug (today's shape). Local
  // entries and projects are device-local, so a path the server does NOT
  // serve stays client-resolved; a handle's path is server-resolved from
  // the snapshot below.
  const routePath = route && route.length > 0 ? route.join("/") : null;

  const client = asPublishClient(createPublicReadClient());
  // Share-cached slug read first (a published slug and a handle are
  // mutually exclusive in the arbiter, decisions 2/10) — the uncached
  // `live_project` RPC only fires when the slug table misses.
  const published = await getPublishedPageBySlug(slug);
  const live =
    published === null ? await getLiveProjectFrom(client, slug) : null;

  // Redirect hop for a changed handle (one permanent hop, sub-path kept).
  // `live_project` only ever answers PUBLISHED projects, so this can never
  // redirect into a dark site — a draft's old value 404s instead.
  if (live !== null && live.handle !== slug) {
    const suffix = routePath === null ? "" : `/${routePath}`;
    permanentRedirect(`/${locale}/${live.handle}${suffix}`);
  }

  if (live !== null) {
    const entryPoints = await getPublishedEntryPointsFrom(
      client,
      live.projectId,
    );
    const match =
      entryPoints === null
        ? null
        : resolveLiveRoute(entryPoints, routePath ?? "");
    // Decision 19: the handle exists but nothing serves this path — a real
    // 404, not the slug path's client-side panel.
    if (match === null) notFound();
    // Task 5 (decision 24): the live surface serves the matched snapshot
    // row's version-guarded bake as CSS (+ the precovered seeding below);
    // the static-HTML `content` branch stays a published-PAGES surface.
    const artifact = servingArtifact(match.entry, locale);
    const liveProject: LiveProjectPage = {
      projectId: live.projectId,
      handle: live.handle,
      spec: match.entry.spec,
      params: match.params,
    };
    return (
      <PreviewPage
        published={published}
        bakedCss={artifact?.css ?? null}
        routePath={routePath}
        liveProject={liveProject}
      />
    );
  }

  const artifact = published ? servingArtifact(published, locale) : null;
  return (
    <PreviewPage
      published={published}
      bakedCss={artifact?.css ?? null}
      routePath={routePath}
    />
  );
}
