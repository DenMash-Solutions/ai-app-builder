"use client";

import type { Spec, UIElement } from "@json-render/core";
import { cn } from "cn";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Plus,
  Redo2,
  Undo2,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type TouchEvent } from "react";
import { playgroundCatalog } from "@/lib/playground/catalog";
import {
  analyzePropBinding,
  getEditableFields,
  getClassSuggestions,
  resolveInstanceScope,
} from "@/lib/editor";
import type { InstanceChain, MoveDirection } from "@/lib/editor";
import { ActionTiles } from "./action-tiles";
import { PropertyForm } from "./property-form";
import { StructureTab } from "./structure-tab";

export const PANEL_TABS = {
  properties: "properties",
  structure: "structure",
  actions: "actions",
} as const;

export type PanelTab = (typeof PANEL_TABS)[keyof typeof PANEL_TABS];

const PANEL_TAB_ORDER: readonly PanelTab[] = [
  PANEL_TABS.properties,
  PANEL_TABS.structure,
  PANEL_TABS.actions,
];

const TAB_LABEL_KEYS: Record<PanelTab, string> = {
  properties: "editor.tabs.properties",
  structure: "editor.tabs.structure",
  actions: "editor.tabs.actions",
};

const HEADER_BUTTON_CLASS =
  "rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-30";

const TAB_BASE_CLASS =
  "px-3 py-1.5 text-xs transition-colors border-b-2 -mb-px";

function componentPropsSchema(type: string): unknown {
  const components = playgroundCatalog.data.components as unknown as Record<
    string,
    { props: unknown } | undefined
  >;
  return components[type]?.props;
}
/** Live ≥768px check — the drawer docks right on desktop, bottom sheet on mobile. */
const DESKTOP_QUERY = "(min-width: 768px)";

interface EditPanelProps {
  spec: Spec;
  elementKey: string;
  element: UIElement;
  /** Key path from spec.root to elementKey (inclusive) for the breadcrumb. */
  ancestors: string[];
  /** Repeat scopes of the picked instance; null = template-level selection. */
  instanceChain: InstanceChain | null;
  /** Active tab — lifted to the parent so remounts (key changes) keep it. */
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  /** True while the exit animation plays — the parent keeps the panel
   * mounted (with live props) until `onExited` fires. */
  closing: boolean;
  onExited: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClose: () => void;
  onSelectKey: (key: string) => void;
  onPropChange: (prop: string, value: unknown, dataPath: string | null) => void;
  onAction: (instruction: string, label: string) => void;
  onInsert: (parentKey: string, type: string) => void;
  onRemove: (key: string) => void;
  onGroup: (key: string, containerType: string) => void;
  onUnwrap: (key: string) => void;
  onMove: (key: string, direction: MoveDirection) => void;
  onDuplicate: (key: string) => void;
  /** True when this element is in the prompt scope (main-prompt chips). */
  inPromptScope: boolean;
  onTogglePromptScope: () => void;
  /** Rendered instances of the selected key; > 1 enables the template toggle. */
  promptScopeInstanceCount: number;
  /** True when the key's shared template is in the prompt scope. */
  inPromptScopeTemplate: boolean;
  onTogglePromptScopeTemplate: () => void;
}

