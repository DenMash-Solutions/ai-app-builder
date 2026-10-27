"use client";

import { useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import type { VisibilityCondition } from "@json-render/core";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CONDITION_OPERATOR_ORDER,
  CONDITION_OPERATORS,
  serializeCondition,
  VALUELESS_CONDITION_OPERATORS,
  type ConditionContainer,
  type ConditionOperator,
  type ConditionRow,
} from "@/lib/editor/condition-form";

interface ConditionFormProps {
  /** Committed rows — the source of truth, parsed from `element.visible`. */
  rows: readonly ConditionRow[];
  /** Container the rows came from (`$and` wrapper vs. implicit array). */
  container: ConditionContainer;
  /** Current committed condition, used to suppress no-op commits. */
  visible: VisibilityCondition | undefined;
  /** Suggested state paths offered through the native `datalist`. */
  suggestions: readonly string[];
  onChange: (next: VisibilityCondition) => void;
}

const INPUT_CLASS =
  "h-6 min-w-0 rounded border border-zinc-700 bg-zinc-900 px-1 font-mono text-[11px] text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none";

const draftKey = (index: number, field: "path" | "value") =>
  `${index}:${field}`;

/**
 * Structured editor for an element's `visible` condition — one row per
 * `$state` comparison, operator dropdown, native-datalist path suggestions.
 * Text fields follow the controlled-draft rule: display is
 * `draft ?? serialize(rows)`, commits clear the draft first and only write
 * when serialization differs from the committed condition (lesson
 * `controlled-input-drafts.md`).
 */
export function ConditionForm({
  rows,
  container,
  visible,
  suggestions,
  onChange,
}: ConditionFormProps) {
  const t = useTranslations();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const baseText = (index: number, field: "path" | "value"): string => {
    const row = rows[index];
    return field === "path" ? row.path : row.text;
  };

  const currentText = (index: number, field: "path" | "value"): string => {
    const draft = drafts[draftKey(index, field)];
    return draft !== undefined ? draft : baseText(index, field);
  };

  const applyRows = (next: ConditionRow[]): boolean => {
    const result = serializeCondition(next, container);
    if (!result.ok || result.value === undefined) return false;
    if (JSON.stringify(result.value) === JSON.stringify(visible)) return false;
    onChange(result.value);
    return true;
  };

  const commit = (index: number, field: "path" | "value") => {
    const key = draftKey(index, field);
    const draft = drafts[key];
    if (draft === undefined) return;
    const nextDrafts = { ...drafts };
    delete nextDrafts[key];
    setDrafts(nextDrafts);
    if (draft === baseText(index, field)) return;
    applyRows(
      rows.map((row, i) =>
        i === index
          ? field === "path"
            ? { ...row, path: draft }
            : { ...row, text: draft }
          : row,
      ),
    );
  };

  const cancel = (index: number, field: "path" | "value") => {
    const key = draftKey(index, field);
    if (!(key in drafts)) return;
    const nextDrafts = { ...drafts };
    delete nextDrafts[key];
    setDrafts(nextDrafts);
  };

  const changeOperator = (index: number, operator: ConditionOperator) => {
    const valueless = VALUELESS_CONDITION_OPERATORS.includes(operator);
    applyRows(
      rows.map((row, i) => {
        if (i !== index) return row;
        // The valueless ops carry no operand, so their kind is `none`; moving
        // onto a comparison needs a coercible kind (and back to `none` when
        // leaving one) or the switch serializes to the very same condition.
        const kind = valueless
          ? "none"
          : row.kind === "none"
            ? "auto"
            : row.kind;
        return { ...row, operator, kind };
      }),
    );
  };

  const removeRow = (index: number) => {
    setDrafts({});
    applyRows(rows.filter((_, i) => i !== index));
  };

  const addRow = () => {
    setDrafts({});
    // Seed from the last row: a new condition almost always targets the same
    // state path with another operator/value, and serializing a full row keeps
    // the button responsive (an empty path would serialize to nothing).
    const last = rows[rows.length - 1];
    applyRows([
      ...rows,
      {
        path: last.path,
        operator: CONDITION_OPERATORS.eq,
        text: last.text,
        kind: "auto",
      },
    ]);
  };

  const onKeyDown =
    (index: number, field: "path" | "value") =>
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commit(index, field);
      }
      if (event.key === "Escape") {
        event.preventDefault();
        cancel(index, field);
      }
    };

  const listId = "condition-path-suggestions";

  return (
    <div className="flex flex-col gap-1.5" data-condition-form>
      <datalist id={listId}>
        {suggestions.map((path) => (
          <option key={path} value={path} />
        ))}
      </datalist>
      <ul className="flex flex-col gap-1">
        {rows.map((row, index) => {
          const valueless = VALUELESS_CONDITION_OPERATORS.includes(
            row.operator,
          );
          return (
            <li
              key={index}
              data-condition-row={index}
              className="flex items-center gap-1.5"
            >
              <input
                data-condition-path={index}
                list={listId}
                value={currentText(index, "path")}
                placeholder={t("editor.states.conditionPath")}
                aria-label={t("editor.states.conditionPath")}
                onChange={(event) =>
                  setDrafts({
                    ...drafts,
                    [draftKey(index, "path")]: event.target.value,
                  })
                }
                onBlur={() => commit(index, "path")}
                onKeyDown={onKeyDown(index, "path")}
                className={INPUT_CLASS}
              />
              <Select
                value={row.operator}
                onValueChange={(next) =>
                  changeOperator(index, next as ConditionOperator)
                }
              >
                <SelectTrigger
                  data-condition-operator={index}
                  aria-label={t("editor.states.conditionOperator")}
                  size="sm"
                  className="h-6 w-[4.75rem] shrink-0 gap-1 rounded border-zinc-700 bg-zinc-900 px-1.5 font-mono text-[11px] text-zinc-300 hover:bg-zinc-800 [&_svg]:size-3"
                >
                  {/* SelectValue registers the value node Radix positions the
                      popup against — a plain span leaves it at (0,0). */}
                  <span className="truncate">
                    <SelectValue>{row.operator}</SelectValue>
                  </span>
                </SelectTrigger>
                <SelectContent className="dark">
                  {CONDITION_OPERATOR_ORDER.map((operator) => (
                    <SelectItem
                      key={operator}
                      value={operator}
                      className="font-mono text-[11px]"
                    >
                      {operator}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!valueless && (
                <input
                  data-condition-value={index}
                  value={currentText(index, "value")}
                  placeholder={t("editor.states.conditionValue")}
                  aria-label={t("editor.states.conditionValue")}
                  onChange={(event) =>
                    setDrafts({
                      ...drafts,
                      [draftKey(index, "value")]: event.target.value,
                    })
                  }
                  onBlur={() => commit(index, "value")}
                  onKeyDown={onKeyDown(index, "value")}
                  className={INPUT_CLASS}
                />
              )}
              {rows.length > 1 && (
                <button
                  type="button"
                  data-condition-remove={index}
                  aria-label={t("editor.states.removeConditionRow")}
                  onClick={() => removeRow(index)}
                  className="shrink-0 rounded p-0.5 text-zinc-500 transition hover:text-zinc-200"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-condition-add
          onClick={addRow}
          className="h-6 gap-1 px-1.5 text-[11px] font-normal normal-case text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
        >
          <Plus className="h-3 w-3" aria-hidden="true" />
          {t("editor.states.addConditionRow")}
        </Button>
      </div>
    </div>
  );
}
