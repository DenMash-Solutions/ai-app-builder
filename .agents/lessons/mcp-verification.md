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

### 3. Long calls fail differently (protocolTimeout, recursion, timers)

- **`evaluate_script` can time out** (`Runtime.callFunctionOn timed out`) when navigation + wait + scan are chained in one call — run **stepwise**: `navigate_page` → one small evaluate (readiness) → one evaluate (the actual check). Each call gets its own timeout budget.
- **CSS rule scans must recurse grouping rules** — top-level `sheet.cssRules` iteration reports "not found" for everything inside `@layer`/`@media`:

  ```js
  const scan = (rules) => {
    for (const rule of rules) {
      if (rule.selectorText?.includes("bg-card")) hits.semantic = true;
      if (rule.cssRules) scan(rule.cssRules); // ← grouping rules
    }
  };
  for (const sheet of document.styleSheets) { try { scan(sheet.cssRules); } catch {} }
  ```

- **No top-level timers in the `execute` sandbox** (`setTimeout`/`setInterval` throw `ReferenceError`) — page-context timers inside `evaluate_script` (`new Promise((r) => setTimeout(r, ms))`) work fine; sequence slow steps across separate tool calls instead.
- **`initScript` persists until cleared** — a fetch/network block installed via `navigate_page({ initScript })` stays armed for later navigations; re-navigate *without* the script and re-read the flag to confirm it cleared.
- **Dispatch → query in the same synchronous block races React** (plan 059) — firing a synthetic event (`dispatchEvent`) and immediately `querySelector`-ing for its rendered output reads the DOM *before* React flushes; the miss looks like "the fix didn't work". `await` a tick (`sleep(100)` or two rAFs) between stimulus and read.
- **A probe result can carry an earlier phase's fingerprint** — the badge that "appeared after the switch" measured `390×4610` (the *pre*-switch frame): state left over from the previous dispatch, not proof the current step worked. Phase-tag probes (reset first, or assert a value that can only come from the current step).

## Verification

- Element screenshot in **both** themes (toggle theme, re-shoot) — a dark island must stay dark
- After a UI action: `evaluate_script` assertion first, screenshot second

## Prevention Strategies

- Never debug from a full-page MCP screenshot alone — cross-check with `evaluate_script`
- Fixed-theme panels/toolbars: add `dark` (or explicit zinc classes) so page theme cannot invert them
- Window resize via MCP may not apply — read `window.innerWidth` before assuming a breakpoint
- Scripted check that mixes navigation + waits + DOM scan → split into stepwise calls; recurse grouping rules when scanning stylesheets

## Memory Triggers

- Screenshot contradicts the state you just changed → stale frame; switch to `evaluate_script`
- Component invisible in one theme → does it use theme tokens? Add `dark` or explicit colors
- About to trust any MCP screenshot → did I verify the frame is fresh?
- `Runtime.callFunctionOn timed out` → chain too long; run stepwise
- Rule "missing" from stylesheet scan → did I recurse into `@layer` grouping rules?
- `ReferenceError: Unknown identifier 'setTimeout'` in execute → timers only live inside `evaluate_script`
- A check behaves as if never installed → is a previous `initScript` still armed?
- Probe fires an event then reads the DOM synchronously → wait a tick, React hasn't flushed
- Probe "proof" matches the PREVIOUS state's dimensions/content → stale phase; reset and re-tag
