"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ComponentTemplate } from "@/lib/editor";
import type { PickerItem } from "@/lib/playground/catalog";

export const PICKER_MODES = {
  insert: "insert",
  group: "group",
  templates: "templates",
} as const;

export type PickerMode = (typeof PICKER_MODES)[keyof typeof PICKER_MODES];

interface ComponentPickerProps {
  mode: PickerMode;
  open: boolean;
  /** Injected by the caller so this component stays a pure catalog view. */
  items: PickerItem[];
  /** Templates mode only — the saved library to list (also injected). */
  templates?: ComponentTemplate[];
  onOpenChange: (open: boolean) => void;
  onPick: (type: string) => void;
  /** Templates mode only — insert the picked template by id. */
  onPickTemplate?: (id: string) => void;
}

export function ComponentPicker({
  mode,
  open,
  items,
  templates = [],
  onOpenChange,
  onPick,
  onPickTemplate,
}: ComponentPickerProps) {
  const t = useTranslations();
  // The caller unmounts this dialog on close, so the query resets on reopen.
  const [query, setQuery] = useState("");

  const isTemplates = mode === PICKER_MODES.templates;
  const needle = query.trim().toLowerCase();

  // Two typed rows — a single union array would defeat narrowing in render.
  const filteredItems = useMemo(() => {
    if (isTemplates) return [];
    if (!needle) return items;
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(needle) ||
        item.description.toLowerCase().includes(needle),
    );
  }, [isTemplates, items, needle]);

  const filteredTemplates = useMemo(() => {
    if (!isTemplates) return [];
    if (!needle) return templates;
    return templates.filter((template) =>
      template.name.toLowerCase().includes(needle),
    );
  }, [isTemplates, needle, templates]);

  const rowCount = isTemplates
    ? filteredTemplates.length
    : filteredItems.length;

  const title = isTemplates
    ? t("editor.picker.templatesTitle")
    : mode === PICKER_MODES.group
      ? t("editor.picker.groupTitle")
      : t("editor.picker.title");

  const description = isTemplates
    ? t("editor.picker.templatesDescription")
    : t("editor.picker.description");

  const emptyHint = isTemplates
    ? templates.length === 0
      ? t("editor.picker.templatesEmpty")
      : t("editor.picker.noMatches")
    : t("editor.picker.noMatches");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-component-picker className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("editor.picker.search")}
            aria-label={t("editor.picker.search")}
            className="pl-8"
          />
        </div>

        <div
          role="listbox"
          aria-label={title}
          className="max-h-72 overflow-y-auto rounded-md border"
        >
          {rowCount === 0 && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              {emptyHint}
            </p>
          )}
          {isTemplates
            ? filteredTemplates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => onPickTemplate?.(template.id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent"
                >
                  <span className="truncate font-mono text-xs font-medium">
                    {template.name}{" "}
                  </span>
                  <span className="ml-auto shrink-0 rounded bg-zinc-500/15 px-1.5 py-0.5 text-[10px] text-zinc-400">
                    {t("editor.picker.templateCount", {
                      count: Object.keys(template.subtree.elements).length,
                    })}
                  </span>
                </button>
              ))
            : filteredItems.map((item) => (
                <button
                  key={item.name}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => onPick(item.name)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent"
                >
                  {/* Trailing space keeps text runs word-separated for assistive
                      tech and text-based matchers; trimmed visually at the line
                      end, so layout is unaffected. */}
                  <span className="font-mono text-xs font-medium">
                    {item.name}{" "}
                  </span>
                  {item.container && (
                    <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-400">
                      {t("editor.picker.containerChip")}
                    </span>
                  )}
                  {item.description && (
                    <span className="truncate text-xs text-muted-foreground">
                      {item.description}
                    </span>
                  )}
                </button>
              ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
