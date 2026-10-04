"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  THEMES,
  getServerTheme,
  getTheme,
  subscribeTheme,
  toggleTheme,
} from "@/lib/theme";

export function ThemeToggle() {
  const t = useTranslations();
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getServerTheme);
  const isDark = theme === THEMES.dark;

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      aria-label={isDark ? t("theme.toggleToLight") : t("theme.toggleToDark")}
      onClick={toggleTheme}
      className="h-7 w-7"
    >
      {isDark ? (
        <Sun className="h-3.5 w-3.5" />
      ) : (
        <Moon className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}
