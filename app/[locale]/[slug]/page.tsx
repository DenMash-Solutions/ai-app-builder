import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PreviewPage from "./preview-client";
import { getPublishedPageBySlug } from "@/lib/publish/featured";
import { servingArtifact } from "@/lib/publish/artifacts";
import { canonicalizeTag } from "@/lib/i18n/spec-languages";

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
  const published = await getPublishedPageBySlug(slug);
  return published ? { title: published.name } : {};
}

export default async function SlugPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (canonicalizeTag(locale) === null) notFound();
  const published = await getPublishedPageBySlug(slug);
  const artifact = published ? servingArtifact(published, locale) : null;
  return <PreviewPage published={published} bakedCss={artifact?.css ?? null} />;
}
