"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { Spec } from "@json-render/core";
import type { InstanceChain } from "@/lib/editor";
import { computeInstanceChain } from "./instance-dom";
import { familyFor } from "./type-families";

interface XrayLabelsProps {
  enabled: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  spec: Spec | null;
  /**
   * Pick mode armed: chips become clickable with the canvas pick semantics
   * (click = select, shift+click = instance scope, shift+alt+click =
   * template scope) and keep the hover-focus while the pointer is over a
   * chip. Hover-revealed chips are suppressed while armed — the picker's
   * HoverBadge owns the hovered item's label; permanent chips (containers +
   * quiet leaves) stay. Off = chips stay pointer-events-none, hover chips
   * show, and clicks fall through.
   */
  interactive?: boolean;
  onSelect?: (key: string, chain: InstanceChain | null) => void;
  onToggleScope?: (
    key: string,
    chain: InstanceChain | null,
    template: boolean,
  ) => void;
}

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
  /** Chip left: box x, edge-anchored (overlay clips at the canvas edge). */
  chipLeft: number;
  /** Chip top: above the box (default), lane/row-shifted by placement. */
  chipTop: number;
  /** DOM wrapper for this instance — placement matches ancestors by
   *  element identity, never by key (repeat instances share keys). */
  wrapper: HTMLElement;
  /** Ancestor wrappers (same instance), outermost-first. */
  ancestorWrappers: Set<HTMLElement>;
}

const CHIP_HEIGHT = 20;
const CHIP_MAX_WIDTH = 160;
const EDGE = 2;
const LANE_GAP = 2;
const CHIP_LANES_UP = 3;
const CHIP_LANES_DOWN = 2;
const TUCK_LANES = 3;

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

/**
 * Identity labels for x-ray mode, tiered so the anatomy stays scannable:
 * containers get always-on `key · Type` chips (the layout skeleton), leaves
 * that self-identify (rendered text) get family-colored dots only, and quiet
 * or boxless leaves keep chips — those are the components that were
 * invisible before. Family colors (Stack/Card/Text/…) make structure
 * readable before any text is. Hovering an element focuses its subtree
 * (dim/family lights by key; the amber outline and expanded chip follow the
 * exact hovered instance — repeats share keys) — events come from the
 * canvas; the overlay stays pointer-events-none. Containment comes from the DOM wrapper
 * tree (display:contents nesting), which matches the rendered hierarchy even
 * when the model-generated spec omits child links. Permanent chips are
 * placed by a greedy hierarchy-aware lane pass (ancestors reserve first; a
 * child never sits above an ancestor's chip — up 3 lanes, one row under the
 * parent, then below-box) so nested and sibling chips never overlap and the
 * tree reads top-down, and are edge-anchored (no horizontal clamp; the
 * overlay clips at the canvas edge). Renders into a clipping overlay
 * (sibling of the scroll container) so decorations never join the scroller's
 * scrollable overflow. Measurement is event-driven (spec/toggle, passive
 * scroll + mouseover, ResizeObserver) and rAF-coalesced.
 */
