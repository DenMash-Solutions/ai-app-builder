"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
import { joinClassTokens, toClassTokens } from "@/lib/editor";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";

const cleaned = (tokens: readonly string[]): string[] =>
  tokens.filter((token) => token.trim() !== "");

/** Only real typing rewrites the draft; Base UI's own resets stay out. */
const USER_INPUT_REASON = "input-change";

interface ClassTokenListProps {
  /** Current className value; parent guards non-string shapes away. */
  value: string | null;
  suggestions: readonly string[];
  disabled?: boolean;
  /** Prop name (e.g. "className") — the row inputs' aria-label. */
  label: string;
  /** Receives the canonical className string (""). */
  onChange: (next: string) => void;
}

export function ClassTokenList({
  value,
  suggestions,
  disabled = false,
  label,
  onChange,
}: ClassTokenListProps) {
  const t = useTranslations();
  const fromProps = toClassTokens(value);
  const [draft, setDraft] = useState<string[] | null>(null);
  const rows = draft ?? fromProps;
  const listRef = useRef<HTMLUListElement | null>(null);
  const focusLastRef = useRef(false);

  useEffect(() => {
    if (!focusLastRef.current) return;
    focusLastRef.current = false;
    // Base UI also injects a hidden input — only target the visible control
    const inputs = listRef.current?.querySelectorAll<HTMLElement>(
      '[data-slot="input-group-control"]',
    );
    inputs?.[inputs.length - 1]?.focus();
  });

  const commit = (next: readonly string[]) => {
    const canonical = joinClassTokens(next);
    if (canonical !== joinClassTokens(fromProps)) onChange(canonical);
  };

  const settle = (next: readonly string[]) => {
    setDraft(cleaned(next).length === next.length ? null : [...next]);
  };

  /** Blur/Enter: drop the row only when it is empty; commit the rest. */
  const commitRow = (index: number) => {
    const kept = rows.filter(
      (token, i) => !(i === index && token.trim() === ""),
    );
    commit(kept);
    settle(kept);
  };

  const addRow = () => {
    commit(rows);
    focusLastRef.current = true;
    setDraft([...cleaned(rows), ""]);
  };

  const removeRow = (index: number) => {
    const kept = rows.filter((_, i) => i !== index);
    commit(kept);
    settle(kept);
  };

  /** Picking a suggestion is explicit — commit right away. */
  const pickRow = (index: number, token: string) => {
    const next = rows.map((existing, i) => (i === index ? token : existing));
    commit(next);
    settle(next);
  };

  return (
    <div className="flex flex-col gap-1">
      <ul ref={listRef} className="flex flex-col gap-1">
        {rows.map((token, index) => (
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
              items={[...suggestions]}
              value={token.trim() !== "" ? token : null}
              inputValue={token}
              onValueChange={(next) => {
                // Escape/cancel asks for null — never commit a clear that way
                if (typeof next === "string") pickRow(index, next);
              }}
              onInputValueChange={(text, details) => {
                if (details.reason !== USER_INPUT_REASON) return;
                setDraft(
                  rows.map((existing, i) => (i === index ? text : existing)),
                );
              }}
            >
              <ComboboxInput
                aria-label={label}
                disabled={disabled}
                className="h-7 min-w-0 flex-1"
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
                  {(suggestion: string) => (
                    <ComboboxItem key={suggestion} value={suggestion}>
                      {suggestion}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={disabled}
              aria-label={t("editor.list.remove", {
                name: token.trim() || t("editor.list.newRow"),
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
          {t("editor.list.addClass")}
        </Button>
      )}
    </div>
  );
}
