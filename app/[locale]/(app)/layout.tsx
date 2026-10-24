import { hasLocale } from "next-intl";
import { notFound } from "next/navigation";
import { SyncEngine } from "@/components/sync/sync-engine";
import { UploadNudge } from "@/components/sync/upload-nudge";
import { LOCALES } from "@/lib/i18n/routing";

/**
 * App surfaces (playground, admin, auth) speak the app's languages only —
 * the UI has no catalogs beyond them. Content-only locales may pass the
 * [locale] layout but must reach nothing but content routes (decisions 11
 * and 12): `/fr/denmash` serves, `/fr` serves the featured root, `/fr/ui`
 * is a 404. The root page itself lives outside this group so it can serve
 * the featured design in every language it carries.
 *
 * Account sync lives HERE, not in the root layout (plan 055): history can
 * only change on these surfaces, and the read-only preview/published
 * routes must never pay for a pull+push cycle. One mount for the whole
 * group means `/ui` → `/ui/[id]` navigation never restarts the sync.
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
  return (
    <>
      <SyncEngine />
      <UploadNudge />
      {children}
    </>
  );
}
