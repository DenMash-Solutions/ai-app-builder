# Radix Escape Runs Capture-Phase on `document` — React `stopPropagation` Cannot Cancel It

> **Lesson source**: plan 060 step 3 (2026-10-29) — inline template rename in the
> picker had to cancel **only the rename** on Escape while keeping the dialog open.
> First attempt used `event.stopPropagation()` in the input's `onKeyDown`; the e2e
> showed the whole `[data-component-picker]` dialog gone instead of the row restored.

## Problem Description

- Escape-to-dismiss in Radix (`Dialog`, `Popover`, `DropdownMenu`, …) is NOT a React
  handler — `@radix-ui/react-dismissable-layer` registers
  `ownerDocument.addEventListener("keydown", handleKeyDown, { capture: true })`
- Capture-phase **on `document`** means it runs **before** the event reaches the
  target, i.e. before React's synthetic handler on the input ever fires. By the time
  your `if (event.key === "Escape")` runs, Radix has already called `onDismiss()`
  → `onOpenChange(false)`
- React's synthetic `event.stopPropagation()` is worse than useless here: React's
  listeners live at the root container in the **bubble** phase, so it can only stop
  *later React* handlers — the Radix document listener already executed. It also
  cannot upgrade to `stopImmediatePropagation`
- Signature: the feature works for the commit path (Enter) and fails only on the
  cancel path (Escape), and what disappears is the **entire dialog**, not the
  inline edit

## Solution Steps

1. **Intercept where Radix asks** — `DialogContent` (and every other layer) accepts
   `onEscapeKeyDown(event)` and checks `event.defaultPrevented` *before* `onDismiss`:

```tsx
<DialogContent
  onEscapeKeyDown={(event) => {
    // Radix already ran (capture, document) — block its dismiss while renaming.
    if (renamingId !== null) event.preventDefault();
  }}
>
```

2. **Still handle Escape on the input** — that is where you clear the draft
   (`setRenamingId(null)`). Ordering is safe: Radix's capture handler ran first and
   was blocked; the bubble-phase React handler then cancels the rename. The **next**
   Escape sees no active rename and closes the picker normally
3. Guard the unmount-triggered `onBlur` (a stale closure could still commit the
   draft) with a `skipBlurRef` set in the Escape branch — React usually doesn't fire
   blur for an unmounted node, but the ref makes the intent explicit
4. For **any** other library that listens on `document`/`window` (or in capture
   phase), assume the same rule: a React-level `stopPropagation` cannot reach it.
   Prefer the library's own escape hatch (`onEscapeKeyDown`, `onDismiss` cancel,
   `event.preventDefault()`), or a capture-phase listener you add yourself

## Verification

- Live MCP: rename → type draft → Escape → **dialog still open**, row shows the
  original name, `localStorage["genui-component-templates"]` unchanged (draft never
  committed) → second Escape closes the picker
- `e2e/templates.spec.ts` "rename (commit + escape) and delete templates in the
  picker" — initially red on exactly this, green after `onEscapeKeyDown`

## Related probe gotcha

- The a11y-tree snapshot (`take_snapshot`) **prunes non-option children of
  `role="listbox"`** — the empty-state `<p>` inside the listbox is invisible there
  even though it renders and is visible. When a text assertion "isn't in the
  snapshot", probe the DOM (`listbox.textContent`) before concluding it's missing;
  Playwright's `getByText` (e2e) is unaffected

## Memory Triggers

- Escape in an inline edit/close-on-Escape control **closes the whole dialog** →
  the library's document/capture listener already ran; use `onEscapeKeyDown` +
  `event.preventDefault()`, never `stopPropagation()`
- About to write `event.stopPropagation()` to block a library-level handler → ask
  which **phase** and **node** that handler is registered on (React bubble at root
  ≠ document capture)
- Cancel path broken while the commit path works → the failure is in the
  dismiss/cleanup ordering, not in the save logic
- A visible string "missing" from `take_snapshot` → a11y trees drop some
  non-semantic children; DOM probe is ground truth
