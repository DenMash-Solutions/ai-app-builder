"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  PROP_FIELD_KINDS,
  parseStyleText,
  serializeStyleText,
} from "@/lib/editor";
import type { PropField } from "@/lib/editor";

interface PropertyFormProps {
  fields: PropField[];
  values: Record<string, unknown>;
  onChange: (prop: string, value: unknown) => void;
}

const CONTROL_CLASS =
  "h-7 w-32 rounded-md border border-zinc-700 bg-zinc-900 px-2 text-xs text-zinc-100 outline-none focus:border-amber-400";

export function PropertyForm({ fields, values, onChange }: PropertyFormProps) {
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
    return String(values[field.name] ?? "");
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
      {fields.map((field) => (
        <label
          key={field.name}
          className="flex items-center justify-between gap-3 text-xs"
        >
          <span className="font-mono text-zinc-400">{field.name}</span>
          {field.kind === PROP_FIELD_KINDS.boolean && (
            <input
              type="checkbox"
              checked={values[field.name] === true}
              onChange={(event) => onChange(field.name, event.target.checked)}
              className="h-4 w-4 accent-amber-400"
            />
          )}
          {field.kind === PROP_FIELD_KINDS.enum && (
            <select
              value={enumValue(field)}
              onChange={(event) =>
                onChange(field.name, event.target.value || null)
              }
              className={CONTROL_CLASS}
            >
              {enumValue(field) === "" && <option value="">—</option>}
              {field.options?.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          )}
          {(field.kind === PROP_FIELD_KINDS.string ||
            field.kind === PROP_FIELD_KINDS.number ||
            field.kind === PROP_FIELD_KINDS.record) && (
            <input
              type={field.kind === PROP_FIELD_KINDS.number ? "number" : "text"}
              value={currentText(field)}
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
              className={CONTROL_CLASS}
            />
          )}
        </label>
      ))}
    </div>
  );
}
