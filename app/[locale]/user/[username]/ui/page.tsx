import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Link } from "@/lib/i18n/navigation";
import { routing } from "@/lib/i18n/routing";
import { canonicalizeTag } from "@/lib/i18n/spec-languages";
import { readPublicProfile } from "@/lib/profile/public-profile";
import { createPublicReadClient } from "@/lib/supabase/server";

/**
 * /{locale}/user/{username}/ui — the public profile (plan 068).
 *
 * Reads the projection with a cookie-free anon client; `readPublicProfile`
 * resolves the handle through the `public_profile` RPC and lists only
 * `published_pages` rows for that owner, so drafts and browser-local entries
 * cannot leak into the payload (F7).
 *
 * Blocking by decision: an unknown handle must answer 404 with a real status,
 * which is only possible before the body streams (loading.md, Status Codes).
 * Same export reasoning as the /{locale}/{slug} route.
 */
export const instant = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; username: string }>;
}): Promise<Metadata> {
  const { locale, username } = await params;
  const profile = await readPublicProfile(createPublicReadClient(), username);
  if (!profile) return {};
  const tag = canonicalizeTag(locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: tag, namespace: "profile" });
  return {
    title: t("title", { username: profile.username }),
    description: t("description", { username: profile.username }),
  };
}

export default async function UserProfilePage({
  params,
}: {
  params: Promise<{ locale: string; username: string }>;
}) {
  const { locale, username } = await params;
  if (canonicalizeTag(locale) === null) notFound();
  const profile = await readPublicProfile(createPublicReadClient(), username);
  if (!profile) notFound();
  const t = await getTranslations({ locale, namespace: "profile" });

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <header className="mb-8 space-y-1">
        <p className="text-sm text-muted-foreground">@{profile.username}</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("title", { username: profile.username })}
        </h1>
      </header>

      {profile.pages.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {profile.pages.map((page) => (
            <li key={page.ui_id}>
              <Link
                href={`/${page.slug}`}
                className="block rounded-lg border p-4 transition-colors hover:bg-accent"
              >
                <span className="block truncate font-medium">{page.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  /{page.slug}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
