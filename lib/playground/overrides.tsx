"use client";

import { createElement, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import type { BaseComponentProps } from "@json-render/react";
import type { ValidationConfig } from "@json-render/core";
import {
  useActions,
  useBoundProp,
  useFieldValidation,
} from "@json-render/react";
import { useTranslations } from "next-intl";
import { Loader2, Moon, Sun } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LUCIDE_ICON_COMPONENTS } from "@/lib/playground/icons";
import { THEMES } from "@/lib/theme";

// D5/D7 (docs/plan/catalog-icons): our catalog extends upstream's Button and
// Input definitions, so we own their renderers too — the stock shadcn
// components know neither the icon props nor the `change` event.

/** Icon beside a button label — plain (no press wiring): the Button's own
 *  click emits press, and a second handler here would fire it twice. */
function buttonIcon(name: unknown): ReactNode {
  if (typeof name !== "string" || name.length === 0) return null;
  const Icon = LUCIDE_ICON_COMPONENTS[name];
  if (!Icon) return null;
  return createElement(Icon, { size: 16, "aria-hidden": true });
}

interface ButtonImplProps extends BaseComponentProps<Record<string, unknown>> {
  /** True while any action is in flight — disables the button and swaps the
   *  leading icon for a spinner (action-loading-states plan). Read from the
   *  ActionProvider by <ButtonWithActionState>; kept a plain prop so this
   *  renderer stays pure and directly testable. */
  busy?: boolean;
}

export function ButtonImpl({
  props,
  emit,
  busy = false,
}: ButtonImplProps): ReactNode {
  const variant = (
    props.variant === "danger"
      ? "destructive"
      : props.variant === "secondary"
        ? "secondary"
        : "default"
  ) as ComponentProps<typeof Button>["variant"];
  const leading = busy
    ? createElement(Loader2, {
        size: 16,
        className: "animate-spin",
        "aria-hidden": true,
      })
    : buttonIcon(props.leadingIcon);
  const trailing = buttonIcon(props.trailingIcon);
  return (
    <Button
      variant={variant}
      disabled={Boolean(props.disabled) || busy}
      aria-busy={busy || undefined}
      onClick={() => emit("press")}
      className={leading || trailing ? "gap-2" : undefined}
    >
      {leading}
      {typeof props.label === "string" ? props.label : null}
      {trailing}
    </Button>
  );
}

/**
 * Context reader for <ButtonImpl>: upstream's ActionProvider tracks which
 * action names are currently executing (`loadingActions`), so every spec
 * button auto-disables while ANY action runs — sync actions add+remove
 * within one batch (no flicker), slow writes (data_mutate, auth) hold the
 * disabled state for their full duration. Enforced app-side so it works no
 * matter what the generated spec omits.
 */
export function ButtonWithActionState(
  ctx: BaseComponentProps<Record<string, unknown>>,
): ReactNode {
  const { loadingActions } = useActions();
  return ButtonImpl({ ...ctx, busy: loadingActions.size > 0 });
}

