"use client";

import type { Spec } from "@json-render/core";
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { useTranslations } from "next-intl";
import { DROP_ZONES, resolveMoveTarget, type DropZone } from "@/lib/editor";
import { isContainerType } from "@/lib/playground/catalog";

const DRAG_THRESHOLD_PX = 5;
const EDGE_RATIO = {
  container: 0.3,
  leaf: 0.5,
} as const;

interface GhostState {
  key: string;
  type: string;
  x: number;
  y: number;
}

interface IndicatorState {
  zone: DropZone;
  targetKey: string;
  targetParentKey: string;
  index: number;
  top: number;
  left: number;
  width: number;
  height: number;
}

interface PendingDrag {
  key: string;
  pointerId: number;
  startX: number;
  startY: number;
  armed: boolean;
}

interface CanvasDndProps {
  enabled: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  spec: Spec | null;
  onMoveTo: (key: string, targetParentKey: string, index: number) => void;
}

/**
 * Pointer-driven drag & drop on the rendered canvas. All interaction is
 * container-level delegation (the `pick-overlay.tsx` pattern): wrappers are
 * `display: contents`, so zones are measured on their element children. A 5 px
 * movement threshold arms the drag so plain clicks still select; a completed
 * drag swallows the trailing click so pick selection and generated-UI actions
 * never fire. Must render before `PickOverlay` so this component's capture
 * listener registers first.
 */
