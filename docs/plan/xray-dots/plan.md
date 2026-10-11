# X-Ray Dots — Implementation Plan

**Status:** implemented
**Date:** 2026-10-10

## Goal

Replace the x-ray chip system (permanent `key · Type` chips, quiet/container tiering, greedy lane placement, hover-revealed chips) with a single simple marker: one family-colored **dot** per element at its box top-left. Colliding dots fan out horizontally `(•)(•)(•)`. Hovering a dot shows its `key · Type` label; clicking pins the label and highlights the component box (grow/shrink bounce); a `+` button on the label toggles the instance into the prompt scope. Dots are bigger (10px visual, 16px hit area — hit size = fan pitch so fanned neighbors never cover each other's centers) and are interactive whenever x-ray is on — the whole placement/tiering apparatus (~200 lines) goes away.

## Scope

### In scope

- `components/editor/xray-labels.tsx` — rewrite to the dots model:
  - one dot per `[data-jr-key]` wrapper at the existing box anchor (boxless elements keep the ancestor-cascade anchor, rendered as an amber dot)
  - horizontal collision fan: greedy DOM-order pass; a dot within 8px of a placed cluster member sits at `rightmost + 8px`, same y → `(•)(•)(•)`
  - dot = 10px (`h-2.5 w-2.5`) family-colored, inside a 16px (`h-4 w-4`) transparent rounded button (`pointer-events-auto`) centered on the anchor
  - hover dot → show label (`key · family-colored Type`, old chip styling) anchored above the dot
  - click dot → toggle that instance's pin (multiple pins allowed), grow/shrink pop animation; if pick is armed, the click also selects (`onSelect` with instance chain)
  - pinned dots keep label + amber outline (existing hover-outline box, one per hovered/pinned wrapper)
  - label carries a `+`/`✓` button → `onToggleScope(key, chain, false)`; `✓` (scoped) rendered when the instance's `scopeTargetId` ∈ `scopeIds` prop
  - Escape (window, capture): if any pins → clear all + `preventDefault` (runs before the panel/pick cascade)
  - container click (capture): any canvas click clears all pins (dot clicks live in the overlay and never reach the container)
  - remove: chips, tiering, lane pass, `estimateChipWidth`/`rectsOverlap`/`isContainer`, chip click-to-pick, canvas-`mouseover` hover focus (hover state is dot-driven only)
- `app/globals.css` — `@keyframes` + `.jr-xray-dot-pop` (scale 1 → 1.35 → 0.9 → 1, ~220ms)
- `lib/editor/editor.ts` (or adjacent) — export `scopeTargetId` so playground and `XrayLabels` share the id format (currently a playground-local helper)
- `components/playground/playground.tsx` — wire new props (`pickArmed`, `scopeIds`), drop `interactive`; keep `onSelect`/`onToggleScope`
- e2e rewrites:
  - `editor.spec.ts` "x-ray outlines containers and pick hover shows a badge" → dots exist for container + leaf; dot hover shows label; pick badge half unchanged
  - `editor.spec.ts` "x-ray labels mark boxless elements and never overflow the canvas" → boxless ghost gets a dot; dots add no canvas overflow (lane/hierarchy assertions removed)
  - `prompt-scope.spec.ts` "x-ray chips pick and scope like the canvas" → "x-ray dots pin, highlight, and scope": dot click pins + outline; `+` scopes (✓ toggles off); pick-armed dot click selects; Escape clears pins
  - `shortcuts.spec.ts` — chip visibility assertion → `[data-xray-dot]`
- `docs/plan/xray-chip-pick/plan.md` — one-line "superseded by x-ray-dots" note

### Out of scope

- Redesigning HoverBadge (picker label) — untouched (descoped 2026-10-10)
- Dot clustering beyond the horizontal fan (radial clusters, counts) — `()()()` was the requested shape (descoped 2026-10-10)
- Keeping canvas-`mouseover` dim/focus without chips — hover state is dot-driven only; re-add later if scanning feels lost (descoped 2026-10-10)
- Persistence of pins across spec edits/re-renders — pins hold wrapper identity and are pruned when wrappers leave the tree (descoped 2026-10-10)
- `+`/`✓` on the floating hover label — scope moves to the pinned chip's dropdown only; hover label is identity-only (descoped 2026-10-10, v2)
- Grow/shrink pop on click — replaced by the dot→chip transform animation (descoped 2026-10-10, v2)

### In scope (v2 iteration — approved 2026-10-10)

- Bigger dots: visual 14px, hit 20px, fan pitch = 20px (= hit size, invariant kept)
- Click dot → the dot **transforms in place into a chip** (`key · Type`, animated ~180ms scale-in from the dot position); click chip → morphs back to a dot (unpin)
- Pinned chips **reflow the fan row**: a chip occupies its estimated text width; everything to its right in the same band shifts right (layout is a `useMemo` over anchors + pin state)
- Chip layout: `+`/`✓` dropdown trigger at the **left**, then key (CSS-ellipsis `…` past `max-w-[18ch]`), then family-colored `· Type` (never truncated)
- `+` is a **dropdown** (shadcn `Popover`, portals above the overlay): *This instance* / *All instances*; the active membership shows ✓ and clicking it removes (toggle); i18n via `useTranslations()` (no args) + `editor.xrayScope.*` keys in `en.json`/`es.json`
- Pin & hover highlight = **the element's own border**: `data-xray-pinned`/`data-xray-hover` wrapper attrs + CSS amber outline (2px, offset outside) declared after the family outline rules — no overlay rectangle anymore
- e2e: prompt-scope test rewritten (pin → chip, dropdown instance/all/toggle-off, reflow-safe fan thresholds); editor.spec gains chip-transform + pinned-attr assertions

## Design decisions

1. **Dots always interactive while x-ray is on** (user-approved) — rejected: pick-gated interactivity, because dots are the x-ray UI itself and touch has no hover
2. **Dot click = pin + highlight; selects only when pick is armed** (user-approved) — rejected: always-select, because inspection should not open the editor
3. **`+`/`✓` on the hover/pinned label** (user-approved) — rejected: permanent `+` badge on every dot, because it clutters the simplified marker; the button reuses the canvas shift+click `onToggleScope` semantics (instance scope; template stays shift+alt on canvas)
4. **Multiple pins; Escape clears all; canvas click clears all; clicking a pinned dot unpins just that one** (user-approved) — rejected: single-pin, because compare-while-inspecting multiple elements is the point of pins
5. **Escape for pins is handled in `XrayLabels` (window capture + `preventDefault`), skipped when the event target is inside `[data-editor-panel]`** — cascade: pins → panel → pick; the panel keeps "Escape belongs to me" while focused, so closing the panel never gets "wasted" on pins; rejected: lifting pin state to the playground, because pin state is render-local and the existing cascade already yields on `defaultPrevented`
6. **Horizontal greedy fan at 16px pitch (= the hit-button size), DOM order** — rejected: keyed grid bucketing, because chain-spreading (each placed dot becomes a fan anchor) handles uneven clusters with less code; rejected: vertical stacks, because `()()()` was specified; rejected: the drafted 8px pitch with 24px hit buttons, because a neighbor's hit box then covers the covered dot's center and makes it unhittable (nested parent/child unions share anchors — verified by e2e interception); pitch must be ≥ hit size, so 16px keeps a tight row with every center exposed
7. **Scope membership via shared `scopeTargetId` (`key|JSON(chain)`)** — rejected: duplicating the string format in `XrayLabels`, because drift would silently break the `✓` state; the helper moves to `lib/editor`
8. **Hover/focus dim kept but driven by dot hover only; canvas `mouseover` listeners removed** (user-approved) — the subtree-lighting stays a scanning aid when engaging the x-ray UI; canvas hover no longer dims, because with chips gone there is no label to anchor the fade; pins get outline + label only, no sticky dim
9. **Pop = CSS keyframes class toggled ~220ms on click** — rejected: `:active` transition only, because an explicit grow/shrink was requested; rejected: rAF-driven scale, because it duplicates what CSS does — **superseded by v2 decision 14** (transform replaces the pop)
10. **Bigger dots: 14px visual / 20px hit / 20px fan pitch** (user-approved, v2) — pitch = hit size stays mandatory (decision 6 rationale)
11. **Click transforms the dot in place into an animated chip; pin layout is derived (`useMemo`) from anchors + pin occupancy** (user-approved, v2) — rejected: measuring rendered chip widths post-paint, because it flickers; the width estimate (font-mono metrics, same trick as the old chips) only feeds fan placement, so a few px of drift shifts neighbors, never clips
12. **`+` at the left as a Popover dropdown (instance / all, active option toggles off)** (user-approved, v2) — rejected: keep instance-only `+`, because template scoping from the dot was the natural next question; Radix portals the content above the overlay, so `pointer-events` needs no special-casing
13. **Pin/hover highlight via wrapper attrs + CSS outline on the element's own border** (user-approved, v2) — rejected: keeping the overlay rectangle, because it reads as an inner border stuck onto the element; CSS outline follows border-radius and paints outside (offset 2), same idiom as the container outlines; specificity ties the family rules, source order (after them) wins
14. **Click animation = chip scale-in from the dot (transform-origin left, ~180ms); the v1 pop keyframes are removed** (user-approved, v2)
15. **Chip's `+` dropdown is a controlled `Popover` (`open={scopeMenu === wrapper}`) closing on each choice / Escape / pin-clear** — rejected: uncontrolled `Popover`, because the chip is a plain div (not a `PopoverAnchor`) and the fan reflow on any other instance's pin/unpin shifts the chip sideways out from under the once-measured anchor, so Radix reads the content as detached and snaps it shut mid-interaction (caught by the toggle-off path in e2e); scope changes never invalidate a pin, so a controlled open keeps the menu mounted across that reflow, with outside-click and Escape still dismissing it

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test` — green (225 unit / 662 assertions)
- [x] `bunx playwright test` — 61/61 (4 rewritten x-ray tests, no regressions)
- [x] MCP live on `/es/ui/c8c7cdcb-…`:
  - 147 dots, all 16×16 hit / 10px visual; 0 in-band clashes (fan holds on a dense real page); 3 boxless
  - dot hover → `nav-link-4 · Link+` label + amber outline
  - click → pin (label persisted as amber after pointer leave); Escape → pin cleared (hover-only zinc label remained, dots + scope chip untouched)
  - `+` → prompt-bar chip `nav-link-4 · Link` + `[data-jr-scope]` ring; button flips to `✓` / "Remove…"; `✓` click removes both
  - canvas click (real hit-tested click) → pin cleared
  - pick armed → dot click opens the editor panel for `nav-link-4` with the label pinned

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-10 | plan drafted (user spec: dots only, `()()()` fan, hover label, pin+highlight, pop, `+` scope, bigger for mobile; answers: always interactive, pin-only unless pick, `+` on label, multi-pin + Escape) |
| 2026-10-10 | approved (open points resolved: dim kept, dot-hover-driven; Escape pins → panel → pick with panel-focus guard) |
| 2026-10-10 | implemented — verification green; design refinement during e2e: fan pitch = hit size (16px, was drafted 8px pitch / 24px hit — a larger hit box covers the neighbor's center and makes fanned dots unhittable; recorded in decision 6) |
| 2026-10-10 | v2 approved (bigger 14/20 dots; click → animated chip transform; pinned chips reflow the row; `+` left-side dropdown instance/all with toggle-off; key ellipsis, type full; pin/hover highlight = element's own CSS outline — decisions 10–14) |
| 2026-10-10 | v2 implemented — verification green (lint, tsc, 225 unit, 61/61 e2e, MCP live: 147 dots at 20×20 with 0 clashes, chip transform + element-border outline, dropdown instance/all toggle-off in es, reflow shifted a 7-wide fan by the chip's 144px width); found & fixed a dropdown detachment race on reflow (decision 15) |

### In scope (v3 iteration — approved 2026-10-10)

- Control glyphs become **icons**: trigger `+`/`✓` → lucide `Plus`/`Check`, menu-option `✓` → `Check` (visible menu labels stay i18n strings; trigger gains `data-xray-scope-state="idle|active"` for tests)
- **`+`/`✓` on every chip; dropdown only for repeatable keys** (repeat = rendered wrappers sharing the key) — singletons toggle scope directly (instance target === template target for them)
- **Chip always over the border**: chip sits fully above the anchor (bottom edge flush at the element's top border; flips below when no room) and is opaque (`bg-zinc-950`) so outlines never bleed through — fixes chips being centered on the anchor with the border line crossing their middle (screenshot)
- **Remove button** (`<X>`, `data-xray-remove`) at the chip's right end; chip body click keeps the same removal path
- **Animated removal**: `jr-xray-chip-out` shrink+fade (~160ms) keeps the layout slot (neighbors shift only on commit), then unpins — applies to X, body click, Escape, and canvas-click clear-all; Escape falls through to the panel once every pin is already mid-exit
| 2026-10-10 | v3 implemented — verification green (lint, tsc, 225 unit, 61/61 e2e; MCP live: 9/9 pinned chips fully above their border with 0 straddles, lucide Plus/Check/X icons, singleton `+` toggles scope directly with no popover, repeatable keys keep the instance/all dropdown, animated X removal); scope corrected mid-implementation: the `+`/`✓` toggle is on every chip, only the dropdown is repeat-only |

### In scope (v4 iteration — approved 2026-10-10)

Fixes a recurring bug: clicking the canvas or the chip body removed the chip, and a chip left in scope after removal kept its `[data-jr-scope]` outline (dangling scope).

- **Canvas click never removes a chip** — the `+`/`✓` on the chip is the only scope control and the X the only removal, so an outside click can't drop a scoped chip off the canvas
- **Chip body click toggles scope** (adds/removes scope for that instance) instead of removing the pin — only the X button removes
- **Chip X removes pin + scope together**: removal now calls a new `removeScope(key)` (playground) that drops **every** scope target for the key — both the shared template `key|null` and any instance-specific `key|chain`. The prior `clearScope` path reused `handleToggleScope(key, instance, template=true)`, but for a singleton `template=true` with `count===1` fell through to `template=false` and toggled a *different* target, leaving the scope (and its outline) behind
| 2026-10-10 | v4 implemented — verification green (lint, tsc, 225 unit, 61/61 e2e). editor.spec.ts updated: chip body click now asserts scope toggles (chip stays pinned, `[data-jr-scope]` present) and only `data-xray-remove` clears the pin; new `onRemoveScope` prop wired playground → XrayLabels so the chip's X drops pin + all scope targets for the key |
