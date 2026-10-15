"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { Spec } from "@json-render/core";
import { useAuth } from "@/components/auth/auth-provider";
import { AdminActions } from "@/components/admin/admin-actions";
import {
  EditInPlaygroundPill,
  SpecPage,
} from "@/components/spec-page/spec-page";
import { buildAdminSpec } from "@/lib/admin/admin-spec";
import { loadOverview } from "@/lib/admin/overview";
import type { AdminOverview } from "@/lib/admin/overview";
import { createClient } from "@/lib/supabase/client";
import adminSpecJson from "@/lib/specs/admin.spec.json";

// Committed spec (spec-mandate, generated once): the frame — cards and
// per-page actions are composed in by buildAdminSpec from live data.
const baseSpec = adminSpecJson as unknown as Spec;

/**
 * Admin console (plan Q2/Q5): admin-only (client guard + RLS), renders the
 * committed spec with a card per published page, feature/unfeature actions,
 * and the (admin-context) "Edit in playground" affordance.
 */
export default function AdminPage() {
  const t = useTranslations();
  const { locale } = useParams<{ locale: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const { user, role, loading } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // `role === null` right after auth settles means "fetch still in flight" —
  // wait for it; only a resolved non-admin (or no session at all) is denied.
  const denied = !loading && (user === null || role === "user");

  useEffect(() => {
    if (!denied) return;
    // Anonymous visitors go to sign-in with a return path (instead of the
    // old silent bounce to the root); signed-in non-admins go home.
    if (user === null) {
      router.replace(`/${locale}/login?next=${encodeURIComponent(pathname)}`);
    } else {
      router.replace(`/${locale}`);
    }
  }, [denied, user, router, locale, pathname]);

  useEffect(() => {
    if (role !== "admin") return;
    let cancelled = false;
    void loadOverview(supabase).then((next) => {
      if (!cancelled) setOverview(next);
    });
    return () => {
      cancelled = true;
    };
  }, [role, supabase, reloadKey]);

  const spec = useMemo(() => {
    if (!overview) return baseSpec;
    return buildAdminSpec(baseSpec, overview.pages, locale, {
      openLive: t("admin.openLive"),
      feature: t("admin.feature"),
      unfeature: t("admin.unfeature"),
      featuredBadge: t("admin.featuredBadge"),
    });
  }, [overview, locale, t]);

  if (loading || role !== "admin") {
    return (
      // Not a `<main>`: the admin route sits inside the app shell, whose
      // `SidebarInset` provides the landmark.
      <div className="flex h-[100dvh] w-full items-center justify-center">
        <p className="text-sm text-muted-foreground">{t("admin.loading")}</p>
      </div>
    );
  }

  return (
    <SpecPage
      main={false}
      spec={spec}
      extraState={{
        locale,
        copy: {
          title: t("admin.title"),
          description: t("admin.description"),
          empty: t("admin.empty"),
        },
      }}
    >
      <AdminActions
        supabase={supabase}
        onFeaturedChanged={() => setReloadKey((key) => key + 1)}
      />
      <EditInPlaygroundPill spec={spec} />
    </SpecPage>
  );
}
