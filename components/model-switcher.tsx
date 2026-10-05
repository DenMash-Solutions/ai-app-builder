"use client";

import { useState, useSyncExternalStore } from "react";
import { Cpu } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ModelOptions } from "@/components/model-options";
import { findModel } from "@/lib/playground/models";
import {
  getModel,
  getServerModel,
  setModel,
  subscribeModel,
} from "@/lib/playground/model-store";

interface ModelSwitcherProps {
  /** Pill for the desktop header, row for the collapsed menu. */
  variant?: "pill" | "row";
  className?: string;
}

export function ModelSwitcher({
  variant = "pill",
  className,
}: ModelSwitcherProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const selected = useSyncExternalStore(
    subscribeModel,
    getModel,
    getServerModel,
  );
  const record = findModel(selected);

  const handleSelect = (model: typeof selected) => {
    setModel(model);
    setOpen(false);
  };

  if (variant === "row") {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className={cn(
              "h-9 w-full justify-start gap-2 rounded-md px-2",
              className,
            )}
          >
            <Cpu aria-hidden="true" className="size-4 shrink-0" />
            <span>{t("model.label")}</span>
            <span className="ml-auto max-w-24 truncate text-xs text-muted-foreground">
              {record.shortLabel}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          aria-label={t("model.label")}
          className="w-64 p-1"
        >
          <ModelOptions selected={selected} onSelect={handleSelect} />
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
          className={cn("h-7 gap-1.5 px-2 text-xs", className)}
        >
          <Cpu aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="max-w-28 truncate">{record.shortLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label={t("model.label")}
        className="w-64 p-1"
      >
        <ModelOptions selected={selected} onSelect={handleSelect} />
      </PopoverContent>
    </Popover>
  );
}
