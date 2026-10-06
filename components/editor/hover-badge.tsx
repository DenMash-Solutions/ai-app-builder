"use client";

import { useEffect, useState } from "react";
import type { RefObject } from "react";
import type { Spec } from "@json-render/core";

interface BadgeState {
  key: string;
  type: string;
  childCount: number;
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

  useEffect(() => {
    const container = containerRef.current;
    if (!enabled || !container || !spec) {
      setBadge(null);
      return;
    }

    const resolveKey = (target: EventTarget | null): string | null => {
      if (!(target instanceof Element)) return null;
      const wrapper = target.closest<HTMLElement>("[data-jr-key]");
      return wrapper?.dataset.jrKey ?? null;
    };

    const measure = (key: string): BadgeState | null => {
      const element = spec.elements[key];
      if (!element) return null;
      const wrapper = container.querySelector<HTMLElement>(
        `[data-jr-key="${key}"]`,
      );
      const rect = (
        wrapper?.firstElementChild ?? wrapper
      )?.getBoundingClientRect();
      if (!rect || rect.width === 0) return null;
      return {
        key,
        type: element.type,
        childCount: (element.children ?? []).length,
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        below: rect.top < 40,
      };
    };

    const handleMouseOver = (event: MouseEvent) => {
      const key = resolveKey(event.target);
      setBadge(key ? measure(key) : null);
    };

    const handleMouseOut = (event: MouseEvent) => {
      const nextKey = resolveKey(event.relatedTarget);
      if (nextKey === null) setBadge(null);
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

  return (
    <div
      data-editor-badge
      aria-hidden="true"
      className="pointer-events-none fixed z-50 rounded-md border border-zinc-700 bg-zinc-950/95 px-2 py-1 font-mono text-[11px] text-zinc-200 shadow-lg"
      style={{
        top: badge.below ? badge.top + 4 : badge.top - 28,
        left: Math.max(badge.left, 8),
      }}
    >
      {parts.join(" · ")}
    </div>
  );
}
