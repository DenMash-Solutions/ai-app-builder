"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { Spec } from "@json-render/core";
import { useTranslations } from "next-intl";
import { Check, Plus, X } from "lucide-react";
import type { InstanceChain } from "@/lib/editor";
import { scopeTargetId } from "@/lib/editor";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { computeInstanceChain } from "./instance-dom";
import { familyFor, type TypeFamily } from "./type-families";

interface XrayLabelsProps {
  enabled: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  spec: Spec | null;
  /**
   * Pick mode armed: clicking a dot also selects the element (canvas pick
   * semantics). Dots are interactive whenever x-ray is on — pick only adds
   * the select-on-click behavior.
   */
  pickArmed?: boolean;
  /** Scope target ids (see `scopeTargetId`) — drives the chip ✓/`+` state. */
  scopeIds?: ReadonlySet<string>;
  onSelect?: (key: string, chain: InstanceChain | null) => void;
  onToggleScope?: (
    key: string,
    chain: InstanceChain | null,
    template: boolean,
  ) => void;
  /** Remove every scope target for a key (chip X button removes pin + scope). */
  onRemoveScope?: (key: string) => void;
}

interface DotBox {
  key: string;
  type: string;
  family: TypeFamily;
  /** No measurable box — amber dot at the cascade anchor. */
  boxless: boolean;
  /** Anchor (box top-left or cascade), overlay coords, before fan. */
  x: number;
  y: number;
  /** DOM wrapper for this instance — pins follow element identity, never
   *  key (repeat instances share keys). */
  wrapper: HTMLElement;
}

/** Placed position: unpinned dots fan as hit-sized spans around a center;
 *  pinned chips fan as text-width spans from a left edge. */
interface PlacedDot extends DotBox {
  /** Dot center (unpinned) or chip left edge (pinned). */
  placeX: number;
}

/** Dot visual is 14px inside a 20px hit button; the fan pitch equals the
 *  hit size — a fanned member's neighbor sits exactly one hit-size away,
 *  so every dot's center stays hittable (a larger hit box would cover the
 *  neighbor's center and make the covered dot unreachable). */
const DOT_VISUAL = 14;
const DOT_HIT = 20;
/** Fan pitch (and proximity threshold): spans within this distance in the
 *  same y-band shift to rightmost + FAN_PITCH — tight rows, no hidden
 *  members. Also the minimum in-band center-to-center distance (e2e's
 *  clash check keys off this). */
const FAN_PITCH = 20;
const EDGE = 2;
/** Hover label height: py-0.5 (4) + leading-3 (12) + border (2) — labels
 *  sit flush against the dot button (no gap: a gap would drop the hover
 *  focus mid-flight and unmount the label before the pointer arrives). */
const LABEL_HEIGHT = 18;
/** Pinned chip height: py-0.5 (4) + h-4 icon buttons (16) + border (2). */
const CHIP_HEIGHT = 22;
/** Chip exit animation duration — the slot is held until the commit so
 *  neighbors only shift after the chip is gone. */
const CHIP_OUT_MS = 180;
/** Key truncation budget (CSS ellipsis past this); the type never truncates
 *  (types are short). */
const KEY_TRUNCATE_CH = 18;

/** Fan-placement width estimate for a pinned chip (font-mono 10px ≈
 *  6.2px/char + scope trigger + remove button + gaps + padding + border +
 *  slack). Only feeds the placement pass — a few px of drift shifts
 *  neighbors, never clips. */
function estimateChipWidth(key: string, type: string): number {
  const keyCh = Math.min(KEY_TRUNCATE_CH, key.length);
  return Math.ceil(
    keyCh * 6.2 + type.length * 6.2 + 6.2 + 16 + 16 + 16 + 12 + 2 + 6,
  );
}

