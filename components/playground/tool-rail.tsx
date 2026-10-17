"use client";

import { Eraser, Hand, Layers, MousePointer2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ContentLanguageSwitcher } from "@/components/content-language-switcher";
import type { ContentLanguageSwitcherProps } from "@/components/content-language-switcher";

interface ToolRailProps {
  pickMode: boolean;
  dndMode: boolean;
  xrayMode: boolean;
  onTogglePick: () => void;
  onToggleDnd: () => void;
  onToggleXray: () => void;
  /** The SPEC's content language (rail = spec-only controls): trigger shows
   *  the current tag; its popover carries switch/translate/remove and the
   *  "Add language…" row. Null on the empty playground (nothing to control
   *  until a spec displays). */
  contentLang: ContentLanguageSwitcherProps | null;
  onClear: () => void;
}

export function ToolRail({
  pickMode,
  dndMode,
  xrayMode,
  onTogglePick,
  onToggleDnd,
  onToggleXray,
  contentLang,
  onClear,
}: ToolRailProps) {
  const t = useTranslations();
  return (
    <div
      data-tool-rail
      className="absolute right-4 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-1 rounded-2xl border bg-background/80 p-1.5 shadow-lg backdrop-blur-md"
    >
      <Button
        type="button"
        variant={pickMode ? "default" : "ghost"}
        size="icon"
        aria-pressed={pickMode}
        aria-label={t("editor.pick")}
        aria-keyshortcuts="p"
        title={`${t("editor.pick")} (P)`}
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
        aria-keyshortcuts="g"
        title={`${t("editor.dragdrop")} (G)`}
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
        aria-keyshortcuts="x"
        title={`${t("editor.xray")} (X)`}
        onClick={onToggleXray}
      >
        <Layers />
      </Button>
      {contentLang && <ContentLanguageSwitcher {...contentLang} />}
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
