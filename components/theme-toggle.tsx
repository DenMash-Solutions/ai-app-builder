"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import {
  THEMES,
  applyStoredTheme,
  getServerTheme,
  getTheme,
  subscribeTheme,
  toggleTheme,
} from "@/lib/theme";

interface ThemeToggleProps {
  showLabel?: boolean;
  className?: string;
}

export function ThemeToggle({
  showLabel = false,
  className,
}: ThemeToggleProps) {
  const t = useTranslations();
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getServerTheme);
  const isDark = theme === THEMES.dark;
  const label = isDark ? t("theme.toggleToLight") : t("theme.toggleToDark");

  useLayoutEffect(() => {
    applyStoredTheme();
  }, []);

  return (
    <Button
      type="button"
      variant={showLabel ? "ghost" : "outline"}
      size="icon"
      aria-label={label}
      title={label}
      onClick={toggleTheme}
      className={cn(
        showLabel
          ? "h-9 w-full justify-start gap-2 rounded-md px-2"
          : "h-7 w-7",
        className,
      )}
    >
      {isDark ? (
        <Sun className={showLabel ? "size-4 shrink-0" : "h-3.5 w-3.5"} />
      ) : (
        <Moon className={showLabel ? "size-4 shrink-0" : "h-3.5 w-3.5"} />
      )}
      {showLabel && <span>{label}</span>}
    </Button>
  );
}
