"use client";

import { useState } from "react";
import { Ellipsis, Globe, History as HistoryIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { ModelSwitcher } from "@/components/model-switcher";
import { ThemeToggle } from "@/components/theme-toggle";

interface TopBarProps {
  historyCount: number;
  onOpenHistory: () => void;
}

const ROW_CLASS = "h-9 w-full justify-start gap-2 rounded-md px-2";

export function TopBar({ historyCount, onOpenHistory }: TopBarProps) {
  const t = useTranslations();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleOpenHistory = () => {
    setMenuOpen(false);
    onOpenHistory();
  };

  return (
    <header className="absolute inset-x-4 top-4 z-20 flex flex-wrap items-start justify-between gap-3">
      <div className="flex max-w-full items-center gap-3 rounded-full border bg-background/80 px-4 py-2 shadow-lg backdrop-blur-md">
        <h1 className="min-w-0 truncate text-base font-semibold tracking-tight">
          {t("playground.title")}
        </h1>
        <Badge variant="secondary" className="shrink-0">
          json-render
        </Badge>
      </div>

      <div className="flex">
        <div className="hidden items-center gap-1.5 rounded-full border bg-background/80 px-2 py-1.5 shadow-lg backdrop-blur-md sm:flex">
          <ModelSwitcher variant="pill" />
          <LocaleSwitcher />
          <ThemeToggle />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onOpenHistory}
          >
            {t("playground.history")}
            {historyCount > 0 && (
              <Badge variant="secondary" className="ml-2">
                {historyCount}
              </Badge>
            )}
          </Button>
        </div>

        <div className="sm:hidden">
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={t("playground.openMenu")}
                className="rounded-full border bg-background/80 shadow-lg backdrop-blur-md"
              >
                <Ellipsis />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              aria-label={t("playground.openMenu")}
              className="flex w-64 flex-col gap-1"
            >
              <div className="flex h-9 w-full items-center gap-2 rounded-md px-2">
                <Globe aria-hidden="true" className="size-4 shrink-0" />
                <span className="text-sm text-muted-foreground">
                  {t("localeSwitcher.label")}
                </span>
                <div className="ml-auto">
                  <LocaleSwitcher />
                </div>
              </div>
              <ThemeToggle showLabel />
              <ModelSwitcher variant="row" />
              <Button
                type="button"
                variant="ghost"
                className={ROW_CLASS}
                onClick={handleOpenHistory}
              >
                <HistoryIcon aria-hidden="true" className="size-4 shrink-0" />
                <span>{t("playground.history")}</span>
                {historyCount > 0 && (
                  <Badge variant="secondary" className="ml-auto">
                    {historyCount}
                  </Badge>
                )}
              </Button>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </header>
  );
}
