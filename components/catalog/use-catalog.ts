"use client";

/** Shared client plumbing for the marketplace surfaces (plan 073). */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth/auth-provider";
import { adoptPublicCatalog } from "@/lib/catalog/browse";
import type { CatalogCardLabels } from "@/lib/catalog/browse-spec";
import {
  getCatalogState,
  getServerCatalog,
  subscribeCatalog,
  type CatalogState,
} from "@/lib/catalog/catalog";
import type { SyncClient } from "@/lib/history/sync";
import { createClient } from "@/lib/supabase/client";

/** The live catalog store (adoption + sync both write through it). */
export function useCatalogState(): CatalogState {
  return useSyncExternalStore(
    subscribeCatalog,
    getCatalogState,
    getServerCatalog,
  );
}

/**
 * Adopts foreign public rows while a signed-in visitor browses (decision 7:
 * the route needs a user, same as the picker's Catalog tab) — idempotent,
 * LWW-guarded and fire-and-forget; the store subscription re-renders rows.
 */
export function useAdoptPublicCatalog(): void {
  const { user } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  useEffect(() => {
    if (!user) return;
    // One cast at the single integration point (the TS2589 adapter
    // discipline — same as the picker's structure tab).
    const client = supabase as unknown as SyncClient;
    void adoptPublicCatalog(client, user.id);
  }, [user, supabase]);
}

/** Translated labels for the row/detail builders. */
export function useCatalogLabels(): CatalogCardLabels {
  const t = useTranslations("catalog");
  return useMemo(
    () => ({
      template: t("typeTemplate"),
      screen: t("typeScreen"),
      component: t("typeComponent"),
      screensUnit: t("screensUnit"),
    }),
    [t],
  );
}
