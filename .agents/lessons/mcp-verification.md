# Browser Verification via MCP: Stale Frames and Dark Islands

> **Lesson source**: Live structure-action testing through `chrome-devtools` MCP — full-page screenshots showed pre-click state while the app had already updated, and editor UI rendered invisible (white-on-white) in light theme.

## Problem Description

- **Stale compositor frames**: `take_screenshot` (full page) can capture the last composited frame, not the current DOM — clicking, then screenshotting, may show the *before* state and send you debugging a non-existent bug
- **Theme-dependent visibility**: components styled with theme tokens (`bg-background`, `text-foreground`) follow the page theme; deliberately dark UI islands (editor panel, action buttons) turn white-on-white when the page is in light mode
- Both failures are "rendering lies" — they invalidate visual verification while `DOM` reads remain correct

## Solution Steps

### 1. Ground truth = script, not pixels

```js
// prefer, in order:
// 1. evaluate_script — reads the actual DOM/spec/localStorage
await evaluate(() => ({ children: spec.elements[spec.root].children, head }));
// 2. element screenshot (uid-targeted) — forces a fresh composite of that node
// 3. full-page screenshot — LAST resort; verify freshness by toggling DOM first
```

- After any click, confirm state with `evaluate_script` **before** trusting a screenshot
- If a screenshot must be used, change something observable (e.g. add a border via script) to prove the frame is fresh

### 2. Scope dark tokens per element (`.dark` class on the island)

```tsx
// ✅ token vars resolve dark regardless of page theme
const ACTION_BUTTON_CLASS = "dark gap-1 px-2 text-xs";

// ❌ token classes follow the <html> theme — invisible in light mode
const ACTION_BUTTON_CLASS = "gap-1 px-2 text-xs";
```

- `globals.css` defines `.dark` as a **selector-scoped var provider**, so any subtree can opt in with `class="dark"`
- Alternative: hardcode zinc/amber utility classes (as `PropertyForm`/`ActionTiles` do) — fine, but the `dark` class is smaller when the subtree already uses token utilities

## Verification

- Element screenshot in **both** themes (toggle theme, re-shoot) — a dark island must stay dark
- After a UI action: `evaluate_script` assertion first, screenshot second

## Prevention Strategies

- Never debug from a full-page MCP screenshot alone — cross-check with `evaluate_script`
- Fixed-theme panels/toolbars: add `dark` (or explicit zinc classes) so page theme cannot invert them
- Window resize via MCP may not apply — read `window.innerWidth` before assuming a breakpoint

## Memory Triggers

- Screenshot contradicts the state you just changed → stale frame; switch to `evaluate_script`
- Component invisible in one theme → does it use theme tokens? Add `dark` or explicit colors
- About to trust any MCP screenshot → did I verify the frame is fresh?
