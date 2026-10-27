"use client";

import { useIsVisible, useStateStore } from "@json-render/react";
import { useTranslations } from "next-intl";
import type { UIElement } from "@json-render/core";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  elementStatePaths,
  flattenStateRows,
  splitStateRows,
  type StateRow,
} from "@/lib/editor/state-inspect";

interface StatesTabProps {
  element: UIElement;
}

const SECTION_LABEL_CLASS =
  "text-[11px] font-medium uppercase tracking-wide text-zinc-500";

const GROUP_TRIGGER_CLASS =
  "group h-7 w-full justify-between gap-1.5 px-1 font-mono text-[11px] font-medium uppercase tracking-wide text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200";

function StateRowList({
  rows,
  used,
  usedTip,
}: {
  rows: StateRow[];
  used: boolean;
  usedTip?: string;
}) {
  return (
    <ul className="flex flex-col gap-1">
      {rows.map((row) => (
        <li
          key={row.path}
          data-state-path={row.path}
          data-state-used={used ? "true" : "false"}
          title={used ? usedTip : undefined}
          className="flex items-baseline justify-between gap-2 rounded border border-zinc-800 px-1.5 py-0.5"
        >
          <span
            className={`truncate font-mono text-[11px] ${
              used ? "text-amber-300" : "text-zinc-400"
            }`}
          >
            {row.path}
          </span>
          <span className="shrink-0 truncate font-mono text-[11px] text-zinc-300">
            {row.display}
          </span>
        </li>
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
}: {
  group: "used" | "other";
  label: string;
  count: number;
  rows: StateRow[];
  used: boolean;
  defaultOpen?: boolean;
  usedTip?: string;
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
        <StateRowList rows={rows} used={used} usedTip={usedTip} />
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * States tab (plan 058 step 2): the selected element's state surface —
 * live visibility verdict + its condition, watched paths, and the full
 * runtime-state inspector split into two independent collapsibles (paths
 * used by this element vs. everything else). Override editing lands in
 * step 3; the condition form in step 4.
 */
export function StatesTab({ element }: StatesTabProps) {
  const t = useTranslations();
  const { state } = useStateStore();

  const hasCondition =
    element.visible !== undefined && element.visible !== true;
  const conditionVisible = useIsVisible(
    hasCondition ? element.visible : undefined,
  );
  const watchPaths = Object.keys(element.watch ?? {});
  const rows = flattenStateRows(state);
  const { used, other } = splitStateRows(rows, elementStatePaths(element));

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
            <pre className="overflow-x-auto rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-zinc-300">
              {JSON.stringify(element.visible, null, 2)}
            </pre>
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
        <span className={SECTION_LABEL_CLASS}>
          {t("editor.states.stateTitle")}
          {rows.length > 0 && (
            <span className="ml-1.5 font-normal normal-case text-zinc-600">
              {t("editor.states.stateCount", { count: rows.length })}
            </span>
          )}
        </span>
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
              />
            )}
            {other.length > 0 && (
              <StateGroup
                group="other"
                label={t("editor.states.otherGroup")}
                count={other.length}
                rows={other}
                used={false}
              />
            )}
          </>
        )}
      </section>
    </div>
  );
}
