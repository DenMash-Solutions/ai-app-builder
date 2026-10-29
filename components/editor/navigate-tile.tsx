"use client";

import { Compass } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ScreenListing } from "@/lib/projects/screen-nav";

/**
 * Radix Select values cannot be the empty string — this sentinel reads as
 * "no navigation" and clears the binding. Screen refs are UUIDs, so it can
 * never collide with a real target.
 */
const NO_NAVIGATION = "none";

export interface NavigateTileProps {
  /** Sibling screens in scope — the same set the prompt was taught with. */
  screens: readonly ScreenListing[];
  /** The element's current `navigate` ref (null = no binding). */
  currentRef: string | null;
  onChange: (ref: string | null) => void;
}

/**
 * "Navigate to screen" picker (plan 061, decision 6): writes the ref, never
 * a path — routes are surface- and locale-specific and only resolve at
 * click time. A current target that fell out of scope (deleted screen,
 * moved project) stays listed as missing so a stale binding remains visible
 * and retargetable instead of masquerading as "no navigation".
 */
export function NavigateTile({
  screens,
  currentRef,
  onChange,
}: NavigateTileProps) {
  const t = useTranslations();
  const stale =
    currentRef !== null && !screens.some((screen) => screen.ref === currentRef);
  const options = stale
    ? [
        {
          ref: currentRef,
          name: t("editor.navigate.missingTarget", {
            ref: currentRef.slice(0, 8),
          }),
        },
        ...screens,
      ]
    : screens;

  return (
    <div className="flex flex-col gap-2 border-t border-zinc-800 px-3 py-3">
      <div className="flex items-center gap-1.5">
        <Compass className="h-3.5 w-3.5 shrink-0 text-amber-300" />
        <span className="text-xs font-medium text-zinc-200">
          {t("editor.navigate.title")}
        </span>
      </div>
      <Select
        value={currentRef ?? NO_NAVIGATION}
        onValueChange={(value) =>
          onChange(value === NO_NAVIGATION ? null : value)
        }
      >
        <SelectTrigger className="h-8 w-full border-zinc-700 bg-zinc-900 text-xs text-zinc-100">
          <SelectValue placeholder={t("editor.navigate.none")} />
        </SelectTrigger>
        <SelectContent className="dark">
          <SelectItem value={NO_NAVIGATION} className="text-xs">
            {t("editor.navigate.none")}
          </SelectItem>
          {options.map((screen) => (
            <SelectItem key={screen.ref} value={screen.ref} className="text-xs">
              {screen.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {screens.length === 0 && (
        <p className="text-[11px] leading-snug text-zinc-500">
          {t("editor.navigate.empty")}
        </p>
      )}
    </div>
  );
}
