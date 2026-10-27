"use client";

import { useIsVisible, useStateStore } from "@json-render/react";
import { useTranslations } from "next-intl";
import type { UIElement, VisibilityCondition } from "@json-render/core";
import { ChevronRight, Pencil, RotateCcw } from "lucide-react";
import { useSyncExternalStore, useRef, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  elementStatePaths,
  flattenStateRows,
  isQueryStatusPath,
  splitStateRows,
  statusSelectOptions,
  type StateRow,
} from "@/lib/editor/state-inspect";
import {
  parseCondition,
  suggestedStatePaths,
} from "@/lib/editor/condition-form";
import { ConditionForm } from "./condition-form";
import { parseStateInput, stateOverrides } from "@/lib/editor/state-overrides";

interface StatesTabProps {
  element: UIElement;
  /** Spec the element belongs to — feeds the condition path suggestions. */
  spec: unknown;
  /** Writes an edited `visible` back into the spec (undoable revision). */
  onConditionChange: (next: VisibilityCondition) => void;
}

const SECTION_LABEL_CLASS =
  "text-[11px] font-medium uppercase tracking-wide text-zinc-500";

const GROUP_TRIGGER_CLASS =
  "group h-7 w-full justify-between gap-1.5 px-1 font-mono text-[11px] font-medium uppercase tracking-wide text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200";

/** Initial text of the inline editor: raw for strings, JSON for the rest. */
function toEditText(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? "";
}

