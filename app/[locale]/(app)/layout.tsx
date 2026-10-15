import { hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { LOCALES } from "@/lib/i18n/routing";

/**
 * App surfaces (landing, playground, admin, auth) speak the app's languages
 * only — the UI has no catalogs beyond them. Content-only locales may pass
 * the [locale] layout but must reach nothing but their own /{tag}/{slug}
 * routes (decision 11): `/fr/denmash` serves, `/fr/ui` is a 404.
 */
export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(LOCALES, locale)) {
    notFound();
  }
  return children;
}
