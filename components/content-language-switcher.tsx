"use client";

import { useState } from "react";
import { Check, Languages, Loader2, RotateCcw, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
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
import { languageName } from "@/lib/i18n/languages";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface ContentLanguageSwitcherProps {
  /** Every language the spec carries (seed first). */
  languages: string[];
  /** The active content language. */
  value: string;
  /** The seed language — the source "Revert to source" restores. */
  seed: string;
  /** Per-tag untranslated-key count (only tags with gaps are listed). */
  missingByTag: ReadonlyMap<string, number>;
  onChange: (tag: string) => void;
  /** Model action: fill the active language's missing keys. */
  onTranslateMissing: () => void;
  /** Tag whose translation is streaming in — spins the pill until it lands. */
  pendingTag?: string | null;
  /** Local op: drop a non-seed language's overlay layer (fires only after
   *  the user confirms in the remove dialog). */
  onRemoveLanguage?: (tag: string) => void;
  /** Model action: delete the active overlay key → seed fallback. Only used
   *  when no remove handler is wired — otherwise "Revert to source" confirms
   *  and removes through it (same destructive operation). */
  onRevertToSource: () => void;
  /** Whether the active (non-seed) language has an overlay to revert. */
  canRevert: boolean;
  /** Opens the "Add language…" dialog — the popover lives on the ToolRail,
   *  so this row keeps the action reachable on ANY spec (ungated by copy). */
  onAddLanguage?: () => void;
  className?: string;
}

const ROW_CLASS = "h-9 w-full justify-start gap-2 rounded-md px-2";

// Language names follow the APP locale (en/es selector), not the browser's —
// every name derives from the tag, nothing is stored or translated.
function languageLabel(tag: string, locale: string): string {
  return languageName(tag, locale) ?? tag;
}

/**
 * Spec content language — the ToolRail control (TopBar's LocaleSwitcher is
 * the APP-shell language; the rail is spec-only, user boundary in plan rev 3).
 * The trigger shows the current tag instead of an icon; the popover opens
 * leftward over the canvas and carries switch / translate / revert / remove
 * plus the "Add language…" row.
 */
export function ContentLanguageSwitcher({
  languages,
  value,
  seed,
  missingByTag,
  onChange,
  onTranslateMissing,
  pendingTag,
  onRemoveLanguage,
  onRevertToSource,
  canRevert,
  onAddLanguage,
  className,
}: ContentLanguageSwitcherProps) {
  const t = useTranslations();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  // A remove request awaits confirmation — dropping a language's whole
  // translation layer must never happen on a mis-click.
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const missing = missingByTag.get(value) ?? 0;
  const pending = pendingTag === value;

  const select = (tag: string) => {
    onChange(tag);
    setOpen(false);
  };

  const rows = (
    <div className="flex flex-col gap-0.5">
      {languages.map((tag) => {
        const count = missingByTag.get(tag) ?? 0;
        const active = tag === value;
        const isSeed = tag === seed;
        return (
          <div
            key={tag}
            className={cn(
              "flex h-9 items-center gap-1 rounded-md pl-2 pr-1 hover:bg-accent",
              active && "bg-accent",
            )}
          >
            <button
              type="button"
              onClick={() => select(tag)}
              className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
            >
              <span className="font-medium uppercase">{tag}</span>
              <span className="min-w-0 truncate text-muted-foreground">
                {languageLabel(tag, locale)}
              </span>
              {count > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-auto shrink-0 tabular-nums"
                >
                  {count}
                </Badge>
              )}
              {active && count === 0 && (
                <Check aria-hidden="true" className="ml-auto size-4 shrink-0" />
              )}
              {isSeed && (
                <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {t("editor.contentLang.source")}
                </span>
              )}
            </button>
            {!isSeed && onRemoveLanguage && (
              <button
                type="button"
                aria-label={t("editor.contentLang.remove", {
                  name: languageLabel(tag, locale),
                })}
                onClick={() => {
                  // Close the popover first — the confirm dialog portals at
                  // the root, and a dialog stacked on a popover fights for
                  // focus.
                  setOpen(false);
                  setPendingRemove(tag);
                }}
                className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            )}
          </div>
        );
      })}

      {value !== seed && missing > 0 && (
        <Button
          type="button"
          variant="ghost"
          className={ROW_CLASS}
          onClick={() => {
            setOpen(false);
            onTranslateMissing();
          }}
        >
          <Languages aria-hidden="true" className="size-4 shrink-0" />
          <span>
            {t("editor.contentLang.translateMissing")} ({missing})
          </span>
        </Button>
      )}

      {value !== seed && canRevert && (
        <Button
          type="button"
          variant="ghost"
          className={ROW_CLASS}
          onClick={() => {
            setOpen(false);
            if (onRemoveLanguage) {
              // Reverting IS removing the active language's layer — route it
              // through the same confirmation (falls back to the raw op only
              // when no remove handler is wired).
              setPendingRemove(value);
            } else {
              onRevertToSource();
            }
          }}
        >
          <RotateCcw aria-hidden="true" className="size-4 shrink-0" />
          <span>{t("editor.contentLang.revert")}</span>
        </Button>
      )}

      {/* Single home for Add (plan rev 3): the rail popover carries it, so
          it stays reachable on specs without copy. */}
      {onAddLanguage && (
        <Button
          type="button"
          variant="ghost"
          className={ROW_CLASS}
          onClick={() => {
            setOpen(false);
            onAddLanguage();
          }}
        >
          <Languages aria-hidden="true" className="size-4 shrink-0" />
          <span>{t("editor.contentLang.add")}</span>
        </Button>
      )}
    </div>
  );

  // Destructive-action confirm (repo pattern: plain dialog + footer buttons,
  // as in failure-dialog).
  const confirmDialog = (
    <Dialog
      open={pendingRemove !== null}
      onOpenChange={(next) => {
        if (!next) setPendingRemove(null);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {t("editor.contentLang.removeConfirm.title", {
              name: pendingRemove ? languageLabel(pendingRemove, locale) : "",
            })}
          </DialogTitle>
          <DialogDescription>
            {t("editor.contentLang.removeConfirm.description")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t("editor.contentLang.removeConfirm.cancel")}
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              if (pendingRemove) onRemoveLanguage?.(pendingRemove);
              setPendingRemove(null);
            }}
          >
            {t("editor.contentLang.removeConfirm.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("editor.contentLang.title")}
            title={`${t("editor.contentLang.title")}: ${languageLabel(value, locale)}`}
            className={cn("relative shrink-0", className)}
          >
            {/* The current language, not an icon — the rail button reads as
                the spec's language. Corner overlays keep the square rail
                footprint: spinner while its layer streams, missing count on
                top. */}
            <span className="max-w-8 truncate text-[10px] font-medium uppercase leading-none">
              {value}
            </span>
            {pending && (
              <Loader2
                aria-hidden="true"
                className="absolute bottom-0.5 right-0.5 size-3 animate-spin"
              />
            )}
            {missing > 0 && (
              <Badge
                variant="secondary"
                title={t("editor.contentLang.missingBadge", { count: missing })}
                className="absolute -right-1 -top-1 flex size-4 justify-center p-0 text-[9px] tabular-nums"
              >
                {missing}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="left"
          align="start"
          aria-label={t("editor.contentLang.title")}
          className="w-72 p-1"
        >
          {rows}
        </PopoverContent>
      </Popover>
      {confirmDialog}
    </>
  );
}
