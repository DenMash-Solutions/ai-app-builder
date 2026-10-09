"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { Spec } from "@json-render/core";
import type { InstanceChain } from "@/lib/editor";
import {
  computeInstanceChain,
  findWrapperForChain,
  findWrappersForKey,
} from "./instance-dom";

/** A prompt-scope highlight target: stable id + element key + instance chain. */
export interface ScopeHighlightTarget {
  id: string;
  key: string;
  chain: InstanceChain | null;
  /** Rendered instance count — one highlight box per instance when > 1. */
  count?: number;
}

interface PickOverlayProps {
  enabled: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  spec: Spec | null;
  selectedKey: string | null;
  selectedChain: InstanceChain | null;
  onSelect: (key: string | null, chain: InstanceChain | null) => void;
  /**
   * Double-click on the canvas: called with the hit element's key+chain so
   * the host can enter pick mode and open the editor in one gesture. Left
   * undefined while streaming (the host passes undefined) — dblclick then
   * passes through untouched. Separate from `onSelect` because it must
   * attach even while pick mode is off.
   */
  onActivate?: (key: string, chain: InstanceChain | null) => void;
  /**
   * Shift+click (pick armed): toggles prompt-scope membership for the hit
   * instance without touching the editor selection. `template` marks
   * shift+alt+click — scope the shared template (all instances) instead.
   * Undefined = shift+click falls through to a normal select.
   */
  onToggleScope?: (
    key: string,
    chain: InstanceChain | null,
    template: boolean,
  ) => void;
  /** Prompt-scope targets to highlight — renders regardless of pick mode. */
  scopeTargets?: readonly ScopeHighlightTarget[];
  /** True while a scoped steer streams — pulse + spinner on the highlights. */
  scopeLoading?: boolean;
}

/**
 * Imperative pointer handling for pick mode: clicks on the rendered canvas
 * are intercepted (so generated UI actions never fire while picking), the
 * selection is marked via a `data-jr-selected` attribute that the
 * `.jr-pick-enabled` CSS styles, and the gradient selection ring is drawn
 * in a clipping overlay. Picking inside a `repeat` captures the instance
 * chain so the mark and the editor scope follow the clicked instance, not
 * the first one rendered.
 */
