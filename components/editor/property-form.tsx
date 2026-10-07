"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import {
  PROP_FIELD_KINDS,
  PROP_FIELD_VARIANTS,
  parseStyleText,
  serializeStyleText,
} from "@/lib/editor";
import type { PropField } from "@/lib/editor";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClassTokenList } from "./class-token-list";
import { StylePropList } from "./style-prop-list";

interface PropertyFormProps {
  fields: PropField[];
  values: Record<string, unknown>;
  /** Props whose value is an expression we cannot round-trip (e.g. $cond). */
  readonlyFields?: readonly string[];
  /** Class tokens offered as suggestions for the className field. */
  classSuggestions?: readonly string[];
  onChange: (prop: string, value: unknown) => void;
}

const INPUT_CLASS = "h-7 w-full rounded-md text-xs";

/** Structured list editors — null means the value shape needs the text fallback. */
const LIST_KINDS = {
  classNameTokens: "classNameTokens",
  stylePairs: "stylePairs",
} as const;

type ListKind = (typeof LIST_KINDS)[keyof typeof LIST_KINDS];

function getListKind(field: PropField, value: unknown): ListKind | null {
  if (field.variant === PROP_FIELD_VARIANTS.className) {
    return value === null || value === undefined || typeof value === "string"
      ? LIST_KINDS.classNameTokens
      : null;
  }
  if (field.variant === PROP_FIELD_VARIANTS.style) {
    return value === null ||
      value === undefined ||
      (typeof value === "object" && !Array.isArray(value))
      ? LIST_KINDS.stylePairs
      : null;
  }
  return null;
}

/** Collapsed trigger summary — the current value, truncated by CSS. */
function listSummary(kind: ListKind, value: unknown): string {
  if (kind === LIST_KINDS.classNameTokens) {
    return typeof value === "string" ? value : "";
  }
  return serializeStyleText(value);
}

export function PropertyForm({
  fields,
  values,
  readonlyFields,
  classSuggestions = [],
  onChange,
}: PropertyFormProps) {
  const t = useTranslations();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  if (fields.length === 0) {
    return (
      <p className="px-3 py-4 text-center text-xs text-zinc-500">
        {t("editor.noEditableProps")}
      </p>
    );
  }

  const currentText = (field: PropField): string => {
    const draft = drafts[field.name];
    if (draft !== undefined) return draft;
    if (field.kind === PROP_FIELD_KINDS.record) {
      return serializeStyleText(values[field.name]);
    }
    const value = values[field.name];
    if (value !== null && typeof value === "object") {
      // Unresolvable expressions (binding without an instance scope, $cond
      // previews) — show the raw JSON instead of "[object Object]".
      return JSON.stringify(value);
    }
    return String(value ?? "");
  };

  const commitText = (field: PropField) => {
    const draft = drafts[field.name];
    if (draft === undefined) return;
    const nextDrafts = { ...drafts };
    delete nextDrafts[field.name];
    setDrafts(nextDrafts);

    const raw = draft.trim();
    if (field.kind === PROP_FIELD_KINDS.number) {
      const parsed = Number(raw);
      if (raw === "" || Number.isNaN(parsed)) return;
      if (parsed === values[field.name]) return;
      onChange(field.name, parsed);
      return;
    }
    if (field.kind === PROP_FIELD_KINDS.record) {
      const parsed = parseStyleText(draft);
      if (parsed === null) {
        if (raw === "" && (values[field.name] ?? null) !== null) {
          onChange(field.name, null);
        }
        return;
      }
      if (
        JSON.stringify(parsed) === JSON.stringify(values[field.name] ?? null)
      ) {
        return;
      }
      onChange(field.name, parsed);
      return;
    }
    if (draft === String(values[field.name] ?? "")) return;
    onChange(field.name, draft);
  };

  const enumValue = (field: PropField): string => {
    const value = values[field.name];
    if (typeof value === "string" && field.options?.includes(value)) {
      return value;
    }
    return "";
  };

  return (
    <div className="flex flex-col gap-2.5 px-3 py-3">
      {fields.map((field) => {
        const isReadonly = readonlyFields?.includes(field.name) ?? false;
        const listKind = getListKind(field, values[field.name]);
        if (listKind !== null) {
          const summary = listSummary(listKind, values[field.name]);
          return (
            <Collapsible key={field.name} className="flex flex-col gap-1.5">
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  title={isReadonly ? t("editor.instance.readonly") : undefined}
                  className="group h-7 w-full justify-start gap-1.5 px-1 font-mono text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                >
                  <ChevronRight
                    className="h-3 w-3 shrink-0 transition-transform group-data-[state=open]:rotate-90"
                    aria-hidden="true"
                  />
                  <span>{field.name}</span>
                  {summary !== "" && (
                    <span className="min-w-0 flex-1 truncate text-right font-sans text-[11px] font-normal text-zinc-600">
                      {summary}
                    </span>
                  )}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="flex flex-col gap-1.5 pl-4">
                {listKind === LIST_KINDS.classNameTokens ? (
                  <ClassTokenList
                    value={(values[field.name] ?? null) as string | null}
                    suggestions={classSuggestions}
                    disabled={isReadonly}
                    label={field.name}
                    onChange={(next) => onChange(field.name, next)}
                  />
                ) : (
                  <StylePropList
                    value={
                      (values[field.name] ?? null) as Record<
                        string,
                        string | number
                      > | null
                    }
                    disabled={isReadonly}
                    label={field.name}
                    onChange={(next) => onChange(field.name, next)}
                  />
                )}
              </CollapsibleContent>
            </Collapsible>
          );
        }
        return (
          <label
            key={field.name}
            className="flex flex-col gap-1.5 text-xs"
            title={isReadonly ? t("editor.instance.readonly") : undefined}
          >
            <span className="font-mono text-zinc-400">{field.name}</span>
            {field.kind === PROP_FIELD_KINDS.boolean && (
              <Checkbox
                checked={values[field.name] === true}
                disabled={isReadonly}
                onCheckedChange={(checked) =>
                  onChange(field.name, checked === true)
                }
                className="self-start"
              />
            )}
            {field.kind === PROP_FIELD_KINDS.enum && (
              <Select
                value={enumValue(field) || undefined}
                onValueChange={(next) => onChange(field.name, next || null)}
                disabled={isReadonly}
              >
                <SelectTrigger className={INPUT_CLASS}>
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent className="dark">
                  {field.options?.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {(field.kind === PROP_FIELD_KINDS.string ||
              field.kind === PROP_FIELD_KINDS.number ||
              field.kind === PROP_FIELD_KINDS.record) && (
              <Input
                type={
                  field.kind === PROP_FIELD_KINDS.number ? "number" : "text"
                }
                value={currentText(field)}
                disabled={isReadonly}
                onChange={(event) =>
                  setDrafts({ ...drafts, [field.name]: event.target.value })
                }
                onBlur={() => commitText(field)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitText(field);
                  }
                }}
                className={INPUT_CLASS}
              />
            )}
          </label>
        );
      })}
    </div>
  );
}
