"use client";

/**
 * Preview lifecycle banner (plan 073, decision 2): a preview is a normal
 * local project marked by its `Preview: ` name prefix, so the banner simply
 * reflects the project the viewer is currently inside. "Use this template"
 * keeps it — rename (prefix stripped, the project stays a project) and
 * follow the new slug; "Discard" removes the project through the existing
 * deletion path (which already purges its local and remote data).
 *
 * Mounted by the live project route (the chrome-less surface the preview
 * opens on), so it can never appear on an unrelated page.
 */
import { useMemo, useSyncExternalStore } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  getProjects,
  getServerProjects,
  projectBySlug,
  removeProject,
  renameProject,
  subscribeProjects,
} from "@/lib/projects/projects";
import { isPreviewProject, previewTemplateName } from "@/lib/catalog/preview";

export function PreviewTemplateBanner({ slug }: { slug: string }) {
  const t = useTranslations("catalog");
  const router = useRouter();
  const { locale } = useParams<{ locale: string }>();
  const projects = useSyncExternalStore(
    subscribeProjects,
    getProjects,
    getServerProjects,
  );

  const project = useMemo(
    () => projects.find((row) => row.slug === slug) ?? projectBySlug(slug),
    [projects, slug],
  );

  // SSR (and a browser without the project) renders nothing; hydration
  // brings the row in and the banner appears with it.
  if (!project || !isPreviewProject(project.name)) return null;

  const handleKeep = () => {
    renameProject(project.id, previewTemplateName(project.name));
    toast.success(t("kept"));
    const renamed = getProjects().find((row) => row.id === project.id);
    if (renamed) router.push(`/${locale}/${renamed.slug}`);
  };

  const handleDiscard = () => {
    removeProject(project.id);
    toast.success(t("discarded"));
    router.push(`/${locale}/catalog`);
  };

  return (
    <div
      data-preview-banner
      className="fixed bottom-4 left-4 z-50 flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-2 rounded-lg border border-border bg-background/95 px-3 py-2 shadow-lg backdrop-blur"
    >
      <span className="mr-1 text-sm font-medium">
        {t("previewBanner", { name: previewTemplateName(project.name) })}
      </span>
      <Button type="button" size="sm" variant="secondary" onClick={handleKeep}>
        {t("keepTemplate")}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={handleDiscard}>
        {t("discardPreview")}
      </Button>
    </div>
  );
}
