"use client";

import { useEffect } from "react";
import type { RefObject } from "react";

interface PickOverlayProps {
  enabled: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}

/**
 * Imperative pointer handling for pick mode. Returns no DOM of its own:
 * clicks on the rendered canvas are intercepted (so generated UI actions
 * never fire while picking), and the selection is marked via a
 * `data-jr-selected` attribute that the `.jr-pick-enabled` CSS styles.
 */
export function PickOverlay({
  enabled,
  containerRef,
  selectedKey,
  onSelect,
}: PickOverlayProps) {
  useEffect(() => {
    const container = containerRef.current;
    if (!enabled || !container) return;

    const handleClick = (event: MouseEvent) => {
      if ((event.target as Element).closest("[data-editor-panel]")) return;
      event.preventDefault();
      event.stopPropagation();
      const target = (event.target as Element).closest<HTMLElement>(
        "[data-jr-key]",
      );
      onSelect(target?.dataset.jrKey ?? null);
    };

    container.addEventListener("click", handleClick, true);
    return () => container.removeEventListener("click", handleClick, true);
  }, [enabled, containerRef, onSelect]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container
      .querySelectorAll("[data-jr-selected]")
      .forEach((element) => element.removeAttribute("data-jr-selected"));
    if (enabled && selectedKey) {
      container
        .querySelector(`[data-jr-key="${selectedKey}"]`)
        ?.setAttribute("data-jr-selected", "true");
    }
  }, [enabled, selectedKey, containerRef]);

  return null;
}
