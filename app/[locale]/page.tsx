import type { Metadata } from "next";
import { Playground } from "@/components/playground";
import { PublicAccountCluster } from "@/components/shell/public-account-cluster";
import { LivePage } from "@/components/live/live-page";
import { getFeaturedPage } from "@/lib/publish/featured";

/**
 * Root page (plan Q1): renders the admin-featured live page chrome-less.
 * Nothing featured → the playground landing (the app from minute one; all
 * pre-feature e2e keep passing). The owner keeps a way into the app: an
 * authed-only account cluster (Playground / Live pages / Sign out) floats
 * on the featured landing; anonymous visitors see pure content.
 */
export async function generateMetadata(): Promise<Metadata> {
  const featured = await getFeaturedPage();
  return featured ? { title: featured.name } : {};
}

export default async function Home() {
  const featured = await getFeaturedPage();
  if (!featured) return <Playground />;
  return (
    <>
      <LivePage spec={featured.spec} />
      <PublicAccountCluster />
    </>
  );
}