/**
 * X-ray markers: one family-colored dot per element at its box top-left
 * (boxless elements keep the cascade anchor, amber dot). Near-coincident
 * anchors fan horizontally — pinned chips occupy their estimated text
 * width and push the rest of the row right. Hovering a dot shows a
 * `key · Type` label and lights its subtree; clicking transforms the dot
 * in place into an animated chip (pin — multiple allowed) that sits fully
 * above the element's top border and outlines the element's own border.
 * Removing (X button, chip body, Escape, canvas click) plays a shrink-out
 * animation before the pin commits away. Every chip carries a left-side
 * `+`/`✓` scope toggle; repeatable keys wrap it in a this-instance /
 * all-instances dropdown (active membership removes on click), while
 * singletons toggle scope directly (instance and template collapse to the
 * same target there). With pick armed a dot click also selects. Events come from the dots (the overlay
 * stays pointer-events-none otherwise); containment comes from the DOM
 * wrapper tree (display:contents nesting matches the rendered hierarchy
 * even when the model-generated spec omits child links). Renders into a
 * clipping overlay (sibling of the scroll container) so decorations never
 * join the scroller's scrollable overflow. Measurement is event-driven
 * (spec/toggle, passive scroll, ResizeObserver) and rAF-coalesced.
 */
export function XrayLabels({
  enabled,
  containerRef,
  spec,
  pickArmed = false,
  scopeIds,
  onSelect,
  onToggleScope,
  onRemoveScope,
}: XrayLabelsProps) {
  const t = useTranslations();
  const [dots, setDots] = useState<DotBox[]>([]);
  const [parentMap, setParentMap] = useState<Record<string, string>>({});
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  // Exact hovered instance — repeat instances share keys, so the focus and
  // label must follow the wrapper, not the key.
  const [hoverWrapper, setHoverWrapper] = useState<HTMLElement | null>(null);
  const [pinned, setPinned] = useState<ReadonlySet<HTMLElement>>(new Set());
  // Which chip's scope dropdown is open (wrapper identity, like pins). A
  // controlled open lets each choice close the menu explicitly — the `+`
  // trigger lives inside the overlay that also wraps the chip, so Radix's
  // outside-click detection sees every trigger press as "outside" the
  // portaled content and would snap the menu shut the instant it reopens.
  const [scopeMenu, setScopeMenu] = useState<HTMLElement | null>(null);
  // Canvas-click-clears-pins must not fire for the click that merely
  // dismisses an open scope dropdown. Radix closes on pointerdown (before
  // click) and our React state is already null by click time, so we record
  // the close moment and ignore canvas clears for a short window after.
  const scopeMenuClosedAtRef = useRef(0);
  // Wrappers whose chip is mid exit-animation — kept in `pinned` (so the
  // fan slot holds and neighbors don't jump) until the commit timer removes
  // them. Removal is always routed through beginRemove so X, chip body,
  // Escape, and canvas-click share one animated path.
  const [removing, setRemoving] = useState<ReadonlySet<HTMLElement>>(new Set());
  const removeTimersRef = useRef(
    new Map<HTMLElement, ReturnType<typeof setTimeout>>(),
  );
  const overlayRef = useRef<HTMLDivElement | null>(null);

  // Animated unpin: hold the chip's fan slot, play the exit keyframe, then
  // commit (unpin + release the slot). Idempotent per wrapper — the timer
  // map is the source of truth so double-clicks and overlapping clear-alls
  // never stack timers. The commit also drops every prompt-scope target for
  // the key (the chip's X removes pin + scope together) so no dangling
  // scope lingers.
  const beginRemove = useCallback(
    (wrapper: HTMLElement) => {
      if (removeTimersRef.current.has(wrapper)) return;
      const key = wrapper.dataset.jrKey ?? "";
      const timer = setTimeout(() => {
        removeTimersRef.current.delete(wrapper);
        setPinned((prev) => {
          if (!prev.has(wrapper)) return prev;
          const next = new Set(prev);
          next.delete(wrapper);
          return next;
        });
        setRemoving((prev) => {
          if (!prev.has(wrapper)) return prev;
          const next = new Set(prev);
          next.delete(wrapper);
          return next;
        });
        setScopeMenu((prev) => (prev === wrapper ? null : prev));
        onRemoveScope?.(key);
      }, CHIP_OUT_MS);
      removeTimersRef.current.set(wrapper, timer);
      setRemoving((prev) => {
        const next = new Set(prev);
        next.add(wrapper);
        return next;
      });
    },
    [onRemoveScope],
  );

  const beginRemoveAll = useCallback(() => {
    for (const wrapper of pinned) beginRemove(wrapper);
  }, [pinned, beginRemove]);

  useEffect(() => {
    const container = containerRef.current;
    const overlay = overlayRef.current;
    if (!enabled || !spec || !container || !overlay) return;

    let raf = 0;
    const update = () => {
      raf = 0;
      const overlayRect = overlay.getBoundingClientRect();
      const next: DotBox[] = [];
      const domParents: Record<string, string> = {};
      const nodes = container.querySelectorAll<HTMLElement>("[data-jr-key]");
      nodes.forEach((wrapper) => {
        const key = wrapper.dataset.jrKey;
        const element = key ? spec.elements[key] : undefined;
        if (!key || !element) return;

        // DOM-derived containment: display:contents wrappers nest exactly
        // per the rendered tree, unlike spec fields which the model can
        // shape arbitrarily. Key→parent feeds the hover focus.
        const parent =
          wrapper.parentElement?.closest<HTMLElement>("[data-jr-key]");
        const parentKey = parent?.dataset.jrKey;
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
        if (minX === Infinity) {
          const own = wrapper.getBoundingClientRect();
          if (own.width > 0 || own.height > 0) {
            left = own.left;
            top = own.top;
          } else {
            // No measurable box: cascade from the nearest ancestor box
            // (depth × 10px indent) so the dot is always on screen and
            // distinct from its parent's anchor.
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
        }

        next.push({
          key,
          type: element.type,
          family: familyFor(element.type),
          boxless,
          x: left - overlayRect.left,
          y: top - overlayRect.top,
          wrapper,
        });
      });

      setDots(next);
      setParentMap(domParents);
      // Drop pins whose wrapper left the tree (spec change, unmount).
      const alive = new Set(next.map((dot) => dot.wrapper));
      setPinned((prev) => {
        if (prev.size === 0) return prev;
        const kept = [...prev].filter((wrapper) => alive.has(wrapper));
        return kept.length === prev.size ? prev : new Set(kept);
      });
      setScopeMenu((prev) => (prev !== null && !alive.has(prev) ? null : prev));
      setRemoving((prev) => {
        if (prev.size === 0) return prev;
        const kept = [...prev].filter((wrapper) => alive.has(wrapper));
        return kept.length === prev.size ? prev : new Set(kept);
      });
    };

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };

    const content = container.firstElementChild;
    // Construct the observer from the container's realm — inside the device
    // frame the container belongs to the iframe document (R3).
    const frameWindow = container.ownerDocument.defaultView;
    const ResizeObserverCtor = frameWindow
      ? (frameWindow as Window & typeof globalThis).ResizeObserver
      : ResizeObserver;
    const observer = new ResizeObserverCtor(schedule);
    observer.observe(container);
    if (content) observer.observe(content);
    container.addEventListener("scroll", schedule, { passive: true });
    schedule();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      container.removeEventListener("scroll", schedule);
      setHoverKey(null);
      setHoverWrapper(null);
    };
  }, [enabled, spec, containerRef]);

  // Placement: greedy horizontal fan over occupancy spans (not centers) —
  // an unpinned dot occupies its 20px hit span; a pinned chip occupies its
  // estimated text width from the anchor, so everything to its right in the
  // same band shifts right. Pure over anchors + pin state; each iteration
  // strictly increases x (the span being dodged has right > the candidate's
  // left edge, so the candidate lands past its right edge and drops out of
  // the next hit test).
  const layout = useMemo<PlacedDot[]>(() => {
    const spans: Array<{ left: number; right: number; y: number }> = [];
    return dots.map((dot) => {
      const isPinned = pinned.has(dot.wrapper);
      const half = DOT_HIT / 2;
      const width = isPinned ? estimateChipWidth(dot.key, dot.type) : DOT_HIT;
      let x = dot.x;
      for (;;) {
        const left = isPinned ? x : x - half;
        const right = isPinned ? x + width : x + half;
        const hit = spans.filter(
          (s) =>
            Math.abs(s.y - dot.y) < FAN_PITCH &&
            s.left < right &&
            s.right > left,
        );
        if (hit.length === 0) {
          spans.push({ left, right, y: dot.y });
          break;
        }
        // Unpinned: center clears the rightmost span's right edge by half.
        // Pinned: the chip's left edge starts where the span ends.
        x = Math.max(...hit.map((s) => s.right)) + (isPinned ? 0 : half);
      }
      return { ...dot, placeX: x };
    });
  }, [dots, pinned]);

  // X-ray off (or unmount): drop all interaction state. The cleanup runs
  // on the enabled→false transition — setState in cleanup is the accepted
  // form (the measurement effect already resets hover that way), and pins
  // survive spec changes (the measurement pass prunes dead wrappers).
  useEffect(() => {
    if (!enabled) return;
    const timers = removeTimersRef.current;
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
      setPinned(new Set());
      setRemoving(new Set());
      setScopeMenu(null);
      setHoverKey(null);
      setHoverWrapper(null);
    };
  }, [enabled]);

  // Pin/hover highlight = the element's own border: tag the DOM wrapper
  // (`data-xray-pinned`/`data-xray-hover`) and let CSS paint an outline on
  // its child — declarative rules keep it above the family outlines and
  // clipped to border-radius. Attributes die with their wrapper.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const clear = () => {
      container
        .querySelectorAll("[data-xray-pinned], [data-xray-hover]")
        .forEach((el) => {
          el.removeAttribute("data-xray-pinned");
          el.removeAttribute("data-xray-hover");
        });
    };
    clear();
    if (!enabled) return;
    for (const wrapper of pinned) wrapper.setAttribute("data-xray-pinned", "1");
    if (hoverWrapper) hoverWrapper.setAttribute("data-xray-hover", "1");
    return clear;
  }, [enabled, pinned, hoverWrapper, containerRef]);

  // Clicking the canvas must NOT remove chips. Pins/chips are managed by
  // explicit actions only: the dot toggles pin, the chip `+`/`✓` toggles
  // scope, and the chip's X button (or Escape) removes. A scoped chip in
  // particular must stay on the canvas when the user clicks elsewhere.

  // Escape clears pins (capture + preventDefault, so the panel and the
  // playground cascade never see it) — cascade: pins → panel → pick. The
  // panel keeps Escape while the key is aimed at it, so closing the panel
  // is never "wasted" on pins. Once every pin is already mid-exit, Escape
  // falls through to the panel instead of being swallowed again. While a
  // scope dropdown is open, Escape belongs to the menu (Radix), not pins.
  useEffect(() => {
    if (!enabled) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (scopeMenu !== null) return;
      if (pinned.size === 0 || pinned.size === removing.size) return;
      const target = event.target;
      if (target instanceof Element && target.closest("[data-editor-panel]")) {
        return;
      }
      event.preventDefault();
      beginRemoveAll();
    };
    // Realm-correct target: with focus inside the device frame this listener
    // must live on the frame's window, where the Escape key event fires (R3).
    const keyTarget = containerRef.current?.ownerDocument.defaultView ?? window;
    keyTarget.addEventListener("keydown", handleEscape, true);
    return () => keyTarget.removeEventListener("keydown", handleEscape, true);
  }, [enabled, pinned, removing, scopeMenu, beginRemoveAll, containerRef]);

  const handleDotClick = (dot: DotBox) => {
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(dot.wrapper)) next.delete(dot.wrapper);
      else next.add(dot.wrapper);
      return next;
    });
    if (pickArmed && spec) {
      const chain = computeInstanceChain(spec, dot.wrapper);
      onSelect?.(dot.key, chain.length > 0 ? chain : null);
    }
  };

  // Hover focus (key-based, so render never touches the DOM): the hovered
  // key, its ancestors, and its descendants stay lit; the rest fades.
  // Repeat instances share keys, so the whole family stays lit while
  // scanning — the chip and label are separately instance-scoped.
  const focusSet = useMemo(() => {
    if (!hoverKey) return null;
    const set = new Set<string>();
    let cursor: string | undefined = hoverKey;
    while (cursor) {
      set.add(cursor);
      cursor = parentMap[cursor];
    }
    for (const dot of dots) {
      let ancestor: string | undefined = dot.key;
      while (ancestor) {
        if (ancestor === hoverKey) {
          set.add(dot.key);
          break;
        }
        ancestor = parentMap[ancestor];
      }
    }
    return set;
  }, [hoverKey, parentMap, dots]);

  const closeScopeMenu = () => setScopeMenu(null);

  // A key is repeatable when multiple wrappers render it — only those get
  // the scope dropdown (instance-vs-all is meaningless for a singleton,
  // where both targets collapse to the same id).
  const repeatCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const dot of dots) counts[dot.key] = (counts[dot.key] ?? 0) + 1;
    return counts;
  }, [dots]);

  const toggleInstanceScope = (dot: DotBox, instance: InstanceChain | null) => {
    onToggleScope?.(dot.key, instance, false);
    closeScopeMenu();
  };
  const toggleAllScope = (dot: DotBox, instance: InstanceChain | null) => {
    onToggleScope?.(dot.key, instance, true);
    closeScopeMenu();
  };

  return (
    <div
      ref={overlayRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[1000] overflow-hidden"
    >
      {enabled
        ? layout.map((dot, index) => {
            const focused = focusSet === null || focusSet.has(dot.key);
            const isPinned = pinned.has(dot.wrapper);
            const chain = spec ? computeInstanceChain(spec, dot.wrapper) : null;
            const instance = chain && chain.length > 0 ? chain : null;
            const instanceActive =
              chain !== null &&
              scopeIds !== undefined &&
              scopeIds.has(scopeTargetId({ key: dot.key, chain: instance }));
            const allActive =
              chain !== null &&
              scopeIds !== undefined &&
              scopeIds.has(scopeTargetId({ key: dot.key, chain: null }));
            const anyActive = instanceActive || allActive;
            const isRepeatable = (repeatCounts[dot.key] ?? 0) > 1;
            // Chip clears the element's top border entirely (flip below only
            // when there's no room above); the opaque background keeps
            // outlines from bleeding through.
            const chipTop =
              dot.y - CHIP_HEIGHT >= EDGE ? dot.y - CHIP_HEIGHT : dot.y;
            const labelTop =
              dot.y - DOT_HIT / 2 - LABEL_HEIGHT >= EDGE
                ? dot.y - DOT_HIT / 2 - LABEL_HEIGHT
                : dot.y + DOT_HIT / 2;
            return (
              <div
                key={`${index}-${dot.key}`}
                className={`transition-opacity duration-150 ${
                  focused ? "" : "opacity-30"
                }`}
                onMouseEnter={() => {
                  setHoverKey(dot.key);
                  setHoverWrapper(dot.wrapper);
                }}
                onMouseLeave={() => {
                  setHoverWrapper((prev) =>
                    prev === dot.wrapper ? null : prev,
                  );
                  setHoverKey((prev) => (prev === dot.key ? null : prev));
                }}
              >
                {isPinned ? (
                  <div
                    data-xray-chip={dot.key}
                    data-xray-boxless={dot.boxless ? dot.key : undefined}
                    className={`pointer-events-auto absolute flex cursor-pointer items-center gap-1 rounded-md border border-amber-400/70 bg-zinc-950 px-1.5 py-0.5 font-mono text-[10px] leading-3 text-zinc-200 shadow-sm ${
                      removing.has(dot.wrapper)
                        ? "jr-xray-chip-out"
                        : "jr-xray-chip-in"
                    }`}
                    style={{
                      left: dot.placeX,
                      top: chipTop,
                    }}
                    onClick={(event) => {
                      // Clicking the chip (outside the `+`/`✓` trigger) toggles
                      // scope — it does not remove the chip. Only the X button
                      // (and Escape) removes. The dropdown trigger keeps its own
                      // click for the popover.
                      if (
                        event.target instanceof Element &&
                        event.target.closest("[data-xray-scope]")
                      ) {
                        return;
                      }
                      onToggleScope?.(dot.key, instance, false);
                    }}
                  >
                    {(() => {
                      // The `+`/`✓` trigger is on every chip; repeatable keys
                      // wrap it in the instance/all dropdown, singletons
                      // toggle scope directly (instance === template there).
                      const scopeTrigger = (
                        <button
                          type="button"
                          tabIndex={-1}
                          data-xray-scope={dot.key}
                          data-xray-scope-state={anyActive ? "active" : "idle"}
                          aria-label={
                            anyActive
                              ? t("editor.promptScope.active")
                              : t("editor.promptScope.add")
                          }
                          className="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
                          onClick={() => {
                            if (isRepeatable) return; // popover trigger owns it
                            onToggleScope?.(dot.key, instance, false);
                          }}
                        >
                          {anyActive ? (
                            <Check className="size-3" aria-hidden="true" />
                          ) : (
                            <Plus className="size-3" aria-hidden="true" />
                          )}
                        </button>
                      );
                      if (!isRepeatable) return scopeTrigger;
                      return (
                        <Popover
                          open={scopeMenu === dot.wrapper}
                          onOpenChange={(open) => {
                            if (!open)
                              scopeMenuClosedAtRef.current = Date.now();
                            setScopeMenu(open ? dot.wrapper : null);
                          }}
                        >
                          <PopoverTrigger asChild>
                            {scopeTrigger}
                          </PopoverTrigger>
                          <PopoverContent
                            align="start"
                            sideOffset={4}
                            // The chip is a plain div (no PopoverAnchor), so
                            // Radix measures its center once at open; as other
                            // pins shift this chip sideways the measured
                            // anchor no longer matches the trigger and Radix
                            // treats the content as detached → auto-close.
                            // Scope doesn't invalidate a pin, so keep the
                            // content mounted across those re-renders
                            // (outside-click and Escape still dismiss it).
                            className="w-44 p-1"
                          >
                            <button
                              type="button"
                              className={`flex w-full items-center justify-between rounded-sm px-2 py-1 text-left text-xs hover:bg-zinc-800 ${
                                instanceActive
                                  ? "text-amber-300"
                                  : "text-zinc-200"
                              }`}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                toggleInstanceScope(dot, instance);
                              }}
                            >
                              {t("editor.xrayScope.instance")}
                              {instanceActive ? (
                                <Check className="size-3" aria-hidden="true" />
                              ) : null}
                            </button>
                            <button
                              type="button"
                              className={`flex w-full items-center justify-between rounded-sm px-2 py-1 text-left text-xs hover:bg-zinc-800 ${
                                allActive ? "text-amber-300" : "text-zinc-200"
                              }`}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                toggleAllScope(dot, instance);
                              }}
                            >
                              {t("editor.xrayScope.all")}
                              {allActive ? (
                                <Check className="size-3" aria-hidden="true" />
                              ) : null}
                            </button>
                          </PopoverContent>
                        </Popover>
                      );
                    })()}
                    <span className="max-w-[18ch] truncate">{dot.key}</span>
                    <span aria-hidden="true" className="text-zinc-500">
                      ·
                    </span>
                    <span className={dot.family.label}>{dot.type}</span>
                    <button
                      type="button"
                      tabIndex={-1}
                      data-xray-remove={dot.key}
                      aria-label={t("editor.xrayRemove")}
                      className="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-red-300"
                      onClick={(event) => {
                        event.stopPropagation();
                        beginRemove(dot.wrapper);
                      }}
                    >
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      tabIndex={-1}
                      data-xray-dot={dot.key}
                      data-xray-boxless={dot.boxless ? dot.key : undefined}
                      className="pointer-events-auto absolute cursor-pointer select-none rounded-full"
                      style={{
                        width: DOT_HIT,
                        height: DOT_HIT,
                        left: dot.placeX - DOT_HIT / 2,
                        top: dot.y - DOT_HIT / 2,
                      }}
                      onClick={() => handleDotClick(dot)}
                    >
                      <span
                        className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ${
                          dot.boxless
                            ? "border border-amber-400 bg-amber-400/40"
                            : dot.family.dot
                        }`}
                        style={{ width: DOT_VISUAL, height: DOT_VISUAL }}
                      />
                    </button>
                    {hoverWrapper === dot.wrapper ? (
                      <div
                        data-xray-label={dot.key}
                        className="pointer-events-none absolute flex max-w-[160px] items-center gap-1 rounded-md border border-zinc-700 bg-zinc-950/95 px-1.5 py-0.5 font-mono text-[10px] leading-3 text-zinc-200 shadow-sm"
                        style={{ left: dot.placeX - 6, top: labelTop }}
                      >
                        <span className="max-w-[18ch] truncate">{dot.key}</span>
                        <span aria-hidden="true" className="text-zinc-500">
                          ·
                        </span>
                        <span className={dot.family.label}>{dot.type}</span>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            );
          })
        : null}
    </div>
  );
}
