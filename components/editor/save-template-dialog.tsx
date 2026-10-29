"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";

interface SaveTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Receives the trimmed name; the caller snapshots the subtree itself. */
  onSave: (name: string) => void;
}

/**
 * Name prompt for "Save as template" (plan 060 step 1). The snapshot of the
 * selected subtree is taken by the caller at submit time, so this stays a
 * pure form.
 */
export function SaveTemplateDialog({
  open,
  onOpenChange,
  onSave,
}: SaveTemplateDialogProps) {
  const t = useTranslations();
  const [name, setName] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "") return;
    onSave(trimmed);
    setName("");
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setName("");
      }}
    >
      <DialogContent className="sm:max-w-sm" data-save-template-dialog>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("editor.structure.saveTemplateTitle")}</DialogTitle>
            <DialogDescription>
              {t("editor.structure.saveTemplateDescription")}
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            name="template-name"
            value={name}
            aria-label={t("editor.structure.saveTemplateLabel")}
            placeholder={t("editor.structure.saveTemplatePlaceholder")}
            onChange={(event) => setName(event.target.value)}
          />
          <Button
            type="submit"
            className="w-full"
            disabled={name.trim() === ""}
          >
            {t("editor.structure.saveTemplateSubmit")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
