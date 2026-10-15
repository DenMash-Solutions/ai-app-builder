"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "cn";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  customLanguageTag,
  filterLanguages,
  type LanguageOption,
} from "@/lib/i18n/languages";

interface AddLanguageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Receives the canonical BCP-47 tag the user picked. */
  onAdd: (tag: string) => void;
}

const OPTION_CLASS =
  "flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none";
const TAG_CLASS =
  "ml-auto shrink-0 font-mono text-xs uppercase text-muted-foreground";

/**
 * "Add language…" is a searchable picker over the common-language catalog
 * (plan: spec-languages, decision 6). The catalog stores tags only — names
 * derive per render in the app locale, so localized search works for free
 * ("chino" finds zh in the Spanish UI) and the en/es selector re-labels
 * everything without translations. A raw BCP-47 tag the catalog doesn't
 * list is still accepted (escape hatch); picking passes the canonical tag
 * to the model steer, never a name.
 */
export function AddLanguageDialog({
  open,
  onOpenChange,
  onAdd,
}: AddLanguageDialogProps) {
  const t = useTranslations();
  const locale = useLocale();
  const [query, setQuery] = useState("");

  const matches = useMemo(
    () => filterLanguages(query, locale),
    [query, locale],
  );
  // Escape hatch: the query itself is a valid BCP-47 tag the list omits.
  const rawTag = customLanguageTag(query);
  const rawTagKnown = rawTag !== null && matches.some((o) => o.tag === rawTag);
  const showRawTag = rawTag !== null && !rawTagKnown;

  const pick = (tag: string) => {
    onAdd(tag);
    setQuery("");
    onOpenChange(false);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // Enter picks the natural target: the offered raw tag, else the one
    // filtered match. A multi-match list waits for a click.
    if (showRawTag && rawTag) pick(rawTag);
    else if (matches.length === 1) pick(matches[0].tag);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setQuery("");
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("editor.contentLang.addDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("editor.contentLang.addDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <Input
            // Autofocus the filter — the dialog exists to pick a language.
            autoFocus
            value={query}
            aria-label={t("editor.contentLang.addDialog.label")}
            placeholder={t("editor.contentLang.addDialog.placeholder")}
            onChange={(event) => setQuery(event.target.value)}
          />
          {/* The hint replaces the listbox (a listbox's a11y tree hides
              non-option children) — an empty listbox would be invisible. */}
          {matches.length === 0 && !showRawTag ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              {t("editor.contentLang.addDialog.noMatch")}
            </p>
          ) : (
            <div
              role="listbox"
              aria-label={t("editor.contentLang.addDialog.title")}
              className="max-h-64 -mx-1 overflow-y-auto px-1"
            >
              {matches.map((option: LanguageOption) => (
                <button
                  key={option.tag}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => pick(option.tag)}
                  className={OPTION_CLASS}
                >
                  <span className="min-w-0 truncate">{option.name}</span>
                  <span className={TAG_CLASS}>{option.tag}</span>
                </button>
              ))}
              {showRawTag && (
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => pick(rawTag)}
                  className={cn(OPTION_CLASS, "text-muted-foreground")}
                >
                  <span className="min-w-0 truncate">
                    {t("editor.contentLang.addDialog.custom")}
                  </span>
                  <span className={TAG_CLASS}>{rawTag}</span>
                </button>
              )}
            </div>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
