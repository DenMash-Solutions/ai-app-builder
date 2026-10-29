# Cross-Realm DOM: `instanceof` Rejects Nodes From Iframes & Portals

> **Lesson source**: plan 059 step 3 (2026-10-28) — the hover badge never appeared
> inside the device frame while working perfectly inline; live probe proved
> `el instanceof Element === false` for a node the frame rendered.

## Problem Description

- Content portaled into an iframe (device frame, any `createPortal` into another
  document) is **created/adopted by the iframe's document** → the nodes belong to
  the **iframe's realm**: `el.constructor !== parentWindow.Element`, so any
  parent-realm guard `target instanceof Element` / `instanceof HTMLStyleElement`
  evaluates **false** for them
- The listener is attached and no error is thrown — the guard just rejects every
  event, so the feature is *silently* dead **only in the frame** while inline
  behavior (same code, parent realm) is perfect
- Plan 059 hit the whole defect class at once: hover badge dead in frame, dnd
  never armed on `pointerdown`, `elementFromPoint` results rejected, x-ray chip
  scope-toggle misbehaved — all misdiagnosed-in-advance candidates (coordinates,
  zoom transform, listener staleness) when the actual fault was the constructor
  check
- `Node` APIs are safe cross-realm: `closest`, `contains`, `appendChild`,
  `dispatch` all work because methods resolve on the node's **own** prototype;
  **constructors and `instanceof` do not**

## Solution Steps

1. **Duck-type instead of `instanceof`** — one shared guard,
   `components/editor/cross-realm.ts`:

```ts
export function asElement(target: EventTarget | null): Element | null {
  if (target !== null && typeof (target as Element).closest === "function") {
    return target as Element;
  }
  return null;
}
// ✅ asElement(event.target)?.closest("[data-jr-key]") ?? null
// ❌ (event.target instanceof Element) && event.target.closest(...)
```

2. **Realm-correct globals** stay on the owner (already the R3 pattern):
   `container.ownerDocument.elementFromPoint(x, y)`,
   `container.ownerDocument.defaultView.addEventListener("keydown", …)` — and
   remember its **results** are same-realm nodes too (that's why the dnd
   hit-test needed `asElement` as well)
3. **Adoption preserves creation realm**: a node cloned/created in realm A and
   later inserted into realm B keeps A's prototypes — `device-frame.tsx`'s
   stylesheet mirrors clone from parent-realm sources, so their
   `instanceof HTMLStyleElement` remains valid (not every `instanceof` near a
   frame is a bug; check where the node was **born**)

## Verification

- Live MCP probe (before fix): `el instanceof Element` → `false`,
  `el.ownerDocument === frame.contentDocument`, `constructor.name` → `"HTMLSpanElement"`
- After fix: badge renders in frame **before and after** a preset switch; e2e
  R1/R3 test (hover + drag at 50%) green; all inline editor tests unchanged

## Memory Triggers

- A listener is attached but its handler "never runs" inside an iframe →
  suspect the `instanceof` guard, not the wiring
- "Works inline, dead in the frame" for the SAME handler → realm first,
  coordinates/zoom second
- About to write `target instanceof X` in a component that can render inside
  the device frame → use `asElement` (`components/editor/cross-realm.ts`)
- Rejected results from `elementFromPoint`/`elementsFromPoint` while the node
  is visibly there → the API returns same-realm nodes; duck-type them too
