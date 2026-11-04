/**
 * The availability verdict shared by both publish dialogs (plan 069): the
 * screen go-live dialog and the project publish-site dialog probe the same
 * arbiter (`route_available`) and must describe its answers identically —
 * one definition of what "taken" looks like, not two that can drift.
 *
 * i18n key paths + Tailwind classes only: no hooks, no state, so both
 * dialogs keep owning their own probing and rendering.
 */
export type SlugStatus =
  "invalid" | "reserved" | "checking" | "available" | "taken";

export const SLUG_STATUS_TEXT: Record<SlugStatus, string> = {
  invalid: "publish.invalid",
  reserved: "publish.reserved",
  checking: "publish.checking",
  available: "publish.available",
  taken: "publish.taken",
};

export const SLUG_STATUS_CLASS: Record<SlugStatus, string> = {
  invalid: "text-destructive",
  reserved: "text-destructive",
  checking: "text-muted-foreground",
  available: "text-emerald-600 dark:text-emerald-400",
  taken: "text-destructive",
};

/**
 * The verdict for a typed value, in the order the checks must run: shape
 * first (nothing to ask the arbiter about), then the reserved rung (the
 * registry owns route meaning), then the probe — whose answer is only
 * current while `checked` still matches what is in the box, otherwise the
 * dialog is still "checking".
 */
export function slugStatus(input: {
  value: string;
  valid: boolean;
  reserved: boolean;
  checked: { value: string; available: boolean } | null;
}): SlugStatus {
  if (!input.valid) return "invalid";
  if (input.reserved) return "reserved";
  if (input.checked === null || input.checked.value !== input.value) {
    return "checking";
  }
  return input.checked.available ? "available" : "taken";
}
