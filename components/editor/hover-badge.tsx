"use client";

import { useEffect, useState } from "react";
import type { RefObject } from "react";
import type { Spec } from "@json-render/core";
import { useTranslations } from "next-intl";
import { asElement } from "@/components/editor/cross-realm";
import { elementMarkers } from "@/lib/editor";
import type { ElementMarker } from "@/lib/editor";

interface BadgeState {
  key: string;
  type: string;
  childCount: number;
  markers: ElementMarker[];
  top: number;
  left: number;
  width: number;
  height: number;
  below: boolean;
}

interface HoverBadgeProps {
  enabled: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  spec: Spec | null;
}

/**
 * Floating info chip shown while pick mode hovers an element: type, key,
 * rendered size, and child count. `pointer-events-none` keeps it out of the
 * way of the pick overlay's hit-testing.
 */
export function HoverBadge({ enabled, containerRef, spec }: HoverBadgeProps) {
  const [badge, setBadge] = useState<BadgeState | null>(null);
  const t = useTranslations();

  useEffect(() => {
    const container = containerRef.current;
    if (!enabled || !container || !spec) {
      setBadge(null);
      return;
    }

    const resolveWrapper = (target: EventTarget | null): HTMLElement | null =>
      // Realm-safe (R3): frame-origin events carry iframe-realm nodes, which
      // fail `instanceof Element` — that would kill the badge inside the frame.
      asElement(target)?.closest<HTMLElement>("[data-jr-key]") ?? null;

    // Measure the WRAPPER that was hovered, never a key lookup — repeated
    // instances share keys and querySelector returns the first one, which
    // pinned the badge to the first instance no matter where the cursor was.
    const measure = (wrapper: HTMLElement): BadgeState | null => {
      const key = wrapper.dataset.jrKey;
      if (!key) return null;
      const element = spec.elements[key];
      if (!element) return null;
      const rect = (
        wrapper.firstElementChild ?? wrapper
      ).getBoundingClientRect();
      if (!rect || rect.width === 0) return null;
      return {
        key,
        type: element.type,
        childCount: (element.children ?? []).length,
        markers: elementMarkers(element),
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        below: rect.top < 40,
      };
    };

    const handleMouseOver = (event: MouseEvent) => {
      const wrapper = resolveWrapper(event.target);
      setBadge(wrapper ? measure(wrapper) : null);
    };

    const handleMouseOut = (event: MouseEvent) => {
      if (!resolveWrapper(event.relatedTarget)) setBadge(null);
    };

    container.addEventListener("mouseover", handleMouseOver);
    container.addEventListener("mouseout", handleMouseOut);
    return () => {
      container.removeEventListener("mouseover", handleMouseOver);
      container.removeEventListener("mouseout", handleMouseOut);
      setBadge(null);
    };
  }, [enabled, containerRef, spec]);

  if (!badge) return null;

  const parts = [
    badge.type,
    badge.key,
    `${Math.round(badge.width)}×${Math.round(badge.height)}`,
  ];
  if (badge.childCount > 0) {
    parts.push(`${badge.childCount}`);
  }
  // State markers (058): surface visible/watch/repeat so conditional
  // components are discoverable while hovered in pick mode.
  parts.push(...badge.markers.map((marker) => t(`editor.markers.${marker}`)));

  return (
    <div
      data-editor-badge
      aria-hidden="true"
      className="pointer-events-none fixed z-[1001] rounded-md border border-zinc-700 bg-zinc-950/95 px-2 py-1 font-mono text-[11px] text-zinc-200 shadow-lg"
      style={{
        top: badge.below ? badge.top + 4 : badge.top - 28,
        left: Math.max(badge.left, 8),
      }}
    >
      {parts.join(" · ")}
    </div>
  );
}
