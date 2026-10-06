"use client";

import { Eraser, Hand, Layers, MousePointer2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

interface ToolRailProps {
  pickMode: boolean;
  dndMode: boolean;
  xrayMode: boolean;
  onTogglePick: () => void;
  onToggleDnd: () => void;
  onToggleXray: () => void;
  onClear: () => void;
}

export function ToolRail({
  pickMode,
  dndMode,
  xrayMode,
  onTogglePick,
  onToggleDnd,
  onToggleXray,
  onClear,
}: ToolRailProps) {
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
        variant={dndMode ? "default" : "ghost"}
        size="icon"
        aria-pressed={dndMode}
        aria-label={t("editor.dragdrop")}
        title={t("editor.dragdrop")}
        onClick={onToggleDnd}
      >
        <Hand />
      </Button>
      <Button
        type="button"
        variant={xrayMode ? "default" : "ghost"}
        size="icon"
        aria-pressed={xrayMode}
        aria-label={t("editor.xray")}
        title={t("editor.xray")}
        onClick={onToggleXray}
      >
        <Layers />
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
