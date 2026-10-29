/**
 * NAVIGATE_RULES (plan 061 step 2) — the prompt section that teaches the
 * declared `navigate` action and the per-request sibling-screen list.
 *
 * Both halves ship TOGETHER (decision 3): the system rules are appended only
 * when the request carries a non-empty sibling list, and the list only ships
 * when the screen being created/edited sits in a project bucket that has
 * other screens. On a fresh project the action is simply not offered — an
 * unresolvable ref silently no-ops, so the model is never invited to guess.
 *
 * Shape precedent: DATA_SOURCE_RULES (system prompt, appended by the route).
 * The `{ref, name}` pairs ride in `context.screens` (client-computed, the
 * only side that can see this device's history) and are appended to the user
 * prompt by the route.
 */
import type { ScreenListing } from "@/lib/projects/screen-nav";

export type { ScreenListing };

/**
 * Cap on listed siblings: beyond this the prompt grows faster than the
 * picker's usefulness (the editor tile offers the full set regardless).
 */
export const MAX_LISTED_SCREENS = 12;

export const NAVIGATE_RULES = `
NAVIGATION RULES

A spec can jump to a sibling screen of the same project with the declared \`navigate\` action:

  "on": { "press": { "action": "navigate", "params": { "screen": "<ref>" } } }

- Bind it ONLY when the user prompt carries a "Sibling screens" list — the refs listed there are the only valid params.screen values. An unknown ref silently does nothing.
- Use a ref exactly as listed (a screen id). Never write a path, never invent a ref, never bind navigate without a listed target.
- Bind only to user-triggered events (a button or icon's press) — never to load/change, and never on a non-interactive element.
- In edit mode keep every other binding as-is; you may retarget an existing navigate's params.screen to a listed ref, or drop the binding if its target is gone.
`;

/**
 * Validate the client's `context.screens`: an array of `{ref, name}` pairs.
 * Anything malformed is dropped (a missing block only withholds the teaching
 * — it must never fail a generation). Returns `[]` when there is nothing to
 * list.
 */
export function parseScreens(value: unknown): ScreenListing[] {
  if (!Array.isArray(value)) return [];
  const screens: ScreenListing[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const { ref, name } = item as { ref?: unknown; name?: unknown };
    if (typeof ref !== "string" || ref.trim() === "") continue;
    screens.push({
      ref,
      name: typeof name === "string" && name.trim() !== "" ? name : ref,
    });
    if (screens.length >= MAX_LISTED_SCREENS) break;
  }
  return screens;
}

/**
 * The user-prompt block listing valid targets (decision 3). Empty list →
 * empty string (the route pairs this with NAVIGATE_RULES so neither ships
 * alone).
 */
export function siblingScreensBlock(screens: readonly ScreenListing[]): string {
  if (screens.length === 0) return "";
  const lines = screens.map(
    (screen) =>
      `- "${screen.ref}"${screen.name === screen.ref ? "" : ` — ${screen.name}`}`,
  );
  return `\n\nSibling screens of this project (the ONLY valid \`navigate\` targets — params.screen must be exactly one of these refs):\n${lines.join("\n")}`;
}
