"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
import {
  COMMON_STYLE_KEYS,
  rowsToStyleRecord,
  styleRecordToRows,
} from "@/lib/editor";
import type { StyleRow } from "@/lib/editor";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";

interface StylePropListProps {
  /** Current style value; parent guards non-object shapes away. */
  value: Record<string, string | number> | null;
  disabled?: boolean;
  /** Prop name (e.g. "style") — the row inputs' aria-label prefix. */
  label: string;
  /** Receives the record, or null when the last row is removed. */
  onChange: (next: Record<string, string | number> | null) => void;
}

const isComplete = (row: StyleRow): boolean =>
  row.key.trim() !== "" && row.value.trim() !== "";
const hasEmpty = (rows: readonly StyleRow[]): boolean =>
  rows.some((row) => !isComplete(row));

/** Only real typing rewrites the draft; Base UI's own resets stay out. */
const USER_INPUT_REASON = "input-change";

export function StylePropList({
  value,
  disabled = false,
  label,
  onChange,
}: StylePropListProps) {
  const t = useTranslations();
  const fromProps = styleRecordToRows(value);
  const [draft, setDraft] = useState<StyleRow[] | null>(null);
  const rows = draft ?? fromProps;
  const listRef = useRef<HTMLUListElement | null>(null);
  const focusLastRef = useRef(false);

  useEffect(() => {
    if (!focusLastRef.current) return;
    focusLastRef.current = false;
    // Focus the new row's key field; skip Base UI's injected hidden input
    const inputs = listRef.current?.querySelectorAll<HTMLElement>(
      '[data-slot="input-group-control"]',
    );
    inputs?.[inputs.length - 1]?.focus();
  });

  const commit = (next: readonly StyleRow[]) => {
    const completed = next.filter(isComplete);
    const record = completed.length > 0 ? rowsToStyleRecord(completed) : null;
    if (JSON.stringify(record) !== JSON.stringify(value ?? null)) {
      onChange(record);
    }
  };

  const settle = (next: readonly StyleRow[]) => {
    setDraft(hasEmpty(next) ? [...next] : null);
  };

  /**
   * Blur/Enter: a row missing either side cannot become a declaration —
   * drop it; complete rows commit. Focus moving within the same row (key →
   * value) is handled by the li-level relatedTarget guard and never lands
   * here.
   */
  const commitRow = (index: number) => {
    const kept = rows.filter((_, i) => i !== index || isComplete(rows[i]));
    commit(kept);
    settle(kept);
  };

  const addRow = () => {
    commit(rows);
    focusLastRef.current = true;
    setDraft([...rows.filter(isComplete), { key: "", value: "" }]);
  };

  const removeRow = (index: number) => {
    const kept = rows.filter((_, i) => i !== index);
    commit(kept);
    settle(kept);
  };

  const updateRow = (index: number, patch: Partial<StyleRow>) => {
    setDraft(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  /** Picking a key suggestion is explicit — commit right away. */
  const pickKey = (index: number, key: string) => {
    const next = rows.map((row, i) => (i === index ? { ...row, key } : row));
    commit(next);
    settle(next);
  };

  return (
    <div className="flex flex-col gap-1">
      <ul ref={listRef} className="flex flex-col gap-1">
        {rows.map((row, index) => (
          <li
            key={index}
            className="flex items-center gap-1"
            onBlur={(event) => {
              if (
                event.relatedTarget &&
                event.currentTarget.contains(event.relatedTarget)
              ) {
                return;
              }
              commitRow(index);
            }}
          >
            <Combobox
              items={[...COMMON_STYLE_KEYS]}
              value={row.key.trim() !== "" ? row.key : null}
              inputValue={row.key}
              onValueChange={(next) => {
                // Escape/cancel asks for null — never commit a clear that way
                if (typeof next === "string") pickKey(index, next);
              }}
              onInputValueChange={(text, details) => {
                if (details.reason !== USER_INPUT_REASON) return;
                updateRow(index, { key: text });
              }}
            >
              <ComboboxInput
                aria-label={`${label} key`}
                disabled={disabled}
                placeholder={t("editor.list.styleKeyPlaceholder")}
                className="h-7 w-32 shrink-0"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitRow(index);
                  }
                }}
              />
              <ComboboxContent className="dark">
                <ComboboxEmpty>{t("editor.list.noMatches")}</ComboboxEmpty>
                <ComboboxList>
                  {(key: string) => (
                    <ComboboxItem key={key} value={key}>
                      {key}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
            <Input
              type="text"
              aria-label={`${label} value`}
              placeholder={t("editor.list.styleValuePlaceholder")}
              value={row.value}
              disabled={disabled}
              onChange={(event) =>
                updateRow(index, { value: event.target.value })
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitRow(index);
                }
              }}
              className="h-7 min-w-0 flex-1"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={disabled}
              aria-label={t("editor.list.remove", {
                name:
                  row.key.trim() || row.value.trim() || t("editor.list.newRow"),
              })}
              onClick={() => removeRow(index)}
              className="text-zinc-400 hover:text-red-300"
            >
              <X aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>
      {!disabled && (
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={addRow}
          className="w-full justify-center border-dashed text-zinc-400"
        >
          <Plus aria-hidden="true" />
          {t("editor.list.addStyleProp")}
        </Button>
      )}
    </div>
  );
}
