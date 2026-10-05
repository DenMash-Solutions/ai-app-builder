"use client";

import { useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ModelOptions } from "@/components/model-options";
import type { ModelId } from "@/lib/playground/models";
import {
  getModel,
  getServerModel,
  subscribeModel,
} from "@/lib/playground/model-store";

interface QuotaDialogProps {
  onOpenChange: (open: boolean) => void;
  /** Applies the chosen model and re-sends the failed request. */
  onConfirm: (model: ModelId) => void;
}

/**
 * Rendered only while a quota failure is active, so every open starts with a
 * fresh selection seeded from the model that just failed.
 */
export function QuotaDialog({ onOpenChange, onConfirm }: QuotaDialogProps) {
  const t = useTranslations();
  const current = useSyncExternalStore(
    subscribeModel,
    getModel,
    getServerModel,
  );
  const [selected, setSelected] = useState<ModelId>(current);

  // The store only changes on confirm (which unmounts us), so `current` is
  // still the failing model for the dialog's whole lifetime.
  const failingModel = current;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("quota.title")}</DialogTitle>
          <DialogDescription>{t("quota.description")}</DialogDescription>
        </DialogHeader>
        <ModelOptions selected={selected} onSelect={setSelected} />
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              {t("quota.dismiss")}
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={selected === failingModel}
            onClick={() => onConfirm(selected)}
          >
            {t("quota.switchAndRetry")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
