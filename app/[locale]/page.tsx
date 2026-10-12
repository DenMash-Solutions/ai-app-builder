import type { Metadata } from "next";
import { Playground } from "@/components/playground";
import { LivePage } from "@/components/live/live-page";
import { getFeaturedPage } from "@/lib/publish/featured";

/**
 * Root page (plan Q1): renders the admin-featured live page chrome-less.
 * Nothing featured → the playground landing (the app from minute one; all
 * pre-feature e2e keep passing).
 */
export async function generateMetadata(): Promise<Metadata> {
  const featured = await getFeaturedPage();
  return featured ? { title: featured.name } : {};
}

export default async function Home() {
  const featured = await getFeaturedPage();
  if (!featured) return <Playground />;
  return <LivePage spec={featured.spec} />;
}
