"use client";

import type { Spec } from "@json-render/core";
import { ClipboardPaste } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { PARSE_SPEC_ERRORS, parseSpecJson } from "@/lib/playground/json-io";
import type { ParseSpecError } from "@/lib/playground/json-io";

/** Object-based constant — error kind → i18n key (no string-literal branches). */
const ERROR_MESSAGE_KEYS = {
  [PARSE_SPEC_ERRORS.invalidJson]: "playground.jsonInvalidJson",
  [PARSE_SPEC_ERRORS.invalidShape]: "playground.jsonInvalidSpec",
} as const;

interface JsonImportButtonProps {
  onImport: (spec: Spec) => void;
}

/**
 * History-drawer footer: opens the paste dialog and hands the validated spec
 * to `onImport`. Export lives on each history row (HistoryDrawer) — a second
 * footer Export would copy the same bytes as the active entry's row button,
 * because the canvas spec always mirrors the active entry. Dialog state and
 * i18n are self-contained.
 */
export function JsonImportButton({ onImport }: JsonImportButtonProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<ParseSpecError | null>(null);

  const handleOpenChange = (next: boolean): void => {
    setOpen(next);
    if (next) {
      setText("");
      setError(null);
    }
  };

  const handleImport = (): void => {
    const result = parseSpecJson(text);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onImport(result.spec);
    handleOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Button
        type="button"
        variant="outline"
        className="gap-2"
        onClick={() => handleOpenChange(true)}
      >
        <ClipboardPaste aria-hidden="true" className="size-4" />
        {t("playground.importJson")}
      </Button>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("playground.jsonDialogTitle")}</DialogTitle>
          <DialogDescription>
            {t("playground.jsonDialogDescription")}
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setError(null);
          }}
          placeholder={t("playground.jsonPlaceholder")}
          aria-label={t("playground.jsonDialogTitle")}
          aria-invalid={error !== null}
          spellCheck={false}
          className="h-64 field-sizing-none overflow-y-auto font-mono text-xs"
        />
        {error !== null && (
          <p role="alert" className="text-sm text-destructive">
            {t(ERROR_MESSAGE_KEYS[error])}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t("playground.jsonCancel")}
            </Button>
          </DialogClose>
          <Button type="button" onClick={handleImport}>
            {t("playground.jsonImport")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
