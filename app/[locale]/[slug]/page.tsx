import type { Metadata } from "next";
import PreviewPage from "./preview-client";
import { getPublishedPageBySlug } from "@/lib/publish/featured";

/**
 * /{locale}/{slug}: local entries resolve client-side (owner preview); the
 * server resolves the published projection so anonymous visitors get the
 * live page. Local wins when both exist — the owner previewing their own
 * slug keeps the playground affordances.
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
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const published = await getPublishedPageBySlug(slug);
  return <PreviewPage published={published} />;
}
