"use client";

import { useEffect, useRef } from "react";
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

  // Gradient-flow selection ring: a gradient cannot ride on `outline`, and the
  // border+background trick would change the picked element's layout and
  // overwrite its background — so the ring is a dedicated overlay div in the
  // scroll container (scrolls with content). A rAF loop follows the element's
  // rect + border-radius through scroll, spec edits, and the panel's
  // open/close layout shift; zero-size rects (or a gone element) hide it.
  const ringRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const ring = ringRef.current;
    const container = containerRef.current;
    if (!enabled || !selectedKey || !spec || !ring || !container) return;
    let raf = 0;
    const update = () => {
      const target = findWrapperForChain(
        container,
        spec,
        selectedKey,
        selectedChain ?? [],
      )?.firstElementChild;
      const rect = target?.getBoundingClientRect();
      if (!target || !rect || rect.width === 0 || rect.height === 0) {
        ring.style.display = "none";
      } else {
        const containerRect = container.getBoundingClientRect();
        ring.style.display = "block";
        ring.style.left = `${rect.left - containerRect.left + container.scrollLeft}px`;
        ring.style.top = `${rect.top - containerRect.top + container.scrollTop}px`;
        ring.style.width = `${rect.width}px`;
        ring.style.height = `${rect.height}px`;
        ring.style.borderRadius = getComputedStyle(target).borderRadius;
      }
      raf = requestAnimationFrame(update);
    };
    raf = requestAnimationFrame(update);
    return () => {
      cancelAnimationFrame(raf);
      ring.style.display = "none";
    };
  }, [enabled, selectedKey, selectedChain, spec, containerRef]);

  if (!enabled || !selectedKey || !spec) return null;
  return (
    <div
      ref={ringRef}
      data-editor-selection-ring
      aria-hidden="true"
      className="jr-selection-ring"
    />
  );
}
