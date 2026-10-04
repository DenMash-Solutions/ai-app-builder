"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowRight,
  Bold,
  Funnel,
  LayoutGrid,
  Palette,
  Pencil,
  Sparkles,
  Volume1,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  EDIT_ACTION_KEYS,
  actionRevisionLabel,
  freeformRevisionLabel,
} from "@/lib/editor";
import type { EditActionKey } from "@/lib/editor";

const ACTION_ICONS: Record<EditActionKey, LucideIcon> = {
  bolder: Bold,
  quieter: Volume1,
  polish: Sparkles,
  colorize: Palette,
  distill: Funnel,
  layout: LayoutGrid,
};

interface ActionTilesProps {
  onAction: (instruction: string, label: string) => void;
}

export function ActionTiles({ onAction }: ActionTilesProps) {
  const t = useTranslations();
  const [freeform, setFreeform] = useState("");

  const handleFreeform = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = freeform.trim();
    if (text.length === 0) return;
    setFreeform("");
    onAction(text, freeformRevisionLabel(text));
  };

  return (
    <div className="flex flex-col gap-3 px-3 py-3">
      <form onSubmit={handleFreeform} className="flex gap-1.5">
        <div className="flex h-8 flex-1 items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2 focus-within:border-amber-400">
          <Pencil className="h-3 w-3 shrink-0 text-zinc-500" />
          <input
            type="text"
            value={freeform}
            onChange={(event) => setFreeform(event.target.value)}
            placeholder={t("editor.freeformPlaceholder")}
            className="w-full bg-transparent text-xs text-zinc-100 outline-none placeholder:text-zinc-500"
          />
        </div>
        <button
          type="submit"
          aria-label={t("editor.apply")}
          disabled={freeform.trim().length === 0}
          className="flex h-8 w-8 items-center justify-center rounded-md bg-amber-400 text-zinc-950 hover:bg-amber-300 disabled:opacity-40"
        >
          <ArrowRight className="h-4 w-4" />
        </button>
      </form>

      <div className="grid grid-cols-3 gap-1.5">
        {EDIT_ACTION_KEYS.map((key) => {
          const Icon = ACTION_ICONS[key];
          return (
            <button
              key={key}
              type="button"
              onClick={() =>
                onAction(
                  t(`editor.instructions.${key}`),
                  actionRevisionLabel(key),
                )
              }
              className="flex flex-col items-center gap-1 rounded-lg border border-transparent bg-zinc-900 px-1 py-2.5 text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-800 hover:text-amber-300 disabled:opacity-40"
            >
              <Icon className="h-4 w-4" />
              <span className="text-[11px]">
                {t(`editor.generalActions.${key}`)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
