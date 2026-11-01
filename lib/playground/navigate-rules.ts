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
- A listed \`route\` is that screen's URL contract (e.g. \`{id}\` → the record id segment). navigate BUILDS the path from it when you pass the declared params — routes themselves are configured in the workspace, never in the spec.
- The screen marked \`(home)\` is the project's front door: navigating to it pushes the bare project URL — it is not a special ref, just bind it like any other listed screen.
- Bind only to user-triggered events (a button or icon's press) — never to load/change, and never on a non-interactive element.
- In edit mode keep every other binding as-is; you may retarget an existing navigate's params.screen to a listed ref, or drop the binding if its target is gone.
- Shared values live under \`/session\`: every sibling screen seeds the SAME subtree, so write it with {"action": "setState", "params": {"statePath": "/session/<key>", "value": <value>}} and read it with { "$state": "/session/<key>"}. Keep screen-local state (drafts, pagination, open dialogs) outside \`/session\` — it resets on every screen change.
`;

/**
 * Validate the client's `context.screens`: an array of
 * `{ref, name, route?, home?}` pairs (route/home since plan 065, decision
 * 14). Anything malformed is dropped (a missing block only withholds the
 * teaching — it must never fail a generation). Returns `[]` when there is
 * nothing to list.
 */
export function parseScreens(value: unknown): ScreenListing[] {
  if (!Array.isArray(value)) return [];
  const screens: ScreenListing[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const { ref, name, route, home } = item as {
      ref?: unknown;
      name?: unknown;
      route?: unknown;
      home?: unknown;
    };
    if (typeof ref !== "string" || ref.trim() === "") continue;
    screens.push({
      ref,
      name: typeof name === "string" && name.trim() !== "" ? name : ref,
      ...(typeof route === "string" && route.trim() !== ""
        ? { route: route.trim() }
        : {}),
      ...(home === true ? { home: true } : {}),
    });
    if (screens.length >= MAX_LISTED_SCREENS) break;
  }
  return screens;
}

/**
 * The user-prompt block listing valid targets (decision 3; extended 065
 * decision 14 with each target's route contract and the home marker).
 * Empty list → empty string (the route pairs this with NAVIGATE_RULES so
 * neither ships alone).
 */
export function siblingScreensBlock(screens: readonly ScreenListing[]): string {
  if (screens.length === 0) return "";
  const lines = screens.map((screen) => {
    const label = screen.name === screen.ref ? "" : ` — ${screen.name}`;
    const route = screen.route ? ` (route: ${screen.route})` : "";
    const home = screen.home ? " (home)" : "";
    return `- "${screen.ref}"${label}${route}${home}`;
  });
  return `\n\nSibling screens of this project (the ONLY valid \`navigate\` targets — params.screen must be exactly one of these refs):\n${lines.join("\n")}`;
}
