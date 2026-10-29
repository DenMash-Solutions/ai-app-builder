# Restore Loops Must Be Shielded From Their Own Clamped Writes

> **Lesson source**: plan 059 step 3 (2026-10-28) — canvas scroll offset survived a
> frame↔inline round trip in e2e but landed at 1754 instead of 4186 in the live
> browser; logs showed `4186 → clamp 1754 → recapture 1754`.

## Problem Description

- Carrying a value across a remount (portal move, route change, remeasure):
  capture the target → re-apply on the destination over a bounded number of
  frames until layout settles
- When the destination **can't reach** the target (shorter viewport, different
  max), the write **clamps** — and the clamp fires the very event the app uses
  to *observe* that value (scroll event → `onScroll`). A naive listener records
  the clamped value into the ref the next restore reads → the original is gone
  **after one round trip**, and only when the destination actually overflows
  differently
- False-green signature: e2e where the destination happened not to overflow
  passed; the live browser (taller content) failed. The bug is in the *feedback
  loop*, not in either write

## Solution Steps

1. **Capture the target once per effect run** — never re-read the source ref
   mid-retry (a clamped attempt would otherwise become the new "target")
2. **Shield by value while restoring**: the listener ignores an event whose
   value equals what the restore just applied; any *other* value is genuine
   input → it lifts the shield and records:

```ts
const restoringRef = useRef(false);
const appliedScrollRef = useRef(-1); // -1: never matches a real scrollTop
// effect: target = ref.current; restoringRef = true;
//   el.scrollTop = target; appliedScrollRef = el.scrollTop; …retry ≤60 rAF
// onScroll: if (restoringRef && next === appliedScrollRef) return;
//           restoringRef = false; ref.current = next;
```

3. **Lift the shield one frame after the final write** (the clamped event is
   dispatched by the render steps *after* the effect body), or deliberately
   leave it armed on cleanup — the next run re-captures the intact target first
4. Keep the carried target on budget exhaustion (destination may become able to
   scroll later); the shield's `-1` sentinel guarantees a real `0` is never
   mistaken for an applied value

## Verification

- Live round trip frame → Responsive → frame: `scrollTop 4186 restored ✓`
  (the exact case that failed); e2e "transitions preserve selection and scroll"
  green throughout

## Memory Triggers

- State lost only on the **second** transition → the first transition's
  listener recorded a clamped/derived write (self-clobber)
- Restore works in e2e but fails live → did the destination CLAMP in the real
  viewport? Read the listener logs, not the effect
- About to write into a ref from an event that your own write triggers →
  shield by matching the applied value, lift deferred
- "Recapture" reads a different value than the original target → stop, capture
  once per run instead
