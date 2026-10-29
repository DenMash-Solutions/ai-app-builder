"use client";

import { useMemo, useRef, useState } from "react";
import { Pencil, Search, Trash2 } from "lucide-react";
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
  /** Templates mode only — rename (trimmed, non-empty) / delete a row. */
  onRenameTemplate?: (id: string, name: string) => void;
  onDeleteTemplate?: (id: string) => void;
}

export function ComponentPicker({
  mode,
  open,
  items,
  templates = [],
  onOpenChange,
  onPick,
  onPickTemplate,
  onRenameTemplate,
  onDeleteTemplate,
}: ComponentPickerProps) {
  const t = useTranslations();
  // The caller unmounts this dialog on close, so the query resets on reopen.
  const [query, setQuery] = useState("");
  // Inline rename (plan 060 step 3): draft wins over the stored name
  // (`draft ?? name`), Escape cancels without committing.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  // Set on Escape so a follow-up blur (stale closure) cannot commit the draft.
  const skipBlurRef = useRef(false);

  const startRename = (template: ComponentTemplate) => {
    setRenamingId(template.id);
    setDraft(template.name);
    skipBlurRef.current = false;
  };

  const cancelRename = () => {
    setRenamingId(null);
    setDraft(null);
    skipBlurRef.current = false;
  };

  const commitRename = (template: ComponentTemplate) => {
    const next = (draft ?? template.name).trim();
    if (next !== "" && next !== template.name) {
      onRenameTemplate?.(template.id, next);
    }
    cancelRename();
  };

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
      <DialogContent
        data-component-picker
        className="max-w-md"
        onEscapeKeyDown={(event) => {
          // Radix listens for Escape CAPTURE-phase on document — before React's
          // input handler runs — so an inline rename can only be protected
          // here: block the dismiss while renaming (Radix honors
          // defaultPrevented). The input's own handler then clears the draft;
          // a second Escape (no rename active) closes the picker.
          if (renamingId !== null) event.preventDefault();
        }}
      >
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
            ? filteredTemplates.map((template) => {
                const renaming = renamingId === template.id;
                return (
                  <div
                    key={template.id}
                    role="presentation"
                    className="flex items-center gap-1 pr-1"
                  >
                    {renaming ? (
                      <Input
                        autoFocus
                        data-template-rename-input
                        value={draft ?? template.name}
                        aria-label={t("editor.picker.renameTemplate")}
                        className="h-8 flex-1 border-0 bg-accent px-3 font-mono text-xs focus-visible:ring-1"
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") commitRename(template);
                          if (event.key === "Escape") {
                            // Cancel the rename ONLY — the dialog's own Escape
                            // handling was already blocked above, so the picker
                            // stays open.
                            skipBlurRef.current = true;
                            cancelRename();
                          }
                        }}
                        onBlur={() => {
                          if (skipBlurRef.current) {
                            skipBlurRef.current = false;
                            return;
                          }
                          commitRename(template);
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        role="option"
                        aria-selected={false}
                        onClick={() => onPickTemplate?.(template.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent"
                      >
                        <span className="truncate font-mono text-xs font-medium">
                          {template.name}{" "}
                        </span>
                        <span className="ml-auto shrink-0 rounded bg-zinc-500/15 px-1.5 py-0.5 text-[10px] text-zinc-400">
                          {t("editor.picker.templateCount", {
                            count: Object.keys(template.subtree.elements)
                              .length,
                          })}
                        </span>
                      </button>
                    )}
                    {!renaming && (
                      <div className="flex shrink-0 items-center">
                        <button
                          type="button"
                          aria-label={t("editor.picker.renameTemplate")}
                          className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                          onClick={() => startRename(template)}
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          aria-label={t("editor.picker.deleteTemplate")}
                          className="rounded p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-red-400"
                          onClick={() => onDeleteTemplate?.(template.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
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
