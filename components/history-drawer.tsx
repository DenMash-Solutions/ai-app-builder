"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent } from "react";
import type { Spec } from "@json-render/core";
import { Check, Copy, Folder, Pencil, Plus, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { JsonImportButton } from "@/components/playground/json-import-button";
import { JsonUpdateButton } from "@/components/playground/json-update-button";
import { GoLiveDialog } from "@/components/publish/go-live-dialog";
import { PublishActions } from "@/components/publish/publish-actions";
import type { HistoryEntry } from "@/lib/history";
import { formatRelativeTime } from "@/lib/history";
import { copySpecToClipboard } from "@/lib/playground/json-io";
import { getPublishedState, asPublishClient } from "@/lib/publish/publish";
import type { PublishedPage } from "@/lib/publish/publish";
import {
  createProject,
  getActiveProjectId,
  getProjects,
  getServerActiveProjectId,
  getServerProjects,
  removeProject,
  renameProject,
  setActiveProjectId,
  subscribeActiveProject,
  subscribeProjects,
} from "@/lib/projects/projects";
import type { Project } from "@/lib/projects/projects";
import { createClient } from "@/lib/supabase/client";

interface HistoryDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: HistoryEntry[];
  activeId: string | null;
  onSelect: (entry: HistoryEntry) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  onImportJson: (spec: Spec) => void;
  /** Plan 063: re-import into an existing screen (confirmed in the dialog). */
  onUpdateJson: (targetId: string, spec: Spec) => void;
}

/** One project's group of screens — `project: null` is the legacy bucket. */
interface ProjectGroup {
  project: Project | null;
  entries: HistoryEntry[];
}

