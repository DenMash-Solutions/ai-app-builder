"use client";

import { Button } from "@/components/ui/button";
import type { MoveDirection } from "@/lib/editor";
import {
  MOVE_DIRECTIONS,
  elementMarkers,
  findParentKey,
  saveTemplate,
} from "@/lib/editor";
import { isContainerType, pickerItems } from "@/lib/playground/catalog";
import type { Spec, UIElement } from "@json-render/core";
import {
  ArrowDown,
  ArrowUp,
  BookmarkPlus,
  Copy,
  Group,
  Plus,
  Trash2,
  Ungroup,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { PickerMode } from "./component-picker";
import { ComponentPicker, PICKER_MODES } from "./component-picker";
import { SaveTemplateDialog } from "./save-template-dialog";
import { SpecMarkers } from "./spec-markers";

const ACTION_BUTTON_CLASS = "dark gap-1 px-2 text-xs";

interface StructureTabProps {
  spec: Spec;
  elementKey: string;
  element: UIElement;
  onSelectKey: (key: string) => void;
  onInsert: (parentKey: string, type: string) => void;
  onRemove: (key: string) => void;
  onGroup: (key: string, containerType: string) => void;
  onUnwrap: (key: string) => void;
  onMove: (key: string, direction: MoveDirection) => void;
  onDuplicate: (key: string) => void;
}

/**
 * Structural editing for the selected element: children list with reorder,
 * plus insert/group/ungroup/duplicate/remove — all local spec mutations that
 * commit as history revisions.
 */
export function StructureTab({
  spec,
  elementKey,
  element,
  onSelectKey,
  onInsert,
  onRemove,
  onGroup,
  onUnwrap,
  onMove,
  onDuplicate,
}: StructureTabProps) {
  const t = useTranslations();
  const [picker, setPicker] = useState<PickerMode | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);

  const children = element.children ?? [];
  const ownMarkers = elementMarkers(element);
  const parentKey = findParentKey(spec, elementKey);
  const isRoot = elementKey === spec.root;
  const insertTarget = isContainerType(element.type) ? elementKey : parentKey;
  const innerCount =
    children.length + Object.values(element.slots ?? {}).flat().length;
  const canUnwrap = isRoot
    ? innerCount === 1
    : parentKey !== null && innerCount > 0;

  const handlePick = (type: string) => {
    if (picker === PICKER_MODES.insert) {
      if (insertTarget) onInsert(insertTarget, type);
    } else if (picker === PICKER_MODES.group) {
      onGroup(elementKey, type);
    }
    setPicker(null);
  };

  return (
    <div className="flex flex-col gap-3 px-3 py-3">
      <div className="flex flex-wrap gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={ACTION_BUTTON_CLASS}
          disabled={!insertTarget}
          title={
            insertTarget
              ? t("editor.structure.insertInto", { key: insertTarget })
              : undefined
          }
          onClick={() => setPicker(PICKER_MODES.insert)}
        >
          <Plus className="h-3.5 w-3.5" />
          {t("editor.structure.insert")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={ACTION_BUTTON_CLASS}
          aria-label={t("editor.structure.group")}
          onClick={() => setPicker(PICKER_MODES.group)}
        >
          <Group className="h-3.5 w-3.5" />
          {t("editor.structure.group")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={ACTION_BUTTON_CLASS}
          disabled={!canUnwrap}
          aria-label={t("editor.structure.ungroup")}
          onClick={() => onUnwrap(elementKey)}
        >
          <Ungroup className="h-3.5 w-3.5" />
          {t("editor.structure.ungroup")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={ACTION_BUTTON_CLASS}
          disabled={isRoot}
          aria-label={t("editor.structure.duplicate")}
          onClick={() => onDuplicate(elementKey)}
        >
          <Copy className="h-3.5 w-3.5" />
          {t("editor.structure.duplicate")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={ACTION_BUTTON_CLASS}
          disabled={isRoot}
          aria-label={t("editor.structure.saveTemplate")}
          title={t("editor.structure.saveTemplate")}
          onClick={() => setSaveOpen(true)}
        >
          <BookmarkPlus className="h-3.5 w-3.5" />
          {t("editor.structure.saveTemplate")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={`${ACTION_BUTTON_CLASS} text-destructive hover:text-destructive`}
          disabled={isRoot}
          aria-label={t("editor.structure.remove")}
          onClick={() => onRemove(elementKey)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t("editor.structure.remove")}
        </Button>
      </div>

      {ownMarkers.length > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            {t("editor.markers.section")}
          </span>
          <SpecMarkers markers={ownMarkers} />
        </div>
      )}

      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          {t("editor.structure.children")}
        </span>
        {children.length === 0 && (
          <p className="py-1 text-xs text-zinc-500">
            {t("editor.structure.noChildren")}
          </p>
        )}
        {children.map((childKey, index) => {
          const child = spec.elements[childKey];
          if (!child) return null;
          const childMarkers = elementMarkers(child);
          return (
            <div
              key={childKey}
              className="flex items-center gap-1 rounded-md border border-zinc-800 px-1.5 py-1"
            >
              <button
                type="button"
                onClick={() => onSelectKey(childKey)}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              >
                <span className="rounded border border-zinc-700 px-1 font-mono text-[10px] text-zinc-400">
                  {child.type}
                </span>{" "}
                <span className="truncate font-mono text-[11px] text-zinc-300">
                  {childKey}
                </span>
                <SpecMarkers markers={childMarkers} />
              </button>
              <button
                type="button"
                aria-label={t("editor.structure.moveUp")}
                disabled={index === 0}
                onClick={() => onMove(childKey, MOVE_DIRECTIONS.up)}
                className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-30"
              >
                <ArrowUp className="h-3 w-3" />
              </button>
              <button
                type="button"
                aria-label={t("editor.structure.moveDown")}
                disabled={index === children.length - 1}
                onClick={() => onMove(childKey, MOVE_DIRECTIONS.down)}
                className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-30"
              >
                <ArrowDown className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>

      {saveOpen && (
        <SaveTemplateDialog
          open
          onOpenChange={setSaveOpen}
          onSave={(name) => {
            saveTemplate(name, spec, elementKey);
            setSaveOpen(false);
          }}
        />
      )}

      {picker && (
        <ComponentPicker
          mode={picker}
          open
          items={pickerItems(picker === PICKER_MODES.group)}
          onOpenChange={(open) => {
            if (!open) setPicker(null);
          }}
          onPick={handlePick}
        />
      )}
    </div>
  );
}
