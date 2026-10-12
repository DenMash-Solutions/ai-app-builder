"use client";

import { useEffect } from "react";
import { useActions } from "@json-render/react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { setFeatured } from "@/lib/admin/overview";

/**
 * Wires the admin spec's `admin.feature` / `admin.unfeature` actions to the
 * settings singleton; the page refetches the overview afterwards so the
 * featured badges and buttons re-derive from fresh state.
 */
export function AdminActions({
  supabase,
  onFeaturedChanged,
}: {
  supabase: Parameters<typeof setFeatured>[0];
  onFeaturedChanged: () => void;
}) {
  const { registerHandler } = useActions();
  const t = useTranslations();

  useEffect(() => {
    registerHandler("admin.feature", async (params) => {
      const result = await setFeatured(supabase, String(params.uiId ?? ""));
      if (!result.ok) {
        toast.error(t("admin.failed"));
        return;
      }
      toast.success(t("admin.featuredToast"));
      onFeaturedChanged();
    });

    registerHandler("admin.unfeature", async () => {
      const result = await setFeatured(supabase, null);
      if (!result.ok) {
        toast.error(t("admin.failed"));
        return;
      }
      toast.success(t("admin.unfeaturedToast"));
      onFeaturedChanged();
    });
  }, [registerHandler, supabase, t, onFeaturedChanged]);

  return null;
}