export function HistoryDrawer({
  open,
  onOpenChange,
  entries,
  activeId,
  onSelect,
  onDelete,
  onClear,
  onImportJson,
  onUpdateJson,
}: HistoryDrawerProps) {
  const t = useTranslations();
  const locale = useLocale();
  const { user, loading } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const [publishedMap, setPublishedMap] = useState<
    Record<string, PublishedPage>
  >({});
  const [goLiveEntry, setGoLiveEntry] = useState<HistoryEntry | null>(null);

  // Project grouping (plan 061 A1): every project is listed (even a screenless
  // one — a freshly created project must be visible), entries whose projectId
  // is absent or dangling fall into the trailing legacy group.
  const projects = useSyncExternalStore(
    subscribeProjects,
    getProjects,
    getServerProjects,
  );
  const activeProjectId = useSyncExternalStore(
    subscribeActiveProject,
    getActiveProjectId,
    getServerActiveProjectId,
  );
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectDraft, setProjectDraft] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const groups = useMemo<ProjectGroup[]>(() => {
    const buckets = projects.map((project) => ({
      project,
      entries: [] as HistoryEntry[],
    }));
    const byId = new Map(
      projects.map((project, index) => [project.id, buckets[index]]),
    );
    const legacy: HistoryEntry[] = [];
    for (const entry of entries) {
      const bucket = entry.projectId ? byId.get(entry.projectId) : undefined;
      if (bucket) bucket.entries.push(entry);
      else legacy.push(entry);
    }
    return legacy.length > 0
      ? [...buckets, { project: null, entries: legacy }]
      : buckets;
  }, [entries, projects]);

  // Published state for the visible rows — one query while the drawer is
  // open and a session exists.
  useEffect(() => {
    if (!open || loading || !user) return;
    let cancelled = false;
    void getPublishedState(
      asPublishClient(supabase),
      entries.map((entry) => entry.id),
    ).then((pages) => {
      if (cancelled) return;
      setPublishedMap(
        Object.fromEntries(pages.map((page) => [page.uiId, page])),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [open, loading, user, entries, supabase]);

  const handleExportEntry = async (entry: HistoryEntry): Promise<void> => {
    try {
      await copySpecToClipboard(entry.spec);
      toast.success(t("playground.jsonCopied"));
    } catch {
      toast.error(t("playground.jsonCopyFailed"));
    }
  };

  const commitCreateProject = (): void => {
    // Empty names leave the input open so the visitor can type something.
    if (createProject(projectDraft) === null) return;
    setCreatingProject(false);
    setProjectDraft("");
  };

  const handleCreateKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
  ): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitCreateProject();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setCreatingProject(false);
    }
  };

  const startRename = (project: Project): void => {
    setRenameDraft(project.name);
    setRenamingId(project.id);
  };

  const commitRename = (): void => {
    if (renamingId !== null) renameProject(renamingId, renameDraft);
    setRenamingId(null);
  };

  const handleRenameKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
  ): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitRename();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setRenamingId(null);
    }
  };

  return (
    <>
      <Drawer open={open} onOpenChange={onOpenChange} direction="right">
        <DrawerContent
          className="max-w-md"
          onEscapeKeyDown={(event) => {
            // Vaul/Radix dismiss layers listen for Escape capture-phase on
            // `document`, i.e. BEFORE any input handler — cancelling an inline
            // edit from the input itself is too late and would close the whole
            // drawer (lesson: radix-escape-capture). Radix honours
            // `defaultPrevented`, so veto it here instead.
            if (creatingProject || renamingId !== null) event.preventDefault();
          }}
        >
          <DrawerHeader>
            <DrawerTitle>{t("historyDrawer.title")}</DrawerTitle>
            <DrawerDescription>
              {t("historyDrawer.description", { count: entries.length })}
            </DrawerDescription>
          </DrawerHeader>

          <div className="flex-1 overflow-y-auto px-4 pb-2">
            <div className="mb-3">
              {creatingProject ? (
                <input
                  autoFocus
                  aria-label={t("projects.createPlaceholder")}
                  placeholder={t("projects.createPlaceholder")}
                  value={projectDraft}
                  onChange={(event) => setProjectDraft(event.target.value)}
                  onKeyDown={handleCreateKeyDown}
                  className="h-8 w-full rounded-md border bg-background px-2 text-sm outline-none"
                />
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 px-2 text-muted-foreground"
                  onClick={() => {
                    setProjectDraft("");
                    setCreatingProject(true);
                  }}
                >
                  <Plus aria-hidden="true" className="size-3.5" />
                  {t("projects.create")}
                </Button>
              )}
            </div>

            {entries.length === 0 && projects.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {t("historyDrawer.emptyState")}
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {groups.map((group) => {
                  // Local const: narrows `project` to Project for the JSX
                  // closures below (a property access wouldn't survive them).
                  const project = group.project;
                  return (
                    <section
                      key={project?.id ?? "legacy"}
                      aria-label={project?.name ?? t("projects.none")}
                      className="flex flex-col"
                    >
                      <div className="flex items-center gap-1.5">
                        <Folder
                          aria-hidden="true"
                          className="size-3.5 shrink-0 text-muted-foreground"
                        />
                        {project === null ? (
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-muted-foreground">
                            {t("projects.none")}
                          </span>
                        ) : renamingId === project.id ? (
                          <input
                            autoFocus
                            aria-label={t("projects.rename")}
                            value={renameDraft}
                            onChange={(event) =>
                              setRenameDraft(event.target.value)
                            }
                            onKeyDown={handleRenameKeyDown}
                            // Blur discards — Enter is the only commit path, so
                            // a stale blur after Escape can't re-apply a draft.
                            onBlur={() => setRenamingId(null)}
                            className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm outline-none"
                          />
                        ) : (
                          <button
                            type="button"
                            title={t("projects.switch")}
                            aria-current={
                              project.id === activeProjectId
                                ? "true"
                                : undefined
                            }
                            className="min-w-0 flex-1 cursor-pointer truncate text-left text-sm font-medium hover:underline"
                            onClick={() => setActiveProjectId(project.id)}
                          >
                            {project.name}
                          </button>
                        )}
                        {project !== null &&
                          project.id === activeProjectId &&
                          renamingId !== project.id && (
                            <Check
                              aria-hidden="true"
                              className="size-3.5 shrink-0"
                            />
                          )}
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {group.entries.length}
                        </span>
                        {project !== null && renamingId !== project.id && (
                          <>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={t("projects.rename")}
                              className="h-6 px-1.5 text-muted-foreground"
                              onClick={() => startRename(project)}
                            >
                              <Pencil aria-hidden="true" className="size-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              aria-label={t("projects.delete")}
                              className="h-6 px-1.5 text-muted-foreground"
                              onClick={() => removeProject(project.id)}
                            >
                              <Trash2 aria-hidden="true" className="size-3.5" />
                            </Button>
                          </>
                        )}
                      </div>

                      {group.entries.length > 0 && (
                        <ul className="mt-2 flex flex-col gap-2">
                          {group.entries.map((entry) => (
                            <li key={entry.id}>
                              <div
                                className={`group flex items-start gap-2 rounded-md border p-3 transition-colors ${
                                  entry.id === activeId
                                    ? "border-foreground bg-accent"
                                    : "hover:bg-accent/50"
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() => onSelect(entry)}
                                  className="flex-1 cursor-pointer text-left"
                                >
                                  <p className="line-clamp-2 text-sm font-medium">
                                    {entry.name}
                                  </p>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {formatRelativeTime(
                                      entry.createdAt,
                                      t,
                                      locale,
                                    )}
                                  </p>
                                </button>
                                <PublishActions
                                  entry={entry}
                                  published={publishedMap[entry.id] ?? null}
                                  onGoLive={() => setGoLiveEntry(entry)}
                                />
                                <JsonUpdateButton
                                  entry={entry}
                                  onUpdate={onUpdateJson}
                                />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  aria-label={t("playground.jsonExportEntry", {
                                    title: entry.name,
                                  })}
                                  className="h-7 px-2 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                                  onClick={() => void handleExportEntry(entry)}
                                >
                                  <Copy
                                    aria-hidden="true"
                                    className="size-3.5"
                                  />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  aria-label={t("historyDrawer.deleteEntry")}
                                  className="h-7 px-2 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                                  onClick={() => onDelete(entry.id)}
                                >
                                  ✕
                                </Button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
          </div>

          <DrawerFooter>
            <JsonImportButton onImport={onImportJson} />
            <DrawerClose asChild>
              <Button type="button" variant="outline">
                {t("historyDrawer.close")}
              </Button>
            </DrawerClose>
            {entries.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={onClear}
              >
                {t("historyDrawer.clearAll")}
              </Button>
            )}
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {goLiveEntry && (
        <GoLiveDialog
          entry={goLiveEntry}
          published={publishedMap[goLiveEntry.id] ?? null}
          open
          onOpenChange={(next) => {
            if (!next) setGoLiveEntry(null);
          }}
          onPublished={(page) => {
            setPublishedMap((current) => {
              const next = { ...current };
              if (page) next[page.uiId] = page;
              else delete next[goLiveEntry.id];
              return next;
            });
          }}
        />
      )}
    </>
  );
}
