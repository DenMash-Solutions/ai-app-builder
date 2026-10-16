import { hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { LOCALES } from "@/lib/i18n/routing";

/**
 * App surfaces (playground, admin, auth) speak the app's languages only —
 * the UI has no catalogs beyond them. Content-only locales may pass the
 * [locale] layout but must reach nothing but content routes (decisions 11
 * and 12): `/fr/denmash` serves, `/fr` serves the featured root, `/fr/ui`
 * is a 404. The root page itself lives outside this group so it can serve
 * the featured design in every language it carries.
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
