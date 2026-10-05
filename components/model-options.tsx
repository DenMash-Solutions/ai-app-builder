"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { AVAILABLE_MODELS, type ModelId } from "@/lib/playground/models";

interface ModelOptionsProps {
  selected: ModelId;
  onSelect: (model: ModelId) => void;
}

export function ModelOptions({ selected, onSelect }: ModelOptionsProps) {
  const t = useTranslations();

  return (
    <div role="menu" className="flex flex-col gap-0.5">
      {AVAILABLE_MODELS.map((model) => (
        <button
          key={model.id}
          type="button"
          role="menuitemradio"
          aria-checked={model.id === selected}
          onClick={() => onSelect(model.id)}
          className={cn(
            "flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-hidden",
            model.id === selected && "bg-accent",
          )}
        >
          <span className="min-w-0 truncate">{model.label}</span>
          <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            {t("model.requestsPerDay", { count: model.rpd })}
            <Check
              aria-hidden="true"
              className={cn(
                "size-4",
                model.id === selected ? "opacity-100" : "opacity-0",
              )}
            />
          </span>
        </button>
      ))}
    </div>
  );
}
