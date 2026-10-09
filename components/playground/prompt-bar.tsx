"use client";

import type { FormEvent } from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** One removable prompt-scope chip rendered above the input. */
export interface PromptScopeChip {
  id: string;
  label: string;
}

interface PromptBarProps {
  isStreaming: boolean;
  hasSpec: boolean;
  onSend: (prompt: string) => void;
  /** Prompt-scope chips; empty/omitted hides the chip row. */
  scope?: readonly PromptScopeChip[];
  onRemoveScope?: (id: string) => void;
}

export function PromptBar({
  isStreaming,
  hasSpec,
  onSend,
  scope,
  onRemoveScope,
}: PromptBarProps) {
  const t = useTranslations();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = new FormData(event.currentTarget).get("prompt");
    if (typeof prompt === "string" && prompt.trim().length > 0) {
      onSend(prompt.trim());
    }
  };

  const chips = scope ?? [];

  return (
    <form
      onSubmit={handleSubmit}
      className="absolute bottom-6 left-1/2 z-20 w-full max-w-2xl -translate-x-1/2 px-4"
    >
      {chips.length > 0 && (
        <div
          data-testid="prompt-scope"
          className="mb-2 flex flex-wrap items-center gap-1.5"
        >
          {chips.map((chip) => (
            <Badge
              key={chip.id}
              asChild
              variant="outline"
              className="border-emerald-600/40 bg-emerald-600/10 py-0 text-emerald-700 hover:bg-emerald-600/20 hover:text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-400/10 dark:text-emerald-200 dark:hover:bg-emerald-400/20 dark:hover:text-emerald-200"
            >
              <button
                type="button"
                aria-label={t("playground.scopeRemove", { label: chip.label })}
                disabled={isStreaming}
                onClick={() => onRemoveScope?.(chip.id)}
                className="cursor-pointer disabled:pointer-events-none disabled:opacity-40"
              >
                {chip.label}
                <X data-icon="inline-end" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 rounded-2xl border bg-background/80 p-2 pl-4 shadow-lg backdrop-blur-md">
        <Input
          name="prompt"
          placeholder={t("playground.promptPlaceholder")}
          disabled={isStreaming}
          className="h-9 min-w-0 flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"
        />
        <Button type="submit" disabled={isStreaming} className="h-9 px-4">
          {isStreaming
            ? t("playground.generating")
            : hasSpec
              ? t("playground.steer")
              : t("playground.generate")}
        </Button>
      </div>
    </form>
  );
}
