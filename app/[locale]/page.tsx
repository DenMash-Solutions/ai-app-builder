import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Playground } from "@/components/playground";
import { PublicAccountCluster } from "@/components/shell/public-account-cluster";
import { LivePage } from "@/components/live/live-page";
import { StaticLive } from "@/components/live/static-live";
import {
  getFeaturedPage,
  getPublishedPageBySlug,
} from "@/lib/publish/featured";
import { servingArtifact } from "@/lib/publish/artifacts";
import { resolveRootServing } from "@/lib/publish/root-serving";
import { availableLanguages } from "@/lib/i18n/spec-languages";
import { routing } from "@/lib/i18n/routing";

/**
 * Root page (plan Q1): renders the admin-featured live page chrome-less.
 * Nothing featured → the playground landing (the app from minute one; all
 * pre-feature e2e keep passing). The owner keeps a way into the app: an
 * authed-only account cluster (Playground / Live pages / Sign out) floats
 * on the featured landing; anonymous visitors see pure content.
 *
 * Locale resolution (decision 12) — the root lives outside the (app) group
 * and is the single disambiguator for bare segments the proxy passes
 * through: app languages serve as always; a content-only language the
 * featured design carries serves its overlay (`/fr` → French design); any
 * other bare segment is the old slug sugar — a published slug redirects to
 * `/{default}/{slug}`, anything else 404s.
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
  const serving = await resolveRootServing(
    locale,
    featured ? availableLanguages(featured.spec) : [],
    (slug) => getPublishedPageBySlug(slug).then(Boolean),
  );
  if (serving === "redirect") redirect(`/${routing.defaultLocale}/${locale}`);
  if (serving === "not-found") notFound();
  // serve — the playground landing is app UI and stays behind the app's
  // languages (resolveRootServing 404s everything else when nothing is
  // featured).
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
