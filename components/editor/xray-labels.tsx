"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { Spec } from "@json-render/core";

interface XrayLabelsProps {
  enabled: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  spec: Spec | null;
}

/** Per-family chip/dot colors. Static strings so Tailwind compiles them;
 *  outline colors mirror these in globals.css (`data-jr-type` rules). */
const TYPE_FAMILIES: Record<
  string,
  { label: string; dot: string; chip: string }
> = {
  Stack: {
    label: "text-emerald-300",
    dot: "bg-emerald-400",
    chip: "border-emerald-500/60",
  },
  Card: {
    label: "text-violet-300",
    dot: "bg-violet-400",
    chip: "border-violet-500/60",
  },
  Text: {
    label: "text-sky-300",
    dot: "bg-sky-400",
    chip: "border-sky-500/60",
  },
  Heading: {
    label: "text-sky-300",
    dot: "bg-sky-400",
    chip: "border-sky-500/60",
  },
  Badge: {
    label: "text-amber-300",
    dot: "bg-amber-400",
    chip: "border-amber-500/60",
  },
  Image: {
    label: "text-pink-300",
    dot: "bg-pink-400",
    chip: "border-pink-500/60",
  },
  Button: {
    label: "text-rose-300",
    dot: "bg-rose-400",
    chip: "border-rose-500/60",
  },
};
const DEFAULT_FAMILY = {
  label: "text-zinc-300",
  dot: "bg-zinc-400",
  chip: "border-zinc-500/60",
};

interface LabelBox {
  key: string;
  type: string;
  family: { label: string; dot: string; chip: string };
  /** Spec element has children/slots — the layout skeleton. */
  container: boolean;
  /** No rendered text (images, overlays, empty spacers) or no box at all. */
  quiet: boolean;
  /** No measurable box — render the forced marker. */
  boxless: boolean;
  /** Corner-dot / marker / chip anchor (box top-left), overlay coords. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Chip left, clamped inside the overlay so long keys never clip mid-word. */
  chipLeft: number;
  /** Chip top: above the box (default), below when clamped at the top edge. */
  chipTop: number;
}

const CHIP_HEIGHT = 20;
const CHIP_MAX_WIDTH = 160;
const EDGE = 2;
const LANE_GAP = 2;
const CHIP_LANES_UP = 3;
const CHIP_LANES_DOWN = 2;

/** `font-mono` 10px ≈ 6.2px/char; "key · type" + px-1.5 padding + border. */
function estimateChipWidth(key: string, type: string): number {
  return Math.min(CHIP_MAX_WIDTH, (key.length + type.length + 3) * 6.2 + 16);
}

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}

function isContainer(spec: Spec, key: string): boolean {
  const element = spec.elements[key];
  return (
    !!element &&
    ((element.children?.length ?? 0) > 0 ||
      Object.values(element.slots ?? {}).flat().length > 0)
  );
}

/** child key → parent key, built from the spec tree (hover focus). */
function buildParentMap(spec: Spec): Record<string, string> {
  const parents: Record<string, string> = {};
  for (const [key, element] of Object.entries(spec.elements)) {
    for (const child of element?.children ?? []) parents[child] = key;
    for (const slotChildren of Object.values(element?.slots ?? {})) {
      for (const child of slotChildren) parents[child] = key;
    }
  }
  return parents;
}

/**
 * Identity labels for x-ray mode, tiered so the anatomy stays scannable:
 * containers get always-on `key · Type` chips (the layout skeleton), leaves
 * that self-identify (rendered text) get family-colored dots only, and quiet
 * or boxless leaves keep chips — those are the components that were
 * invisible before. Family colors (Stack/Card/Text/…) make structure
 * readable before any text is. Hovering an element focuses its subtree
 * (chips expand, everything else fades) — events come from the canvas; the
 * overlay stays pointer-events-none. Permanent chips are placed by a greedy
 * lane-stacking pass (up 3 lanes, then below-box) so nested and sibling
 * chips never overlap, and are edge-anchored (no horizontal clamp; the
 * overlay clips at the canvas edge). Renders into a clipping overlay
 * (sibling of the scroll container) so decorations never join the scroller's
 * scrollable overflow. Measurement is event-driven (spec/toggle, passive
 * scroll + mouseover, ResizeObserver) and rAF-coalesced.
 */
