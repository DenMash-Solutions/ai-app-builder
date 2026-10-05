"use client";

import { Eraser, MousePointer2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

interface ToolRailProps {
  pickMode: boolean;
  onTogglePick: () => void;
  onClear: () => void;
}

export function ToolRail({ pickMode, onTogglePick, onClear }: ToolRailProps) {
  const t = useTranslations();
  return (
    <div className="absolute right-4 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-1 rounded-2xl border bg-background/80 p-1.5 shadow-lg backdrop-blur-md">
      <Button
        type="button"
        variant={pickMode ? "default" : "ghost"}
        size="icon"
        aria-pressed={pickMode}
        aria-label={t("editor.pick")}
        title={t("editor.pick")}
        onClick={onTogglePick}
      >
        <MousePointer2 />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t("playground.clear")}
        title={t("playground.clear")}
        onClick={onClear}
        className="text-destructive hover:text-destructive"
      >
        <Eraser />
      </Button>
    </div>
  );
}
