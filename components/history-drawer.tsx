"use client";

import { useEffect, useMemo, useState } from "react";
import type { Spec } from "@json-render/core";
import { Copy } from "lucide-react";
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
import { GoLiveDialog } from "@/components/publish/go-live-dialog";
import { PublishActions } from "@/components/publish/publish-actions";
import type { HistoryEntry } from "@/lib/history";
import { formatRelativeTime } from "@/lib/history";
import { copySpecToClipboard } from "@/lib/playground/json-io";
import { getPublishedState, asPublishClient } from "@/lib/publish/publish";
import type { PublishedPage } from "@/lib/publish/publish";
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
}: HistoryDrawerProps) {
  const t = useTranslations();
  const locale = useLocale();
  const { user, loading } = useAuth();
  const supabase = useMemo(() => createClient(), []);
  const [publishedMap, setPublishedMap] = useState<
    Record<string, PublishedPage>
  >({});
  const [goLiveEntry, setGoLiveEntry] = useState<HistoryEntry | null>(null);

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

  return (
    <>
      <Drawer open={open} onOpenChange={onOpenChange} direction="right">
        <DrawerContent className="max-w-md">
          <DrawerHeader>
            <DrawerTitle>{t("historyDrawer.title")}</DrawerTitle>
            <DrawerDescription>
              {t("historyDrawer.description", { count: entries.length })}
            </DrawerDescription>
          </DrawerHeader>

          <div className="flex-1 overflow-y-auto px-4 pb-2">
            {entries.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {t("historyDrawer.emptyState")}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {entries.map((entry) => (
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
                          {formatRelativeTime(entry.createdAt, t, locale)}
                        </p>
                      </button>
                      <PublishActions
                        entry={entry}
                        published={publishedMap[entry.id] ?? null}
                        onGoLive={() => setGoLiveEntry(entry)}
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
                        <Copy aria-hidden="true" className="size-3.5" />
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
