"use client";

import { useTranslations } from "next-intl";
import type { ElementMarker } from "@/lib/editor";

/**
 * Tiny chips for an element's state markers (plan 058 step 1). Chip copy is
 * localized, but the DOM carries a stable `data-marker` attribute per kind so
 * e2e/assertions never depend on the localized label.
 */
const MARKER_CHIP_CLASS: Record<ElementMarker, string> = {
  visible: "border-amber-800/70 bg-amber-950/50 text-amber-300",
  watch: "border-sky-800/70 bg-sky-950/50 text-sky-300",
  repeat: "border-violet-800/70 bg-violet-950/50 text-violet-300",
};

const MARKER_TIP_KEYS: Record<ElementMarker, string> = {
  visible: "editor.markers.tipVisible",
  watch: "editor.markers.tipWatch",
  repeat: "editor.markers.tipRepeat",
};

interface SpecMarkersProps {
  markers: readonly ElementMarker[];
}

export function SpecMarkers({ markers }: SpecMarkersProps) {
  const t = useTranslations();
  if (markers.length === 0) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {markers.map((marker) => (
        <span
          key={marker}
          data-marker={marker}
          title={t(MARKER_TIP_KEYS[marker])}
          aria-label={t(MARKER_TIP_KEYS[marker])}
          className={`rounded border px-1 font-mono text-[9px] leading-4 uppercase tracking-wide ${MARKER_CHIP_CLASS[marker]}`}
        >
          {t(`editor.markers.${marker}`)}
        </span>
      ))}
    </span>
  );
}
