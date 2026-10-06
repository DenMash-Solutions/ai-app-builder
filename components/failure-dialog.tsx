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

/** Which failure opened the dialog — selects the copy, interaction is shared. */
export type FailureKind = "quota" | "service";

interface FailureDialogProps {
  kind: FailureKind;
  onOpenChange: (open: boolean) => void;
  /** Applies the chosen model and re-sends the failed request. */
  onConfirm: (model: ModelId) => void;
}

/**
 * Rendered only while a quota or unavailable-service failure is active, so
 * every open starts with a fresh selection seeded from the model that just
 * failed. Both flavors offer switch-model-and-retry: quota relief and
 * unavailable models are each dodged by picking a different model.
 */
export function FailureDialog({
  kind,
  onOpenChange,
  onConfirm,
}: FailureDialogProps) {
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

  const title = kind === "quota" ? t("quota.title") : t("service.title");
  const description =
    kind === "quota" ? t("quota.description") : t("service.description");
  const switchAndRetry =
    kind === "quota" ? t("quota.switchAndRetry") : t("service.switchAndRetry");
  const dismiss = kind === "quota" ? t("quota.dismiss") : t("service.dismiss");

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <ModelOptions selected={selected} onSelect={setSelected} />
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              {dismiss}
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={selected === failingModel}
            onClick={() => onConfirm(selected)}
          >
            {switchAndRetry}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