function StateRowItem({
  row,
  used,
  usedTip,
  overridden,
}: {
  row: StateRow;
  used: boolean;
  usedTip?: string;
  overridden: boolean;
}) {
  const t = useTranslations();
  const { get, set } = useStateStore();
  const [draft, setDraft] = useState<string | null>(null);
  const cancelRef = useRef(false);
  const isStatus = isQueryStatusPath(row.path);

  const applyValue = (next: unknown) => {
    const current = get(row.path);
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    // capture the ORIGINAL before the first write, then apply
    stateOverrides.record(row.path, current);
    set(row.path, next);
  };

  const commit = () => {
    if (draft === null) return;
    const raw = draft;
    setDraft(null);
    applyValue(parseStateInput(raw));
  };

  const cancel = () => {
    cancelRef.current = true;
    setDraft(null);
  };

  // Query lifecycle: known value domain → select instead of free text.
  const currentRaw = get(row.path);
  const currentValue =
    typeof currentRaw === "string"
      ? currentRaw
      : currentRaw === undefined
        ? ""
        : String(currentRaw);
  const options = statusSelectOptions(currentValue);

  return (
    <li
      data-state-path={row.path}
      data-state-used={used ? "true" : "false"}
      data-state-overridden={overridden ? "true" : "false"}
      title={
        overridden
          ? t("editor.states.overriddenTip")
          : used
            ? usedTip
            : undefined
      }
      className={`group flex items-center justify-between gap-2 rounded border px-1.5 py-0.5 ${
        overridden ? "border-violet-800/70 bg-violet-950/30" : "border-zinc-800"
      }`}
    >
      <span
        className={`truncate font-mono text-[11px] ${
          used ? "text-amber-300" : "text-zinc-400"
        }`}
      >
        {row.path}
      </span>
      {isStatus ? (
        <Select
          value={currentValue || undefined}
          onValueChange={(next) => applyValue(next)}
        >
          <SelectTrigger
            data-state-status-select={row.path}
            aria-label={t("editor.states.editValue")}
            size="sm"
            className="h-6 max-w-[9.5rem] gap-1 rounded border-zinc-700 bg-zinc-900 px-1.5 font-mono text-[11px] text-zinc-300 hover:bg-zinc-800 [&_svg]:size-3"
          >
            {/* SelectValue is required: it registers the value node Radix's
                item-aligned positioning reads — without it the popup is laid
                out at (0,0) instead of next to the trigger. */}
            <span className="truncate">
              <SelectValue placeholder="—">{currentValue}</SelectValue>
            </span>
          </SelectTrigger>
          <SelectContent className="dark">
            {options.map((option) => (
              <SelectItem
                key={option}
                value={option}
                className="font-mono text-[11px]"
              >
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : draft !== null ? (
        <input
          data-state-edit-input={row.path}
          value={draft}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (cancelRef.current) {
              cancelRef.current = false;
              return;
            }
            commit();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              cancel();
            }
          }}
          className="h-6 w-full min-w-0 rounded border border-zinc-700 bg-zinc-900 px-1 font-mono text-[11px] text-zinc-100 focus:border-zinc-500 focus:outline-none"
        />
      ) : (
        <>
          <span className="shrink-0 truncate font-mono text-[11px] text-zinc-300">
            {row.display}
          </span>
          <button
            type="button"
            data-state-edit={row.path}
            aria-label={t("editor.states.editValue")}
            onClick={() => setDraft(toEditText(get(row.path)))}
            className="shrink-0 rounded p-0.5 text-zinc-500 opacity-0 transition hover:text-zinc-200 focus-visible:opacity-100 group-hover:opacity-100"
          >
            <Pencil className="h-3 w-3" aria-hidden="true" />
          </button>
        </>
      )}
    </li>
  );
}

function StateRowList({
  rows,
  used,
  usedTip,
  overriddenPaths,
}: {
  rows: StateRow[];
  used: boolean;
  usedTip?: string;
  overriddenPaths: Readonly<Record<string, unknown>>;
}) {
  return (
    <ul className="flex flex-col gap-1">
      {rows.map((row) => (
        <StateRowItem
          key={row.path}
          row={row}
          used={used}
          usedTip={usedTip}
          overridden={row.path in overriddenPaths}
        />
      ))}
    </ul>
  );
}

function StateGroup({
  group,
  label,
  count,
  rows,
  used,
  defaultOpen,
  usedTip,
  overriddenPaths,
}: {
  group: "used" | "other";
  label: string;
  count: number;
  rows: StateRow[];
  used: boolean;
  defaultOpen?: boolean;
  usedTip?: string;
  overriddenPaths: Readonly<Record<string, unknown>>;
}) {
  const t = useTranslations();
  return (
    <Collapsible
      data-state-group={group}
      defaultOpen={defaultOpen}
      className="flex flex-col gap-1"
    >
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={GROUP_TRIGGER_CLASS}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <ChevronRight
              className="h-3 w-3 shrink-0 transition-transform group-data-[state=open]:rotate-90"
              aria-hidden="true"
            />
            <span className="truncate">{label}</span>
          </span>
          <span className="font-normal normal-case text-zinc-500">
            {t("editor.states.stateCount", { count })}
          </span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pl-4">
        <StateRowList
          rows={rows}
          used={used}
          usedTip={usedTip}
          overriddenPaths={overriddenPaths}
        />
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * States tab (plan 058 steps 2–3): the selected element's state surface —
 * live visibility verdict + its condition, watched paths, and the
 * runtime-state inspector split into two collapsibles (used vs. other).
 * State values are editable inline; edits are session-only overrides
 * (tracked by `stateOverrides`, restorable via "Reset overrides"), never
 * written to `spec.state`. The condition form lands in step 4.
 */
export function StatesTab({
  element,
  spec,
  onConditionChange,
}: StatesTabProps) {
  const t = useTranslations();
  const { state, set } = useStateStore();
  const overrideSnapshot = useSyncExternalStore(
    stateOverrides.subscribe,
    stateOverrides.getSnapshot,
    stateOverrides.getSnapshot,
  );
  const overrideCount = Object.keys(overrideSnapshot).length;

  const hasCondition =
    element.visible !== undefined && element.visible !== true;
  const condition = parseCondition(element.visible);
  const conditionVisible = useIsVisible(
    hasCondition ? element.visible : undefined,
  );
  const suggestions = useMemo(() => suggestedStatePaths(spec), [spec]);
  const watchPaths = Object.keys(element.watch ?? {});
  const rows = flattenStateRows(state);
  const { used, other } = splitStateRows(rows, elementStatePaths(element));

  const resetOverrides = () => {
    for (const [path, original] of stateOverrides.clear()) {
      set(path, original);
    }
  };

  return (
    <div className="flex flex-col gap-4 px-3 py-3">
      <section className="flex flex-col gap-1.5">
        <span className={SECTION_LABEL_CLASS}>
          {t("editor.states.visibility")}
        </span>
        {hasCondition ? (
          <>
            <span
              data-state-verdict={conditionVisible ? "shown" : "hidden"}
              className={`w-fit rounded border px-1.5 py-0.5 text-[11px] ${
                conditionVisible
                  ? "border-emerald-800/70 bg-emerald-950/50 text-emerald-300"
                  : "border-zinc-700 bg-zinc-900 text-zinc-400"
              }`}
            >
              {conditionVisible
                ? t("editor.states.shownNow")
                : t("editor.states.hiddenNow")}
            </span>
            {condition.supported ? (
              <ConditionForm
                rows={condition.rows}
                container={condition.container}
                visible={element.visible}
                suggestions={suggestions}
                onChange={onConditionChange}
              />
            ) : (
              <pre
                data-condition-raw
                title={t("editor.states.rawConditionTip")}
                className="overflow-x-auto rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-zinc-300"
              >
                {JSON.stringify(element.visible, null, 2)}
              </pre>
            )}
          </>
        ) : (
          <p className="text-xs text-zinc-500">
            {t("editor.states.alwaysShown")}
          </p>
        )}
      </section>

      {watchPaths.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <span className={SECTION_LABEL_CLASS}>
            {t("editor.states.watch")}
          </span>
          <ul className="flex flex-col gap-1">
            {watchPaths.map((path) => (
              <li
                key={path}
                className="rounded border border-sky-900/70 bg-sky-950/40 px-1.5 py-0.5 font-mono text-[11px] text-sky-300"
              >
                {path}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className={SECTION_LABEL_CLASS}>
            {t("editor.states.stateTitle")}
            {rows.length > 0 && (
              <span className="ml-1.5 font-normal normal-case text-zinc-600">
                {t("editor.states.stateCount", { count: rows.length })}
              </span>
            )}
          </span>
          {overrideCount > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-state-reset-overrides
              onClick={resetOverrides}
              className="h-6 gap-1 px-1.5 text-[11px] font-normal normal-case text-violet-300 hover:bg-violet-950/40 hover:text-violet-200"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              {t("editor.states.resetOverrides", { count: overrideCount })}
            </Button>
          )}
        </div>
        {rows.length === 0 && used.length === 0 ? (
          <p className="text-xs text-zinc-500">{t("editor.states.noState")}</p>
        ) : (
          <>
            {used.length > 0 && (
              <StateGroup
                group="used"
                label={t("editor.states.usedGroup")}
                count={used.length}
                rows={used}
                used
                defaultOpen
                usedTip={t("editor.states.usedTip")}
                overriddenPaths={overrideSnapshot}
              />
            )}
            {other.length > 0 && (
              <StateGroup
                group="other"
                label={t("editor.states.otherGroup")}
                count={other.length}
                rows={other}
                used={false}
                overriddenPaths={overrideSnapshot}
              />
            )}
          </>
        )}
      </section>
    </div>
  );
}