export function XrayLabels({
  enabled,
  containerRef,
  spec,
  interactive = false,
  onSelect,
  onToggleScope,
}: XrayLabelsProps) {
  const [labels, setLabels] = useState<LabelBox[]>([]);
  const [parentMap, setParentMap] = useState<Record<string, string>>({});
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  // Exact hovered instance — repeat instances share keys, so the hover
  // outline/expand must follow the wrapper, not the key.
  const [hoverWrapper, setHoverWrapper] = useState<HTMLElement | null>(null);
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
      const domParents: Record<string, string> = {};
      const nodes = container.querySelectorAll<HTMLElement>("[data-jr-key]");
      nodes.forEach((wrapper) => {
        const key = wrapper.dataset.jrKey;
        const element = key ? spec.elements[key] : undefined;
        if (!key || !element) return;

        // DOM-derived containment: display:contents wrappers nest exactly per
        // the rendered tree, unlike spec fields which the model can shape
        // arbitrarily. Key→parent feeds hover focus; the wrapper-identity
        // ancestor set feeds placement (repeat instances share keys, so
        // placement must never match ancestors by key).
        const ancestorWrappers = new Set<HTMLElement>();
        let ancestor =
          wrapper.parentElement?.closest<HTMLElement>("[data-jr-key]");
        while (ancestor) {
          ancestorWrappers.add(ancestor);
          ancestor =
            ancestor.parentElement?.closest<HTMLElement>("[data-jr-key]");
        }
        const parentKey = [...ancestorWrappers].at(-1)?.dataset.jrKey;
        if (parentKey && parentKey !== key) domParents[key] = parentKey;

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
          family: familyFor(element.type),
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
          wrapper,
          ancestorWrappers,
        });
      });

      // Hierarchy-aware lane stacking for permanent chips (containers +
      // quiet leaves). Placement runs in DFS document order (the
      // querySelectorAll collection order above) so ancestors are always
      // placed before their descendants and each subtree stacks
      // contiguously — a later DOM sibling (e.g. a full-bleed background
      // image) can never reserve rows between a parent and its children
      // (the previous global depth sort did exactly that: every depth-N
      // chip across all instances was placed before any depth-N+1 chip, so
      // children landed under unrelated siblings and looked like the
      // sibling's subtree). A child never lands above an ancestor chip of
      // the SAME INSTANCE (matched by wrapper element identity — repeat
      // instances share keys, so key matching would cascade floors across
      // cards) — the tree reads top-down. Candidates: above-box lanes, one
      // row under each blocking ancestor chip, a hierarchy row, then
      // below-box lanes; last resort accepts with a hierarchy-respecting
      // default. Width is pre-estimated from label text — font-mono 10px
      // metrics are stable enough, and measuring after render would
      // flicker.
      const placed: Array<{
        wrapper: HTMLElement;
        x: number;
        y: number;
        w: number;
        h: number;
      }> = [];
      const order = next
        .map((label, index) => ({ label, index }))
        .filter(({ label }) => label.container || label.quiet);
      for (const { label, index } of order) {
        const w = estimateChipWidth(label.key, label.type);
        const h = CHIP_HEIGHT;
        const aboveBase = label.boxless ? label.y - h / 2 : label.y - h - EDGE;
        const belowBase = label.boxless
          ? label.y + h / 2 + EDGE
          : label.y + label.height + EDGE;

        // Same-instance ancestor chips bound the child from above — no x
        // scoping (a wide row's parent chip sits at the left; right-side
        // children must still stay below it) and no key matching (repeat
        // instances share keys; cross-instance chips must not cascade).
        const x2 = label.x + Math.max(label.width, w);
        const ancestorChips = placed.filter((p) =>
          label.ancestorWrappers.has(p.wrapper),
        );
        // Strictly below the lowest ancestor chip row (hierarchy reads top-down).
        const minY = ancestorChips.reduce((m, p) => Math.max(m, p.y + p.h), 0);
        // Tuck candidates only for ancestors that actually block this x-span.
        const blockers = ancestorChips.filter(
          (p) => p.x < x2 && p.x + p.w > label.x,
        );

        const candidates = [
          ...Array.from({ length: CHIP_LANES_UP + 1 }, (_, lane) => ({
            y: aboveBase - lane * (h + LANE_GAP),
          })),
          // Tuck rows stack under each blocking ancestor (same-top siblings
          // compete for the first row; without lanes the loser falls through
          // to below-box and drags its whole subtree to the element's bottom).
          ...blockers.flatMap((p) =>
            Array.from({ length: TUCK_LANES }, (_, lane) => ({
              y: p.y + p.h + LANE_GAP + lane * (h + LANE_GAP),
            })),
          ),
          ...Array.from({ length: TUCK_LANES }, (_, lane) => ({
            y: minY + LANE_GAP + lane * (h + LANE_GAP),
          })).filter(() => minY > 0),
          ...Array.from({ length: CHIP_LANES_DOWN }, (_, lane) => ({
            y: belowBase + lane * (h + LANE_GAP),
          })),
        ];
        // Hierarchy-respecting fallback: overlap is tolerable, inversion is not.
        let chosen = Math.max(aboveBase, minY + LANE_GAP);
        for (const candidate of candidates) {
          if (candidate.y < EDGE || candidate.y + h > overlayRect.height - EDGE)
            continue;
          if (candidate.y < minY) continue;
          const rect = {
            wrapper: label.wrapper,
            x: label.x,
            y: candidate.y,
            w,
            h,
          };
          if (!placed.some((p) => rectsOverlap(rect, p))) {
            chosen = candidate.y;
            placed.push(rect);
            break;
          }
        }
        next[index].chipTop = chosen;
      }

      setLabels(next);
      setParentMap(domParents);
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
      setHoverWrapper(wrapper instanceof HTMLElement ? wrapper : null);
    };

    const handleMouseLeave = (event: MouseEvent) => {
      // Pointer entering a chip (a sibling overlay) keeps the hover focus —
      // hover-only chips would otherwise unmount mid-flight and be
      // unclickable. The chip's own leave clears the state.
      const next = event.relatedTarget;
      if (next instanceof Node && overlayRef.current?.contains(next)) return;
      setHoverKey(null);
      setHoverWrapper(null);
    };

    const content = container.firstElementChild;
    const observer = new ResizeObserver(schedule);
    observer.observe(container);
    if (content) observer.observe(content);
    container.addEventListener("scroll", schedule, { passive: true });
    container.addEventListener("mouseover", handleMouseOver);
    container.addEventListener("mouseleave", handleMouseLeave);
    schedule();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      container.removeEventListener("scroll", schedule);
      container.removeEventListener("mouseover", handleMouseOver);
      container.removeEventListener("mouseleave", handleMouseLeave);
      setHoverKey(null);
      setHoverWrapper(null);
    };
  }, [enabled, spec, containerRef]);

  // Hover focus (key-based, so render never touches the DOM): the hovered
  // key, its ancestors, and its descendants stay lit; the rest fades. Repeat
  // instances share keys, so the whole family stays lit while scanning — the
  // hover outline and expanded chip are separately instance-scoped below.
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
      className="pointer-events-none absolute inset-0 z-[1000] overflow-hidden"
    >
      {enabled
        ? labels.map((label, index) => {
            const focused = focusSet === null || focusSet.has(label.key);
            // Pick armed: no hover-revealed chips — the HoverBadge is the
            // hovered label; permanent chips (containers + quiet leaves)
            // keep their chip and their click-to-pick semantics.
            const showChip =
              label.container ||
              label.quiet ||
              (!interactive && label.wrapper === hoverWrapper);
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
                    className={`absolute max-w-[160px] truncate rounded-md border bg-zinc-950/95 px-1.5 py-0.5 font-mono text-[10px] leading-3 text-zinc-200 shadow-sm ${label.family.chip}${
                      interactive
                        ? " pointer-events-auto cursor-pointer select-none"
                        : ""
                    }`}
                    style={{ left: label.chipLeft, top: label.chipTop }}
                    onClick={
                      interactive && spec
                        ? (event) => {
                            const chain = computeInstanceChain(
                              spec,
                              label.wrapper,
                            );
                            const instance = chain.length > 0 ? chain : null;
                            // Same modifier mapping as the canvas pick:
                            // shift = instance scope, shift+alt = template.
                            if (event.shiftKey && onToggleScope) {
                              onToggleScope(label.key, instance, event.altKey);
                              return;
                            }
                            onSelect?.(label.key, instance);
                          }
                        : undefined
                    }
                    onMouseEnter={
                      interactive
                        ? () => {
                            setHoverKey(label.key);
                            setHoverWrapper(label.wrapper);
                          }
                        : undefined
                    }
                    onMouseLeave={
                      interactive
                        ? () => {
                            setHoverKey(null);
                            setHoverWrapper(null);
                          }
                        : undefined
                    }
                  >
                    {label.key}
                    <span className={label.family.label}> · {label.type}</span>
                  </div>
                ) : null}
                {label.wrapper === hoverWrapper && !label.boxless ? (
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
