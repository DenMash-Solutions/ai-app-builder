"use client";

import { useEffect } from "react";
import type { RefObject } from "react";
import type { Spec } from "@json-render/core";
import type { InstanceChain } from "@/lib/editor";
import { computeInstanceChain, findWrapperForChain } from "./instance-dom";

interface PickOverlayProps {
  enabled: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  spec: Spec | null;
  selectedKey: string | null;
  selectedChain: InstanceChain | null;
  onSelect: (key: string | null, chain: InstanceChain | null) => void;
}

/**
 * Imperative pointer handling for pick mode. Returns no DOM of its own:
 * clicks on the rendered canvas are intercepted (so generated UI actions
 * never fire while picking), and the selection is marked via a
 * `data-jr-selected` attribute that the `.jr-pick-enabled` CSS styles.
 * Picking inside a `repeat` captures the instance chain so the mark and the
 * editor scope follow the clicked instance, not the first one rendered.
 */
export function PickOverlay({
  enabled,
  containerRef,
  spec,
  selectedKey,
  selectedChain,
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
      if (!target || !spec || !target.dataset.jrKey) {
        onSelect(null, null);
        return;
      }
      const chain = computeInstanceChain(spec, target);
      onSelect(target.dataset.jrKey, chain.length > 0 ? chain : null);
    };

    container.addEventListener("click", handleClick, true);
    return () => container.removeEventListener("click", handleClick, true);
  }, [enabled, containerRef, spec, onSelect]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container
      .querySelectorAll("[data-jr-selected]")
      .forEach((element) => element.removeAttribute("data-jr-selected"));
    if (!enabled || !selectedKey || !spec) return;
    findWrapperForChain(
      container,
      spec,
      selectedKey,
      selectedChain ?? [],
    )?.setAttribute("data-jr-selected", "true");
  }, [enabled, spec, selectedKey, selectedChain, containerRef]);

  return null;
}