export function EditPanel({
  spec,
  elementKey,
  element,
  ancestors,
  instanceChain,
  tab,
  onTabChange,
  closing,
  onExited,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClose,
  onSelectKey,
  onPropChange,
  onAction,
  onInsert,
  onRemove,
  onGroup,
  onUnwrap,
  onMove,
  onDuplicate,
  inPromptScope,
  onTogglePromptScope,
  promptScopeInstanceCount,
  inPromptScopeTemplate,
  onTogglePromptScopeTemplate,
}: EditPanelProps) {
  const t = useTranslations();
  const [isDesktop, setIsDesktop] = useState(
    () =>
      typeof window !== "undefined" && window.matchMedia(DESKTOP_QUERY).matches,
  );
  // Mobile sheet only: swipe-up grows to full screen, swipe-down collapses.
  // Reset lives in the matchMedia subscription callback (never in the effect
  // body — react-hooks/set-state-in-effect).
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY);
    const update = () => {
      setIsDesktop(query.matches);
      if (query.matches) setExpanded(false);
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const fields = getEditableFields(componentPropsSchema(element.type));
  const crumbs = ancestors.slice(0, -1);

  // Instance-scoped editing: every field resolves against the picked chain —
  // bindings display (and write) the instance's state path, literals edit the
  // shared template, expressions we cannot round-trip render read-only.
  const state = spec.state ?? {};
  const chain = instanceChain ?? [];
  const scope = resolveInstanceScope(spec, state, chain);
  const rawProps = (element.props ?? {}) as Record<string, unknown>;
  const values: Record<string, unknown> = {};
  const readonlyFields: string[] = [];
  for (const field of fields) {
    const binding = analyzePropBinding(
      spec,
      state,
      chain,
      rawProps[field.name],
    );
    values[field.name] = binding.displayValue;
    if (binding.readonly) readonlyFields.push(field.name);
  }

  const handlePropChange = (prop: string, value: unknown) => {
    const binding = analyzePropBinding(spec, state, chain, rawProps[prop]);
    onPropChange(prop, value, binding.dataPath);
  };

  // Escape closes the panel — unless a nested layer (component picker) already
  // handled the key (Radix marks it defaultPrevented while closing).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Enter/exit both resize the panel's own layout box with WAAPI (width on
  // desktop, height on mobile) instead of transforms: the box moves on the
  // flex line, so the stage resizes frame-by-frame in sync — no blank strip,
  // no snap-back when a transform releases, no layout jump when React
  // mounts/unmounts the panel. The exit cleanup records the in-flight size so
  // a reopen mid-exit grows back from where it was. Exit completion is
  // `animation.finished`; the timeout below stays as fallback where WAAPI
  // never runs (e.g. hidden tab). Refs are synced in an effect so both
  // signals stay correct across parent re-renders during the exit.
  const panelRef = useRef<HTMLDivElement | null>(null);
  const collapsedRef = useRef<number | null>(null);
  const onExitedRef = useRef(onExited);
  const exitedRef = useRef(false);
  // Captures the sheet's height before a user-initiated expand/collapse so
  // the WAAPI effect below can animate from the old size to the new one.
  const sheetHeightRef = useRef<number | null>(null);
  const setSheetExpanded = (next: boolean): void => {
    const el = panelRef.current;
    sheetHeightRef.current = el ? el.offsetHeight : null;
    setExpanded(next);
  };
  useEffect(() => {
    onExitedRef.current = onExited;
  });
  useEffect(() => {
    if (closing) return;
    const el = panelRef.current;
    if (!el || typeof el.animate !== "function") return;
    const frames = isDesktop
      ? [
          { width: `${collapsedRef.current ?? 0}px` },
          { width: `${el.offsetWidth}px` },
        ]
      : [
          { height: `${collapsedRef.current ?? 0}px` },
          { height: `${el.offsetHeight}px` },
        ];
    const animation = el.animate(frames, {
      duration: 200,
      easing: "cubic-bezier(0, 0, 0.2, 1)",
    });
    return () => animation.cancel();
  }, [closing, isDesktop]);
  useEffect(() => {
    if (!closing) return;
    const el = panelRef.current;
    if (!el || typeof el.animate !== "function") return;
    const frames = isDesktop
      ? [{ width: `${el.offsetWidth}px` }, { width: "0px" }]
      : [{ height: `${el.offsetHeight}px` }, { height: "0px" }];
    const animation = el.animate(frames, {
      duration: 200,
      easing: "cubic-bezier(0.4, 0, 1, 1)",
      fill: "forwards",
    });
    let aborted = false;
    animation.finished
      .then(() => {
        if (aborted || exitedRef.current) return;
        exitedRef.current = true;
        onExitedRef.current();
      })
      .catch(() => {
        // canceled on reopen or unmount
      });
    return () => {
      aborted = true;
      collapsedRef.current = isDesktop ? el.offsetWidth : el.offsetHeight;
      animation.cancel();
    };
  }, [closing, isDesktop]);
  useEffect(() => {
    if (!closing) {
      exitedRef.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      if (exitedRef.current) return;
      exitedRef.current = true;
      onExitedRef.current();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [closing]);

  // Expand/collapse animates the sheet's height with WAAPI (same layout-driven
  // approach as enter/exit): the class switch is instant, so keyframes
  // interpolate from the captured pre-toggle height to the new offsetHeight.
  // Inline max-height is neutralized during the animation so the 80dvh cap
  // cannot clamp the full-screen start frame on the way down.
  useEffect(() => {
    const el = panelRef.current;
    if (!el || isDesktop) return;
    const from = sheetHeightRef.current;
    sheetHeightRef.current = null;
    if (from === null) return;
    const to = el.offsetHeight;
    if (from === to || typeof el.animate !== "function") return;
    el.style.maxHeight = "none";
    const animation = el.animate(
      [{ height: `${from}px` }, { height: `${to}px` }],
      { duration: 250, easing: "cubic-bezier(0, 0, 0.2, 1)" },
    );
    let aborted = false;
    animation.finished
      .then(() => {
        if (!aborted) el.style.maxHeight = "";
      })
      .catch(() => {
        // canceled on re-toggle or unmount
      });
    return () => {
      aborted = true;
      animation.cancel();
      el.style.maxHeight = "";
    };
  }, [expanded, isDesktop]);

  // Mobile bottom sheet: swipe down to collapse (full screen → default) or
  // dismiss (default → closed), swipe up to grow to full screen — only from a
  // scroll position of the panel body at its top, so list scrolling never
  // moves or closes the panel.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  const handleTouchStart = (event: TouchEvent) => {
    if (isDesktop) return;
    const body = bodyRef.current;
    if (body && body.contains(event.target as Node) && body.scrollTop > 0) {
      return;
    }
    touchStartYRef.current = event.touches[0].clientY;
  };

  const handleTouchEnd = (event: TouchEvent) => {
    const startY = touchStartYRef.current;
    touchStartYRef.current = null;
    if (startY === null) return;
    const delta = event.changedTouches[0].clientY - startY;
    if (delta > 80) {
      if (expanded) setSheetExpanded(false);
      else onClose();
    } else if (delta < -80) {
      setSheetExpanded(true);
    }
  };

  return (
    <div
      ref={panelRef}
      data-editor-panel
      role="dialog"
      aria-label={t("editor.panelTitle")}
      data-state={closing ? "closed" : "open"}
      className={cn(
        // Fixed-dark island: scope token vars so light theme never inverts it
        "dark relative z-40 flex shrink-0 flex-col overflow-hidden border-zinc-800 bg-zinc-950 text-zinc-100 shadow-2xl",
        isDesktop
          ? "h-full w-[448px] border-l"
          : expanded
            ? "h-[100dvh] w-full border-t"
            : "max-h-[80dvh] w-full rounded-t-xl border-t",
      )}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <span className="rounded-md border border-amber-400/60 bg-amber-400/10 px-1.5 py-0.5 font-mono text-[11px] text-amber-300">
          {element.type}
        </span>
        <span className="truncate font-mono text-[11px] text-zinc-500">
          {elementKey}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            aria-label={t("editor.undo")}
            disabled={!canUndo}
            onClick={onUndo}
            className={HEADER_BUTTON_CLASS}
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label={t("editor.redo")}
            disabled={!canRedo}
            onClick={onRedo}
            className={HEADER_BUTTON_CLASS}
          >
            <Redo2 className="h-3.5 w-3.5" />
          </button>
          {!isDesktop && (
            <button
              type="button"
              aria-label={
                expanded ? t("editor.sheet.collapse") : t("editor.sheet.expand")
              }
              onClick={() => setSheetExpanded(!expanded)}
              className={HEADER_BUTTON_CLASS}
            >
              {expanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronUp className="h-3.5 w-3.5" />
              )}
            </button>
          )}
          <button
            type="button"
            aria-label={t("editor.close")}
            onClick={onClose}
            className={HEADER_BUTTON_CLASS}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <button
        type="button"
        data-testid="prompt-scope-toggle"
        aria-pressed={inPromptScope}
        onClick={onTogglePromptScope}
        className={`flex w-full shrink-0 items-center gap-1.5 border-b border-zinc-800 px-3 py-1.5 text-left text-xs transition-colors hover:bg-zinc-800/60 ${
          inPromptScope ? "bg-emerald-400/10 text-emerald-300" : "text-zinc-300"
        }`}
      >
        {inPromptScope ? (
          <Check className="h-3.5 w-3.5" />
        ) : (
          <Plus className="h-3.5 w-3.5" />
        )}
        {t(
          inPromptScope
            ? "editor.promptScope.active"
            : "editor.promptScope.add",
        )}
      </button>

      {promptScopeInstanceCount > 1 && (
        <button
          type="button"
          data-testid="prompt-scope-template-toggle"
          aria-pressed={inPromptScopeTemplate}
          onClick={onTogglePromptScopeTemplate}
          className={`flex w-full shrink-0 items-center gap-1.5 border-b border-zinc-800 px-3 py-1.5 text-left text-xs transition-colors hover:bg-zinc-800/60 ${
            inPromptScopeTemplate
              ? "bg-emerald-400/10 text-emerald-300"
              : "text-zinc-300"
          }`}
        >
          {inPromptScopeTemplate ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          {t(
            inPromptScopeTemplate
              ? "editor.promptScope.activeAll"
              : "editor.promptScope.addAll",
            { count: promptScopeInstanceCount },
          )}
        </button>
      )}

      {scope && (
        <div
          data-testid="instance-scope"
          className="shrink-0 border-b border-zinc-800 px-3 py-1.5 font-mono text-[11px] text-emerald-300/90"
        >
          {t("editor.instance.scope", {
            index: scope.itemIndex + 1,
            count: scope.count,
            path: scope.basePath,
          })}
        </div>
      )}

      {crumbs.length > 0 && (
        <nav
          aria-label={t("editor.structure.breadcrumb")}
          className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-zinc-800 px-3 py-1"
        >
          {crumbs.map((key) => (
            <span key={key} className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => onSelectKey(key)}
                className="font-mono text-[11px] text-zinc-500 transition-colors hover:text-amber-300"
              >
                {key}
              </button>
              <ChevronRight className="h-3 w-3 shrink-0 text-zinc-600" />
            </span>
          ))}
        </nav>
      )}

      <div
        className="flex shrink-0 border-b border-zinc-800 px-1"
        role="tablist"
      >
        {PANEL_TAB_ORDER.map((tabKey) => (
          <button
            key={tabKey}
            type="button"
            role="tab"
            aria-selected={tab === tabKey}
            onClick={() => onTabChange(tabKey)}
            className={`${TAB_BASE_CLASS} ${
              tab === tabKey
                ? "border-amber-400 text-amber-300"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {t(TAB_LABEL_KEYS[tabKey])}
          </button>
        ))}
      </div>

      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto">
        {tab === PANEL_TABS.properties && (
          <PropertyForm
            key={elementKey}
            fields={fields}
            values={values}
            readonlyFields={readonlyFields}
            classSuggestions={getClassSuggestions(spec)}
            onChange={handlePropChange}
          />
        )}
        {tab === PANEL_TABS.structure && (
          <>
            {scope && (
              <p className="px-3 pt-2 text-[11px] text-zinc-500">
                {t("editor.instance.structureNote", { count: scope.count })}
              </p>
            )}
            <StructureTab
              key={elementKey}
              spec={spec}
              elementKey={elementKey}
              element={element}
              onSelectKey={onSelectKey}
              onInsert={onInsert}
              onRemove={onRemove}
              onGroup={onGroup}
              onUnwrap={onUnwrap}
              onMove={onMove}
              onDuplicate={onDuplicate}
            />
          </>
        )}
        {tab === PANEL_TABS.actions && (
          <ActionTiles key={elementKey} onAction={onAction} />
        )}
      </div>
    </div>
  );
}
