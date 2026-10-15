import type { Metadata } from "next";
import { Playground } from "@/components/playground";
import { PublicAccountCluster } from "@/components/shell/public-account-cluster";
import { LivePage } from "@/components/live/live-page";
import { StaticLive } from "@/components/live/static-live";
import { getFeaturedPage } from "@/lib/publish/featured";
import { servingArtifact } from "@/lib/publish/artifacts";

/**
 * Root page (plan Q1): renders the admin-featured live page chrome-less.
 * Nothing featured → the playground landing (the app from minute one; all
 * pre-feature e2e keep passing). The owner keeps a way into the app: an
 * authed-only account cluster (Playground / Live pages / Sign out) floats
 * on the featured landing; anonymous visitors see pure content.
 *
 * A baked `content` artifact is served as pure static HTML + CSS (no spec
 * client components — paints styled with JS disabled); `stateful` (or a
 * pre-bake page) renders client-side, with the baked CSS injected to kill the
 * FOUC where available.
 */
export async function generateMetadata(): Promise<Metadata> {
  const featured = await getFeaturedPage();
  return featured ? { title: featured.name } : {};
}

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const featured = await getFeaturedPage();
  if (!featured) return <Playground />;
  const artifact = servingArtifact(featured, locale);

  if (artifact?.kind === "content") {
    return (
      <>
        <StaticLive artifact={artifact} locale={locale} />
        <PublicAccountCluster />
      </>
    );
  }
  return (
    <>
      <LivePage spec={featured.spec} bakedCss={artifact?.css ?? null} />
      <PublicAccountCluster />
    </>
  );
}
