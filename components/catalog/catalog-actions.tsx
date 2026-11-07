"use client";

/**
 * Runtime handlers for the marketplace spec actions (plan 073, decision 10 —
 * the admin-actions precedent): `catalog.open` / `catalog.back` navigate,
 * `catalog.preview` installs the template into a throwaway `Preview: …`
 * project and opens it, `catalog.use` installs it into a NEW permanent
 * project. Every failure path removes the half-built project again, so a
 * refused install never leaves junk behind.
 */
import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useActions } from "@json-render/react";
import { toast } from "sonner";
import { CATALOG_TYPES, getCatalogAssets } from "@/lib/catalog/catalog";
import { previewProjectName } from "@/lib/catalog/preview";
import { installProjectTemplate } from "@/lib/catalog/project-install";
import { CATALOG_ACTIONS } from "@/lib/catalog/surface";
import { createProject, removeProject } from "@/lib/projects/projects";

export function CatalogActions() {
  const { registerHandler } = useActions();
  const router = useRouter();
  const { locale } = useParams<{ locale: string }>();
  const t = useTranslations("catalog");

  useEffect(() => {
    registerHandler(CATALOG_ACTIONS.open, async (params) => {
      const assetId = typeof params.assetId === "string" ? params.assetId : "";
      if (assetId === "") return;
      router.push(`/${locale}/catalog/${assetId}`);
    });

    registerHandler(CATALOG_ACTIONS.back, async () => {
      router.push(`/${locale}/catalog`);
    });

    /** Creates a project for `assetId`, installs the template, navigates. */
    const install = (assetId: string, preview: boolean): void => {
      const asset = getCatalogAssets().find(
        (row) => row.id === assetId && row.type === CATALOG_TYPES.project,
      );
      if (!asset) {
        toast.error(t(preview ? "previewFailed" : "useFailed"));
        return;
      }
      const project = createProject(
        preview ? previewProjectName(asset.name) : asset.name,
      );
      if (!project) {
        toast.error(t(preview ? "previewFailed" : "useFailed"));
        return;
      }
      const result = installProjectTemplate({
        projectId: project.id,
        assetId: asset.id,
      });
      if (!result.ok) {
        // Partial installs are recoverable by design — remove it here so the
        // user never sees the half-built project the failure would leave.
        removeProject(project.id);
        toast.error(t(preview ? "previewFailed" : "useFailed"));
        return;
      }
      if (!preview) toast.success(t("installed", { name: asset.name }));
      router.push(`/${locale}/${project.slug}`);
    };

    registerHandler(CATALOG_ACTIONS.preview, async (params) => {
      install(typeof params.assetId === "string" ? params.assetId : "", true);
    });

    registerHandler(CATALOG_ACTIONS.use, async (params) => {
      install(typeof params.assetId === "string" ? params.assetId : "", false);
    });
  }, [registerHandler, router, locale, t]);

  return null;
}
