"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  CatalogAsset,
  CatalogAssetVersion,
  CatalogInstall,
} from "@/lib/catalog/catalog";

interface CatalogUpdateDialogProps {
  open: boolean;
  asset: CatalogAsset;
  /** The install being re-pinned — its version reads as "Installed". */
  install: CatalogInstall;
  /** Versions OF the asset; the dialog orders newest-first itself. */
  versions: CatalogAssetVersion[];
  onOpenChange: (open: boolean) => void;
  /** Confirms the selected version — latest = update, older = rollback
   *  (the flow logic lives in `updateCatalogInstall`, Task 3). */
  onConfirm: (versionId: string) => void;
}

/**
 * Update confirmation for an installed catalog row (066 Task 4): lists the
 * asset's versions with the installed pin and the latest marked, defaults
 * to the latest (the common "update" case), and relabels the confirm when
 * the selection is OLDER than the installed pin — picking an older version
 * IS the rollback path. Nested inside the picker's dialog: Radix only
 * lets the highest layer handle Escape, so this closes alone first.
 */
export function CatalogUpdateDialog({
  open,
  asset,
  install,
  versions,
  onOpenChange,
  onConfirm,
}: CatalogUpdateDialogProps) {
  const t = useTranslations();
  const ordered = [...versions].sort((a, b) => b.version - a.version);
  const [selected, setSelected] = useState<string | null>(
    ordered[0]?.id ?? null,
  );
  const selectedVersion = ordered.find((row) => row.id === selected) ?? null;
  const installedVersion =
    ordered.find((row) => row.id === install.versionId) ?? null;
  const isRollback =
    selectedVersion !== null &&
    installedVersion !== null &&
    selectedVersion.version < installedVersion.version;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-catalog-update-dialog className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {t("editor.picker.updateTitle", { name: asset.name })}
          </DialogTitle>
          <DialogDescription>
            {t("editor.picker.updateDescription")}
          </DialogDescription>
        </DialogHeader>

        <div
          role="listbox"
          aria-label={t("editor.picker.updateTitle", { name: asset.name })}
          className="max-h-48 overflow-y-auto rounded-md border"
        >
          {ordered.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              {t("editor.picker.updateNoVersions")}
            </p>
          )}
          {ordered.map((version) => (
            <button
              key={version.id}
              type="button"
              role="option"
              aria-selected={version.id === selected}
              onClick={() => setSelected(version.id)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent"
            >
              <span className="font-mono text-xs font-medium">
                {t("editor.picker.versionChip", { version: version.version })}
              </span>
              {version.id === install.versionId && (
                <span className="rounded bg-zinc-500/15 px-1.5 py-0.5 text-[10px] text-zinc-400">
                  {t("editor.picker.installedChip")}
                </span>
              )}
              {version.id === asset.latestVersionId && (
                <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-400">
                  {t("editor.picker.latestChip")}
                </span>
              )}
              {version.changelog && (
                <span className="truncate text-[11px] text-muted-foreground">
                  {version.changelog}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            {t("editor.picker.updateCancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={selectedVersion === null}
            onClick={() => {
              if (selectedVersion) onConfirm(selectedVersion.id);
            }}
          >
            {selectedVersion &&
              (isRollback
                ? t("editor.picker.rollbackTo", {
                    version: selectedVersion.version,
                  })
                : t("editor.picker.updateTo", {
                    version: selectedVersion.version,
                  }))}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
