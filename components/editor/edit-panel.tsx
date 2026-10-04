"use client";

import { useState } from "react";
import type { UIElement } from "@json-render/core";
import { Redo2, Undo2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { playgroundCatalog } from "@/lib/playground/catalog";
import { getEditableFields } from "@/lib/editor";
import { ActionTiles } from "./action-tiles";
import { PropertyForm } from "./property-form";

const PANEL_TABS = {
  properties: "properties",
  actions: "actions",
} as const;

type PanelTab = (typeof PANEL_TABS)[keyof typeof PANEL_TABS];

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

interface EditPanelProps {
  elementKey: string;
  element: UIElement;
  position: { top: number; left: number };
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClose: () => void;
  onPropChange: (prop: string, value: unknown) => void;
  onAction: (instruction: string, label: string) => void;
}

export function EditPanel({
  elementKey,
  element,
  position,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClose,
  onPropChange,
  onAction,
}: EditPanelProps) {
  const t = useTranslations();
  const [tab, setTab] = useState<PanelTab>(PANEL_TABS.properties);
  const fields = getEditableFields(componentPropsSchema(element.type));

  return (
    <div
      data-editor-panel
      aria-label={t("editor.panelTitle")}
      className="absolute z-20 w-80 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 text-zinc-100 shadow-2xl"
      style={{ top: position.top, left: position.left }}
    >
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
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

      <div className="flex border-b border-zinc-800 px-1" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === PANEL_TABS.properties}
          onClick={() => setTab(PANEL_TABS.properties)}
          className={`${TAB_BASE_CLASS} ${
            tab === PANEL_TABS.properties
              ? "border-amber-400 text-amber-300"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          {t("editor.tabs.properties")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === PANEL_TABS.actions}
          onClick={() => setTab(PANEL_TABS.actions)}
          className={`${TAB_BASE_CLASS} ${
            tab === PANEL_TABS.actions
              ? "border-amber-400 text-amber-300"
              : "border-transparent text-zinc-400 hover:text-zinc-200"
          }`}
        >
          {t("editor.tabs.actions")}
        </button>
      </div>

      {tab === PANEL_TABS.properties ? (
        <PropertyForm
          fields={fields}
          values={(element.props ?? {}) as Record<string, unknown>}
          onChange={onPropChange}
        />
      ) : (
        <ActionTiles onAction={onAction} />
      )}
    </div>
  );
}
