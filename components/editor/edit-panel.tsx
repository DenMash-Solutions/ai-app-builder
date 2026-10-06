"use client";

import type { Spec, UIElement } from "@json-render/core";
import { ChevronRight, Redo2, Undo2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { playgroundCatalog } from "@/lib/playground/catalog";
import {
  analyzePropBinding,
  getEditableFields,
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

interface EditPanelProps {
  spec: Spec;
  elementKey: string;
  element: UIElement;
  /** Key path from spec.root to elementKey (inclusive) for the breadcrumb. */
  ancestors: string[];
  /** Repeat scopes of the picked instance; null = template-level selection. */
  instanceChain: InstanceChain | null;
  position: { top: number; left: number };
  /** Active tab — lifted to the parent so remounts (key changes) keep it. */
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
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
}

export function EditPanel({
  spec,
  elementKey,
  element,
  ancestors,
  instanceChain,
  position,
  tab,
  onTabChange,
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
}: EditPanelProps) {
  const t = useTranslations();
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

  return (
    <div
      data-editor-panel
      aria-label={t("editor.panelTitle")}
      className="absolute z-40 w-80 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 text-zinc-100 shadow-2xl"
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

      {scope && (
        <div
          data-testid="instance-scope"
          className="border-b border-zinc-800 px-3 py-1.5 font-mono text-[11px] text-emerald-300/90"
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
          className="flex items-center gap-0.5 overflow-x-auto border-b border-zinc-800 px-3 py-1"
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

      <div className="flex border-b border-zinc-800 px-1" role="tablist">
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

      {tab === PANEL_TABS.properties && (
        <PropertyForm
          fields={fields}
          values={values}
          readonlyFields={readonlyFields}
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
      {tab === PANEL_TABS.actions && <ActionTiles onAction={onAction} />}
    </div>
  );
}