export function CanvasDnd({
  enabled,
  containerRef,
  spec,
  onMoveTo,
}: CanvasDndProps) {
  const t = useTranslations();
  const specRef = useRef(spec);
  const onMoveToRef = useRef(onMoveTo);
  const pendingRef = useRef<PendingDrag | null>(null);
  const lastPointerRef = useRef({ x: 0, y: 0 });
  const suppressClickRef = useRef(false);
  const [ghost, setGhost] = useState<GhostState | null>(null);
  const [indicator, setIndicator] = useState<IndicatorState | null>(null);

  // Latest-value refs so the listeners below attach once per `enabled` change.
  useEffect(() => {
    specRef.current = spec;
    onMoveToRef.current = onMoveTo;
  });

  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;

    const resolveZone = (
      draggedKey: string,
      x: number,
      y: number,
    ): IndicatorState | null => {
      const currentSpec = specRef.current;
      if (!currentSpec) return null;
      const hovered = document.elementFromPoint(x, y);
      const wrapper =
        hovered instanceof Element
          ? hovered.closest<HTMLElement>("[data-jr-key]")
          : null;
      if (!wrapper || !container.contains(wrapper)) return null;
      const hoverKey = wrapper.dataset.jrKey;
      if (!hoverKey) return null;
      const hoverElement = currentSpec.elements[hoverKey];
      if (!hoverElement) return null;

      // Wrappers paint no box — measure their element child.
      const box = (
        wrapper.firstElementChild ?? wrapper
      ).getBoundingClientRect();
      if (box.width === 0 && box.height === 0) return null;
      const ratio = box.height > 0 ? (y - box.top) / box.height : 0;
      const isContainer = isContainerType(hoverElement.type);
      let zone: DropZone;
      if (isContainer) {
        zone =
          ratio < EDGE_RATIO.container
            ? DROP_ZONES.before
            : ratio > 1 - EDGE_RATIO.container
              ? DROP_ZONES.after
              : DROP_ZONES.inside;
      } else {
        zone = ratio < EDGE_RATIO.leaf ? DROP_ZONES.before : DROP_ZONES.after;
      }

      const target = resolveMoveTarget(currentSpec, {
        key: draggedKey,
        hoverKey,
        zone,
      });
      if (!target) return null;

      const containerRect = container.getBoundingClientRect();
      return {
        zone,
        targetKey: target.key,
        targetParentKey: target.targetParentKey,
        index: target.index,
        top: box.top - containerRect.top + container.scrollTop,
        left: box.left - containerRect.left + container.scrollLeft,
        width: box.width,
        height: box.height,
      };
    };

    const clearDrag = () => {
      pendingRef.current = null;
      setGhost(null);
      setIndicator(null);
      container.removeAttribute("data-dnd-dragging");
    };

    const armDrag = (pending: PendingDrag, x: number, y: number) => {
      pending.armed = true;
      try {
        container.setPointerCapture(pending.pointerId);
      } catch {
        // Capture is best-effort; delegation still works without it.
      }
      container.setAttribute("data-dnd-dragging", "1");
      const element = specRef.current?.elements[pending.key];
      setGhost({ key: pending.key, type: element?.type ?? "", x, y });
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-editor-panel]")) return;
      suppressClickRef.current = false;
      const key = target.closest<HTMLElement>("[data-jr-key]")?.dataset.jrKey;
      if (!key || key === specRef.current?.root) return;
      pendingRef.current = {
        key,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        armed: false,
      };
    };

    const handlePointerMove = (event: PointerEvent) => {
      const pending = pendingRef.current;
      if (!pending || pending.pointerId !== event.pointerId) return;
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      if (!pending.armed) {
        const distance = Math.hypot(
          event.clientX - pending.startX,
          event.clientY - pending.startY,
        );
        if (distance < DRAG_THRESHOLD_PX) return;
        armDrag(pending, event.clientX, event.clientY);
      }
      setGhost((prev) =>
        prev ? { ...prev, x: event.clientX, y: event.clientY } : prev,
      );
      setIndicator(resolveZone(pending.key, event.clientX, event.clientY));
    };

    const handlePointerUp = (event: PointerEvent) => {
      const pending = pendingRef.current;
      if (!pending || pending.pointerId !== event.pointerId) return;
      if (pending.armed) {
        suppressClickRef.current = true;
        const landing = resolveZone(
          pending.key,
          lastPointerRef.current.x,
          lastPointerRef.current.y,
        );
        if (landing) {
          onMoveToRef.current(
            landing.targetKey,
            landing.targetParentKey,
            landing.index,
          );
        }
      }
      clearDrag();
    };

    const handlePointerCancel = () => {
      if (pendingRef.current?.armed) suppressClickRef.current = true;
      clearDrag();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !pendingRef.current) return;
      if (pendingRef.current.armed) suppressClickRef.current = true;
      clearDrag();
    };

    const handleDragStart = (event: DragEvent) => {
      // Native HTML5 drag (text/images) must not hijack the custom drag.
      if (pendingRef.current) event.preventDefault();
    };

    const handleScroll = () => {
      const pending = pendingRef.current;
      if (!pending?.armed) return;
      const { x, y } = lastPointerRef.current;
      setIndicator(resolveZone(pending.key, x, y));
    };

    // A completed drag still fires a click on the common ancestor — swallow it
    // so selection and generated-UI actions don't react to the drop.
    const handleClick = (event: MouseEvent) => {
      if (!suppressClickRef.current) return;
      suppressClickRef.current = false;
      event.stopImmediatePropagation();
      event.preventDefault();
    };

    container.addEventListener("pointerdown", handlePointerDown);
    container.addEventListener("pointermove", handlePointerMove);
    container.addEventListener("pointerup", handlePointerUp);
    container.addEventListener("pointercancel", handlePointerCancel);
    container.addEventListener("dragstart", handleDragStart);
    container.addEventListener("click", handleClick, true);
    container.addEventListener("scroll", handleScroll, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      container.removeEventListener("pointerdown", handlePointerDown);
      container.removeEventListener("pointermove", handlePointerMove);
      container.removeEventListener("pointerup", handlePointerUp);
      container.removeEventListener("pointercancel", handlePointerCancel);
      container.removeEventListener("dragstart", handleDragStart);
      container.removeEventListener("click", handleClick, true);
      container.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("keydown", handleKeyDown);
      clearDrag();
    };
  }, [enabled, containerRef]);

  return (
    <>
      {ghost && (
        <div
          data-dnd-ghost
          role="status"
          aria-label={t("editor.dnd.grabbed", { key: ghost.key })}
          className="pointer-events-none fixed left-0 top-0 z-50 flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono shadow-lg"
          style={{
            transform: `translate(${ghost.x + 12}px, ${ghost.y + 12}px)`,
          }}
        >
          <span className="rounded border border-zinc-600 px-1 text-[10px] text-zinc-400">
            {ghost.type}
          </span>{" "}
          <span className="text-[11px] text-zinc-100">{ghost.key}</span>
        </div>
      )}
      {indicator &&
        (indicator.zone === DROP_ZONES.inside ? (
          <div
            data-dnd-indicator
            data-dnd-zone={indicator.zone}
            aria-hidden="true"
            className="pointer-events-none absolute rounded-md border-2 border-dashed border-sky-500 bg-sky-500/10"
            style={{
              top: indicator.top,
              left: indicator.left,
              width: indicator.width,
              height: indicator.height,
            }}
          />
        ) : (
          <div
            data-dnd-indicator
            data-dnd-zone={indicator.zone}
            aria-hidden="true"
            className="pointer-events-none absolute h-[3px] rounded-full bg-sky-500"
            style={{
              top: indicator.top - 1,
              left: indicator.left,
              width: indicator.width,
            }}
          />
        ))}
    </>
  );
}