export function XrayLabels({ enabled, containerRef, spec }: XrayLabelsProps) {
  const [labels, setLabels] = useState<LabelBox[]>([]);
  const [parentMap, setParentMap] = useState<Record<string, string>>({});
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const overlay = overlayRef.current;
    if (!enabled || !spec || !container || !overlay) return;

    let raf = 0;
    const update = () => {
      raf = 0;
      const overlayRect = overlay.getBoundingClientRect();
      const next: LabelBox[] = [];
      const nodes = container.querySelectorAll<HTMLElement>("[data-jr-key]");
      nodes.forEach((wrapper) => {
        const key = wrapper.dataset.jrKey;
        const element = key ? spec.elements[key] : undefined;
        if (!key || !element) return;

        // Union of direct element children — display:contents wrappers and
        // zero-area boxes contribute nothing; fragments union correctly.
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const child of Array.from(wrapper.children)) {
          const rect = child.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;
          minX = Math.min(minX, rect.left);
          minY = Math.min(minY, rect.top);
          maxX = Math.max(maxX, rect.right);
          maxY = Math.max(maxY, rect.bottom);
        }

        let boxless = false;
        let left: number;
        let top: number;
        let width = 0;
        let height = 0;
        if (minX === Infinity) {
          const own = wrapper.getBoundingClientRect();
          if (own.width > 0 || own.height > 0) {
            left = own.left;
            top = own.top;
            width = own.width;
            height = own.height;
          } else {
            // No measurable box: cascade from the nearest ancestor box (depth
            // × 10px indent) so the marker is always on screen and distinct
            // from its parent's anchor.
            boxless = true;
            let depth = 0;
            let ancestor =
              wrapper.parentElement?.closest<HTMLElement>("[data-jr-key]");
            let ax = overlayRect.left + 12;
            let ay = overlayRect.top + 12;
            while (ancestor) {
              depth += 1;
              const ancestorRect = ancestor.getBoundingClientRect();
              if (ancestorRect.width > 0 || ancestorRect.height > 0) {
                ax = ancestorRect.left;
                ay = ancestorRect.top;
              }
              ancestor =
                ancestor.parentElement?.closest<HTMLElement>("[data-jr-key]");
            }
            left = ax + depth * 10;
            top = ay + depth * 10;
          }
        } else {
          left = minX;
          top = minY;
          width = maxX - minX;
          height = maxY - minY;
        }

        const quiet = boxless || (wrapper.textContent ?? "").trim() === "";
        const x = left - overlayRect.left;
        const y = top - overlayRect.top;
        next.push({
          key,
          type: element.type,
          family: TYPE_FAMILIES[element.type] ?? DEFAULT_FAMILY,
          container: isContainer(spec, key),
          quiet,
          boxless,
          x,
          y,
          width,
          height,
          // Defaults for hover-only chips (text leaves); permanent chips get
          // placed by the lane pass below. Edge-anchored: chipLeft = box x,
          // the overlay's overflow-hidden clips at the canvas edge.
          chipLeft: x,
          chipTop: boxless ? y - CHIP_HEIGHT / 2 : y - CHIP_HEIGHT - EDGE,
        });
      });

      // Lane stacking for permanent chips (containers + quiet leaves), in
      // (y, x) order so higher/left chips reserve their spot first: shift up
      // one lane per collision (max 3), then try below the box (max 2),
      // else accept. Width is pre-estimated from label text — font-mono 10px
      // metrics are stable enough, and measuring after render would flicker.
      const placed: Array<{ x: number; y: number; w: number; h: number }> = [];
      const order = next
        .map((label, index) => ({ label, index }))
        .filter(({ label }) => label.container || label.quiet)
        .sort((a, b) => a.label.y - b.label.y || a.label.x - b.label.x);
      for (const { label, index } of order) {
        const w = estimateChipWidth(label.key, label.type);
        const h = CHIP_HEIGHT;
        const aboveBase = label.boxless ? label.y - h / 2 : label.y - h - EDGE;
        const belowBase = label.boxless
          ? label.y + h / 2 + EDGE
          : label.y + label.height + EDGE;
        const candidates = [
          ...Array.from({ length: CHIP_LANES_UP + 1 }, (_, lane) => ({
            y: aboveBase - lane * (h + LANE_GAP),
          })),
          ...Array.from({ length: CHIP_LANES_DOWN }, (_, lane) => ({
            y: belowBase + lane * (h + LANE_GAP),
          })),
        ];
        let chosen = candidates[0].y;
        for (const candidate of candidates) {
          if (candidate.y < EDGE || candidate.y + h > overlayRect.height - EDGE)
            continue;
          const rect = { x: label.x, y: candidate.y, w, h };
          if (!placed.some((p) => rectsOverlap(rect, p))) {
            chosen = candidate.y;
            placed.push(rect);
            break;
          }
        }
        next[index].chipTop = chosen;
      }

      setLabels(next);
      setParentMap(buildParentMap(spec));
    };

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };

    const handleMouseOver = (event: MouseEvent) => {
      const wrapper = (event.target as Element | null)?.closest?.(
        "[data-jr-key]",
      );
      setHoverKey(
        wrapper instanceof HTMLElement ? (wrapper.dataset.jrKey ?? null) : null,
      );
    };

    const content = container.firstElementChild;
    const observer = new ResizeObserver(schedule);
    observer.observe(container);
    if (content) observer.observe(content);
    container.addEventListener("scroll", schedule, { passive: true });
    container.addEventListener("mouseover", handleMouseOver);
    schedule();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      container.removeEventListener("scroll", schedule);
      container.removeEventListener("mouseover", handleMouseOver);
      setHoverKey(null);
    };
  }, [enabled, spec, containerRef]);

  // Hover focus (spec-tree based, so render never touches the DOM): the
  // hovered key, its ancestors, and its descendants stay lit; the rest fades.
  // Repeat instances share keys, so all instances of the hovered key focus —
  // acceptable at x-ray's scanning granularity.
  const focusSet = useMemo(() => {
    if (!hoverKey) return null;
    const set = new Set<string>();
    let cursor: string | undefined = hoverKey;
    while (cursor) {
      set.add(cursor);
      cursor = parentMap[cursor];
    }
    for (const label of labels) {
      let ancestor: string | undefined = label.key;
      while (ancestor) {
        if (ancestor === hoverKey) {
          set.add(label.key);
          break;
        }
        ancestor = parentMap[ancestor];
      }
    }
    return set;
  }, [hoverKey, parentMap, labels]);

  return (
    <div
      ref={overlayRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
    >
      {enabled
        ? labels.map((label, index) => {
            const focused = focusSet === null || focusSet.has(label.key);
            const showChip =
              label.container || label.quiet || label.key === hoverKey;
            return (
              <div
                key={`${index}-${label.key}`}
                className={`transition-opacity duration-150 ${
                  focused ? "" : "opacity-30"
                }`}
              >
                {label.boxless ? (
                  <div
                    data-xray-marker={label.key}
                    className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-amber-400 bg-amber-400/30"
                    style={{ left: label.x, top: label.y }}
                  />
                ) : (
                  <div
                    data-xray-dot={label.key}
                    className={`absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${label.family.dot}`}
                    style={{ left: label.x, top: label.y }}
                  />
                )}
                {showChip ? (
                  <div
                    data-xray-chip={label.key}
                    className={`absolute max-w-[160px] truncate rounded-md border bg-zinc-950/95 px-1.5 py-0.5 font-mono text-[10px] leading-3 text-zinc-200 shadow-sm ${label.family.chip}`}
                    style={{ left: label.chipLeft, top: label.chipTop }}
                  >
                    {label.key}
                    <span className={label.family.label}> · {label.type}</span>
                  </div>
                ) : null}
                {label.key === hoverKey && !label.boxless ? (
                  <div
                    className="absolute rounded-[2px] border-2 border-amber-400/90"
                    style={{
                      left: label.x,
                      top: label.y,
                      width: label.width,
                      height: label.height,
                    }}
                  />
                ) : null}
              </div>
            );
          })
        : null}
    </div>
  );
}
