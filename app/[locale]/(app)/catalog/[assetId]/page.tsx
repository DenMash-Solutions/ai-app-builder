"use client";

import { Suspense, useEffect, useMemo } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { Spec } from "@json-render/core";
import { useAuth } from "@/components/auth/auth-provider";
import { CatalogActions } from "@/components/catalog/catalog-actions";
import {
  useAdoptPublicCatalog,
  useCatalogLabels,
  useCatalogState,
} from "@/components/catalog/use-catalog";
import { SpecPage } from "@/components/spec-page/spec-page";
import { Skeleton } from "@/components/ui/skeleton";
import {
  buildCatalogDetailSpec,
  catalogDetailModel,
  type CatalogDetailModel,
} from "@/lib/catalog/browse-spec";
import { marketplaceRegistry } from "@/lib/catalog/surface-registry";
import catalogDetailSpecJson from "@/lib/specs/catalog-detail.spec.json";

const baseSpec = catalogDetailSpecJson as unknown as Spec;

const EMPTY_DETAIL: CatalogDetailModel = {
  assetId: "",
  name: "",
  description: "",
  typeLabel: "",
  summary: "",
  screens: [],
  screenCount: 0,
  componentCount: 0,
  empty: true,
};

/**
 * Marketplace detail (`/catalog/{assetId}`): the manifest summary (screens
 * and routes) plus the two lifecycle actions — Preview (throwaway project)
 * and Use (new permanent project).
 *
 * The asset id is an arbitrary param (no `generateStaticParams`), so it is
 * unknown during prerendering and `useParams` suspends — the reader must
 * sit inside Suspense or the Cache Components build fails
 * (`node_modules/next/dist/docs/.../dynamic-routes.md`, "Without
 * generateStaticParams"; same shape as the `/ui/[ref]` route).
 */
function CatalogDetail() {
  const t = useTranslations("catalog");
  const { locale, assetId } = useParams<{
    locale: string;
    assetId: string;
  }>();
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading } = useAuth();
  const state = useCatalogState();
  const labels = useCatalogLabels();
  useAdoptPublicCatalog();

  const denied = !loading && user === null;

  useEffect(() => {
    if (!denied) return;
    router.replace(`/${locale}/login?next=${encodeURIComponent(pathname)}`);
  }, [denied, router, locale, pathname]);

  const detail = useMemo<CatalogDetailModel>(() => {
    const id = Array.isArray(assetId) ? assetId[0] : assetId;
    const asset = state.assets.find((row) => row.id === id);
    if (!asset) return EMPTY_DETAIL;
    const version = asset.latestVersionId
      ? (state.versions.find((row) => row.id === asset.latestVersionId) ?? null)
      : null;
    return catalogDetailModel(asset, version, labels) ?? EMPTY_DETAIL;
  }, [state, assetId, labels]);

  const spec = useMemo(
    () => buildCatalogDetailSpec(baseSpec, detail),
    [detail],
  );

  const copy = useMemo(
    () => ({
      back: t("back"),
      preview: t("preview"),
      use: t("use"),
      screens: t("screens"),
      notFound: t("notFound"),
    }),
    [t],
  );

  if (loading || user === null) {
    return (
      <div className="flex h-[100dvh] w-full items-center justify-center">
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      </div>
    );
  }

  return (
    <SpecPage
      main={false}
      spec={spec}
      registry={marketplaceRegistry}
      extraState={{ locale, copy }}
    >
      <CatalogActions />
    </SpecPage>
  );
}

export default function CatalogDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-[100dvh] w-full items-center justify-center p-8">
          <Skeleton className="h-64 w-full max-w-3xl rounded-md" />
        </div>
      }
    >
      <CatalogDetail />
    </Suspense>
  );
}
