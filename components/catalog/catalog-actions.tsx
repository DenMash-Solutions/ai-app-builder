"use client";

/**
 * Runtime handlers for the marketplace spec actions (plan 073, decision 10 —
 * the admin-actions precedent): `catalog.open` / `catalog.back` navigate,
 * `catalog.preview` installs the template into a throwaway `Preview: …`
 * project and opens it, `catalog.use` installs it into a NEW permanent
 * project. Every failure path removes the half-built project again, so a
 * refused install never leaves junk behind.
 */
import { useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { getByPath } from "@json-render/core";
import { useActions, useStateStore } from "@json-render/react";
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
  const { state } = useStateStore();
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  /**
   * `{"$item": "assetId"}` in ACTION params resolves to the item's state
   * PATH, not its value (props resolve to values). Cards live in a repeat, so
   * the browse frame hands over `/catalog/visible/<i>/assetId`; reading it
   * back from the spec state gives the id. A literal id (the detail frame's
   * `$state` param) resolves to undefined and passes through unchanged.
   */
  const assetIdOf = (params: Record<string, unknown>): string => {
    const raw = typeof params.assetId === "string" ? params.assetId : "";
    if (raw === "") return "";
    const value = getByPath(
      stateRef.current,
      raw.startsWith("/") ? raw : `/${raw}`,
    );
    return typeof value === "string" && value !== "" ? value : raw;
  };

  useEffect(() => {
    registerHandler(CATALOG_ACTIONS.open, async (params) => {
      const assetId = assetIdOf(params);
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
      install(assetIdOf(params), true);
    });

    registerHandler(CATALOG_ACTIONS.use, async (params) => {
      install(assetIdOf(params), false);
    });
  }, [registerHandler, router, locale, t]);

  return null;
}
