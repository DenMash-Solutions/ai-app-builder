import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PreviewPage from "./preview-client";
import { getPublishedPageBySlug } from "@/lib/publish/featured";
import { servingArtifact } from "@/lib/publish/artifacts";
import { canonicalizeTag } from "@/lib/i18n/spec-languages";

/**
 * /{locale}/{slug}: local entries resolve client-side (owner preview); the
 * server resolves the published projection so anonymous visitors get the
 * live page. Local wins when both exist — the owner previewing their own
 * slug keeps the playground affordances, so this route always client-renders;
 * the publish-baked CSS is injected server-side to kill the FOUC.
 *
 * Content routes serve canonical tags only (decision 11): the layout lets
 * any segment through so the root can resolve bare slugs, and this page
 * re-establishes the guard the layout used to carry.
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
