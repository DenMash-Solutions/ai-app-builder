"use client";

import type { Spec } from "@json-render/core";
import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { HistoryEntry } from "@/lib/history";
import { PARSE_SPEC_ERRORS, parseSpecJson } from "@/lib/playground/json-io";
import type { ParseSpecError } from "@/lib/playground/json-io";

/** Object-based constant — error kind → i18n key (no string-literal branches). */
const ERROR_MESSAGE_KEYS = {
  [PARSE_SPEC_ERRORS.invalidJson]: "playground.jsonInvalidJson",
  [PARSE_SPEC_ERRORS.invalidShape]: "playground.jsonInvalidSpec",
  [PARSE_SPEC_ERRORS.invalidDataSources]: "playground.dataSourcesInvalid",
} as const;

/** Object-based constant — dialog step (no string-literal values). */
const UPDATE_STEPS = {
  paste: "paste",
  confirm: "confirm",
} as const;

type UpdateStep = (typeof UPDATE_STEPS)[keyof typeof UPDATE_STEPS];

interface JsonUpdateButtonProps {
  /** The row this action belongs to — the update target, no picker needed. */
  entry: HistoryEntry;
  /** Replaces the entry's spec through the revision stack (plan 063). */
  onUpdate: (targetId: string, spec: Spec) => void;
}

/**
 * History-row action (plan 063): replace this screen's spec from pasted
 * JSON. Two steps inside the row's own dialog — paste, then an overwrite
 * confirmation carrying the target's name, slug and revision count — so the
 * destructive intent is explicit while the scope (which screen) is implied
 * by the row the button sits on. The previous content stays reachable as an
 * earlier revision, which the confirmation copy promises.
 */
export function JsonUpdateButton({ entry, onUpdate }: JsonUpdateButtonProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<ParseSpecError | null>(null);
  // Data-source issue list (developer English) rides under the friendly key.
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [step, setStep] = useState<UpdateStep>(UPDATE_STEPS.paste);
  // Parsed spec held while the confirmation step is open.
  const [pending, setPending] = useState<Spec | null>(null);

  const handleOpenChange = (next: boolean): void => {
    setOpen(next);
    if (next) {
      setText("");
      setError(null);
      setErrorDetails(null);
      setStep(UPDATE_STEPS.paste);
      setPending(null);
    }
  };

  const handleReview = (): void => {
    const result = parseSpecJson(text);
    if (!result.ok) {
      setError(result.error);
      setErrorDetails(result.details ?? null);
      return;
    }
    setPending(result.spec);
    setStep(UPDATE_STEPS.confirm);
  };

  const handleConfirm = (): void => {
    if (!pending) return;
    onUpdate(entry.id, pending);
    handleOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={t("playground.jsonUpdateEntry", { title: entry.name })}
        className="h-7 px-2 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        onClick={() => handleOpenChange(true)}
      >
        <RefreshCw aria-hidden="true" className="size-3.5" />
      </Button>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {step === UPDATE_STEPS.confirm
              ? t("playground.jsonConfirmTitle")
              : t("playground.jsonUpdateDialogTitle")}
          </DialogTitle>
          <DialogDescription>
            {step === UPDATE_STEPS.confirm
              ? t("playground.jsonConfirmBody", {
                  name: entry.name,
                  slug: entry.slug,
                  revisions: entry.revisions.length,
                })
              : t("playground.jsonUpdateDialogDescription", {
                  name: entry.name,
                })}
          </DialogDescription>
        </DialogHeader>
        {step === UPDATE_STEPS.paste && (
          <>
            <Textarea
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setError(null);
                setErrorDetails(null);
              }}
              placeholder={t("playground.jsonPlaceholder")}
              aria-label={t("playground.jsonUpdateDialogTitle")}
              aria-invalid={error !== null}
              spellCheck={false}
              className="h-64 field-sizing-none overflow-y-auto font-mono text-xs"
            />
            {error !== null && (
              <p role="alert" className="text-sm text-destructive">
                {t(ERROR_MESSAGE_KEYS[error])}
              </p>
            )}
            {errorDetails !== null && (
              <p className="text-xs font-mono text-muted-foreground">
                {errorDetails}
              </p>
            )}
          </>
        )}
        <DialogFooter>
          {step === UPDATE_STEPS.confirm ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => setStep(UPDATE_STEPS.paste)}
              >
                {t("playground.jsonBack")}
              </Button>
              <Button type="button" onClick={handleConfirm}>
                {t("playground.jsonConfirmAction")}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
              >
                {t("playground.jsonCancel")}
              </Button>
              <Button type="button" onClick={handleReview}>
                {t("playground.jsonUpdate")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
