"use client";

import { useEffect, useMemo } from "react";
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
import {
  buildCatalogSpec,
  CATALOG_CARD_CAP,
  CATALOG_FILTER_VALUES,
  catalogCardRow,
  type CatalogCardRow,
} from "@/lib/catalog/browse-spec";
import { marketplaceRegistry } from "@/lib/catalog/surface-registry";
import catalogSpecJson from "@/lib/specs/catalog.spec.json";

// Committed frame (spec-mandate, plan 073 decision 10): the builder seeds the
// grid rows; search/facets/filtering are the spec's own D7 pipeline.
const baseSpec = catalogSpecJson as unknown as Spec;

/**
 * Marketplace browse (`/catalog`): the whole catalog — templates, screens and
 * components — as live scaled-render cards with search, type and My-content
 * facets. Signed-out visitors are sent to sign-in (adoption needs a user,
 * same as the picker's Catalog tab).
 */
export default function CatalogPage() {
  const t = useTranslations("catalog");
  const { locale } = useParams<{ locale: string }>();
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

  const rows = useMemo<CatalogCardRow[]>(() => {
    const versions = new Map(state.versions.map((row) => [row.id, row]));
    const ownerId = user?.id ?? "";
    return [...state.assets]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, CATALOG_CARD_CAP)
      .map((asset) =>
        catalogCardRow(
          asset,
          asset.latestVersionId
            ? (versions.get(asset.latestVersionId) ?? null)
            : null,
          ownerId,
          labels,
        ),
      )
      .filter((row): row is CatalogCardRow => row !== null);
  }, [state, user, labels]);

  const spec = useMemo(() => buildCatalogSpec(baseSpec, rows), [rows]);

  const copy = useMemo(
    () => ({
      title: t("title"),
      description: t("description"),
      empty: t("empty"),
      searchPlaceholder: t("searchPlaceholder"),
      sortLatest: t("sortLatest"),
      open: t("open"),
      typeButtons: [
        { label: t("typeAll"), value: CATALOG_FILTER_VALUES.type.all },
        {
          label: t("typeTemplates"),
          value: CATALOG_FILTER_VALUES.type.project,
        },
        { label: t("typeScreens"), value: CATALOG_FILTER_VALUES.type.screen },
        {
          label: t("typeComponents"),
          value: CATALOG_FILTER_VALUES.type.component,
        },
      ],
      scopeButtons: [
        { label: t("scopeAll"), value: CATALOG_FILTER_VALUES.all },
        { label: t("scopeMine"), value: CATALOG_FILTER_VALUES.mine },
      ],
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
