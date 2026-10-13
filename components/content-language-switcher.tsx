"use client";

import { useState } from "react";
import { Check, Languages, Plus, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  /** Model action: translate the whole spec into a brand-new language. */
  onAddLanguage: () => void;
  /** Model action: fill the active language's missing keys. */
  onTranslateMissing: () => void;
  /** Model action: delete the active overlay key → seed fallback. */
  onRevertToSource: () => void;
  /** Whether the active (non-seed) language has an overlay to revert. */
  canRevert: boolean;
  variant?: "pill" | "row";
  className?: string;
}

const ROW_CLASS = "h-9 w-full justify-start gap-2 rounded-md px-2";

function languageLabel(tag: string): string {
  try {
    const display = new Intl.DisplayNames(undefined, { type: "language" });
    return display.of(tag) ?? tag;
  } catch {
    return tag;
  }
}

export function ContentLanguageSwitcher({
  languages,
  value,
  seed,
  missingByTag,
  onChange,
  onAddLanguage,
  onTranslateMissing,
  onRevertToSource,
  canRevert,
  variant = "pill",
  className,
}: ContentLanguageSwitcherProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const missing = missingByTag.get(value) ?? 0;

  const select = (tag: string) => {
    onChange(tag);
    setOpen(false);
  };

  const rows = (
    <div className="flex flex-col gap-0.5">
      {languages.map((tag) => {
        const count = missingByTag.get(tag) ?? 0;
        const active = tag === value;
        return (
          <button
            key={tag}
            type="button"
            onClick={() => select(tag)}
            className={cn(
              "flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent",
              active && "bg-accent",
            )}
          >
            <span className="font-medium uppercase">{tag}</span>
            <span className="min-w-0 truncate text-muted-foreground">
              {languageLabel(tag)}
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
            {tag === seed && (
              <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                {t("editor.contentLang.source")}
              </span>
            )}
          </button>
        );
      })}

      <Button
        type="button"
        variant="ghost"
        className={ROW_CLASS}
        onClick={() => {
          setOpen(false);
          onAddLanguage();
        }}
      >
        <Plus aria-hidden="true" className="size-4 shrink-0" />
        <span>{t("editor.contentLang.add")}</span>
      </Button>

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
            onRevertToSource();
          }}
        >
          <RotateCcw aria-hidden="true" className="size-4 shrink-0" />
          <span>{t("editor.contentLang.revert")}</span>
        </Button>
      )}
    </div>
  );

  if (variant === "row") {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className={cn(ROW_CLASS, className)}
          >
            <Languages aria-hidden="true" className="size-4 shrink-0" />
            <span>{t("editor.contentLang.label")}</span>
            <span className="ml-auto max-w-24 truncate text-xs text-muted-foreground uppercase">
              {value}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          aria-label={t("editor.contentLang.title")}
          className="w-72 p-1"
        >
          {rows}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={t("editor.contentLang.title")}
          className={cn("h-7 gap-1.5 px-2 text-xs", className)}
        >
          <Languages aria-hidden="true" className="size-3.5" />
          <span className="max-w-20 truncate uppercase">{value}</span>
          {missing > 0 && (
            <Badge
              variant="secondary"
              className="ml-0.5 shrink-0 tabular-nums"
              title={t("editor.contentLang.missingBadge", { count: missing })}
            >
              {missing}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label={t("editor.contentLang.title")}
        className="w-72 p-1"
      >
        {rows}
      </PopoverContent>
    </Popover>
  );
}