export function InputImpl({
  props,
  bindings,
  emit,
}: BaseComponentProps<Record<string, unknown>>): ReactNode {
  const [boundValue, setBoundValue] = useBoundProp<unknown>(
    props.value,
    bindings?.value,
  );
  const [localValue, setLocalValue] = useState("");
  const isBound = Boolean(bindings?.value);
  const value = isBound ? (boundValue ?? "") : localValue;
  const setValue = isBound ? setBoundValue : setLocalValue;
  const validateOn =
    typeof props.validateOn === "string" ? props.validateOn : "blur";
  const checks = Array.isArray(props.checks) ? props.checks : undefined;
  const hasValidation = Boolean(bindings?.value && checks?.length);
  const { errors, validate } = useFieldValidation(
    bindings?.value ?? "",
    hasValidation ? ({ checks, validateOn } as ValidationConfig) : undefined,
  );
  const name = typeof props.name === "string" ? props.name : undefined;
  const label = typeof props.label === "string" ? props.label : "";
  const inputValue =
    typeof value === "string" || typeof value === "number" ? value : "";
  return (
    <div className="space-y-2">
      {label.length > 0 ? (
        <label htmlFor={name} className="text-sm font-medium leading-none">
          {label}
        </label>
      ) : null}
      <Input
        id={name}
        name={name}
        type={typeof props.type === "string" ? props.type : "text"}
        placeholder={
          typeof props.placeholder === "string" ? props.placeholder : ""
        }
        value={inputValue}
        onChange={(event) => {
          setValue(event.target.value);
          if (hasValidation && validateOn === "change") validate();
          // D7: upstream stops at set/validate — `change` is what drives
          // search/filter actions ($computed filterItems) per keystroke.
          emit("change");
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") emit("submit");
        }}
        onFocus={() => emit("focus")}
        onBlur={() => {
          if (hasValidation && validateOn === "blur") validate();
          emit("blur");
        }}
      />
      {errors.length > 0 ? (
        <p className="text-sm text-destructive">{errors[0]}</p>
      ) : null}
    </div>
  );
}

// D3 (docs/plan/responsive-ui): the Grid's `columns` prop is the DESKTOP
// target — upstream renders a fixed grid-cols-<n> at every viewport, so a
// 3-column grid squeezes into a 375 px phone. Same 1–6 clamp and gap map as
// upstream; only the column classes become a responsive ladder.

const GRID_COLS_BY_TARGET: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
};
const GRID_GAP_CLASSES = {
  sm: "gap-2",
  md: "gap-3",
  lg: "gap-4",
  xl: "gap-6",
} as const;

interface GridProps {
  columns?: number | null;
  gap?: "sm" | "md" | "lg" | "xl" | null;
  className?: string | null;
}

export function GridImpl({
  props,
  children,
}: BaseComponentProps<GridProps>): ReactNode {
  const n = Math.max(1, Math.min(6, Math.floor(props.columns ?? 1)));
  const cols =
    GRID_COLS_BY_TARGET[n] ?? `grid-cols-1 sm:grid-cols-2 lg:grid-cols-${n}`;
  const gap = GRID_GAP_CLASSES[props.gap ?? "md"] ?? "gap-3";
  return createElement(
    "div",
    { className: cn("grid", cols, gap, props.className ?? undefined) },
    children,
  );
}

// Spec-driven theme (docs/plan/tool-rail-and-spec-theme): the value IS the
// design's theme state — press flips the bound /theme and emits change so
// the model's switch_theme binding can persist the visitor's decision.
// Sun when dark (press → light), Moon when light (press → dark) — the icon
// shows where the click lands, like the app's chrome toggle. The pure
// button is split from the hooked shell so tests can call it directly.
export function ThemeSwitcherButton({
  isDark,
  label,
  onPress,
  className,
  style,
}: {
  isDark: boolean;
  label: string;
  onPress: () => void;
  /** Merged in by withStyleProps — must reach the Button or editor className/style edits vanish. */
  className?: string;
  style?: React.CSSProperties;
}): ReactNode {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      className={className}
      style={style}
      onClick={onPress}
    >
      {isDark ? (
        <Sun aria-hidden="true" className="size-4" />
      ) : (
        <Moon aria-hidden="true" className="size-4" />
      )}
    </Button>
  );
}

export function ThemeSwitcherImpl({
  props,
  bindings,
  emit,
}: BaseComponentProps<Record<string, unknown>>): ReactNode {
  const t = useTranslations();
  const [theme, setThemeValue] = useBoundProp<unknown>(
    props.value,
    bindings?.value,
  );
  const isDark = theme === THEMES.dark;
  return (
    <ThemeSwitcherButton
      isDark={isDark}
      label={t(isDark ? "theme.toggleToLight" : "theme.toggleToDark")}
      onPress={() => {
        setThemeValue(isDark ? THEMES.light : THEMES.dark);
        emit("change");
      }}
    />
  );
}