export function PickOverlay({
  enabled,
  containerRef,
  spec,
  selectedKey,
  selectedChain,
  onSelect,
  onActivate,
  onToggleScope,
  scopeTargets,
  scopeLoading,
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
      if (event.shiftKey && onToggleScope) {
        onToggleScope(
          target.dataset.jrKey,
          chain.length > 0 ? chain : null,
          event.altKey,
        );
        return;
      }
      onSelect(target.dataset.jrKey, chain.length > 0 ? chain : null);
    };

    container.addEventListener("click", handleClick, true);
    return () => container.removeEventListener("click", handleClick, true);
  }, [enabled, containerRef, spec, onSelect, onToggleScope]);

  // Double-click-to-edit: attaches whenever the host provides `onActivate`
  // (i.e. a spec is on canvas and no stream is running), independent of pick
  // mode — one gesture from reading to editing. Capture phase + swallow the
  // event so generated-UI dblclick handlers never see it.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !spec || !onActivate) return;

    const handleDblClick = (event: MouseEvent) => {
      if ((event.target as Element).closest("[data-editor-panel]")) return;
      event.preventDefault();
      event.stopPropagation();
      const target = (event.target as Element).closest<HTMLElement>(
        "[data-jr-key]",
      );
      if (!target || !target.dataset.jrKey) return;
      const chain = computeInstanceChain(spec, target);
      onActivate(target.dataset.jrKey, chain.length > 0 ? chain : null);
    };

    container.addEventListener("dblclick", handleDblClick, true);
    return () =>
      container.removeEventListener("dblclick", handleDblClick, true);
  }, [containerRef, spec, onActivate]);

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

  // Prompt-scope marks: same wrapper-identity approach as the selection, but
  // rendered whenever targets exist — highlights stay visible with pick off
  // and while a scoped steer streams.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container
      .querySelectorAll("[data-jr-scope]")
      .forEach((element) => element.removeAttribute("data-jr-scope"));
    if (!spec || !scopeTargets?.length) return;
    for (const target of scopeTargets) {
      if ((target.chain?.length ?? 0) === 0) {
        // Template target: mark every rendered instance of the key.
        findWrappersForKey(container, target.key).forEach((wrapper) =>
          wrapper.setAttribute("data-jr-scope", "true"),
        );
        continue;
      }
      findWrapperForChain(
        container,
        spec,
        target.key,
        target.chain ?? [],
      )?.setAttribute("data-jr-scope", "true");
    }
  }, [spec, scopeTargets, containerRef]);

  // Gradient-flow selection ring: a gradient cannot ride on `outline`, and the
  // border+background trick would change the picked element's layout and
  // overwrite its background — so the ring is a dedicated overlay div. It must
  // NOT live inside the scroll container: an absolutely-positioned decoration
  // there participates in that container's scrollable overflow, and a selected
  // element inside an inner scroller (e.g. the carousel row) sticks out past
  // the canvas column in unclipped geometry — inflating scrollWidth and
  // creating a phantom horizontal scrollbar. Instead the ring renders in a
  // clipping overlay (`absolute inset-0 overflow-hidden` on the stage, same
  // box as the scroll container) positioned as its sibling. A rAF loop follows
  // the element's viewport rect + border-radius through scroll, spec edits,
  // and the panel's open/close layout shift; zero-size rects (or a gone
  // element) hide it.
  const ringRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const ring = ringRef.current;
    const container = containerRef.current;
    if (!enabled || !selectedKey || !spec || !ring || !container) return;
    const overlay = ring.parentElement;
    if (!overlay) return;
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
        const overlayRect = overlay.getBoundingClientRect();
        ring.style.display = "block";
        ring.style.left = `${rect.left - overlayRect.left}px`;
        ring.style.top = `${rect.top - overlayRect.top}px`;
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

  // Scope highlight boxes: one tracked div per rendered instance of each
  // target (template targets fan out to every instance), same clipping-overlay
  // + rAF pattern as the selection ring (survives inner scrollers, adds no
  // overflow, follows scroll/panel shifts). Boxes carry `data-scope-box` =
  // target id + `data-scope-slot` = instance index for the rAF lookup.
  const scopeBoxesRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const overlay = scopeBoxesRef.current?.parentElement;
    const container = containerRef.current;
    if (!overlay || !container || !spec || !scopeTargets?.length) return;
    let raf = 0;
    const update = () => {
      const boxes = overlay.querySelectorAll<HTMLElement>("[data-scope-box]");
      const overlayRect = overlay.getBoundingClientRect();
      boxes.forEach((box) => {
        const id = box.getAttribute("data-scope-box");
        const slot = Number(box.getAttribute("data-scope-slot") ?? "0");
        const target = scopeTargets.find((candidate) => candidate.id === id);
        const wrappers =
          target === undefined
            ? []
            : (target.chain?.length ?? 0) === 0
              ? findWrappersForKey(container, target.key)
              : (() => {
                  const wrapper = findWrapperForChain(
                    container,
                    spec,
                    target.key,
                    target.chain ?? [],
                  );
                  return wrapper ? [wrapper] : [];
                })();
        const wrapper = wrappers[slot] ?? null;
        const element = wrapper?.firstElementChild ?? null;
        const rect = element?.getBoundingClientRect();
        if (!element || !rect || rect.width === 0 || rect.height === 0) {
          box.style.display = "none";
        } else {
          box.style.display = "block";
          box.style.left = `${rect.left - overlayRect.left}px`;
          box.style.top = `${rect.top - overlayRect.top}px`;
          box.style.width = `${rect.width}px`;
          box.style.height = `${rect.height}px`;
          box.style.borderRadius = getComputedStyle(element).borderRadius;
        }
      });
      raf = requestAnimationFrame(update);
    };
    raf = requestAnimationFrame(update);
    return () => cancelAnimationFrame(raf);
  }, [spec, scopeTargets, containerRef]);

  const showRing = enabled && !!selectedKey && !!spec;
  const showScope = !!spec && (scopeTargets?.length ?? 0) > 0;
  if (!showRing && !showScope) return null;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
    >
      {showRing && (
        <div
          ref={ringRef}
          data-editor-selection-ring
          className="jr-selection-ring"
        />
      )}
      {showScope && (
        <div ref={scopeBoxesRef} className="contents">
          {scopeTargets?.flatMap((target) => {
            const slots = target.count ?? 1;
            return Array.from({ length: slots }, (_, slot) => (
              <div
                key={`${target.id}#${slot}`}
                data-scope-box={target.id}
                data-scope-slot={slot}
                data-scope-loading={scopeLoading ? "true" : undefined}
                className="jr-scope-ring"
              >
                {scopeLoading && (
                  <span className="absolute -left-2.5 -top-2.5 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-400 text-zinc-950">
                    <Loader2 className="h-3 w-3 animate-spin" />
                  </span>
                )}
              </div>
            ));
          })}
        </div>
      )}
    </div>
  );
}
