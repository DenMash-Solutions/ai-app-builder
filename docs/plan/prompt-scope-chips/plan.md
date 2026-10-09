# Prompt Scope Chips — Implementation Plan

**Status:** implemented
**Date:** 2026-10-08

## Goal

Let the user compose a main-prompt steer against an explicit set of elements instead of the whole spec: pick one or more elements into a visible "prompt scope" (removable chips in the prompt bar), highlight them on the canvas, show a loading indicator while the model works, and send an instance-accurate instruction — so "fix only the Vitamin C Serum image" (or two images on two different cards in one request) targets exactly the right elements. Also fixes the existing gap where `scopeInstruction` cannot disambiguate repeated instances (the drawer's freeform action says "product-image" without saying which of 8). **Extension**: scope can also target the *shared template* of a repeated key — "all card images" via shift+alt+click or a second drawer toggle — so one request can restyle every instance at once.

## Scope

### In scope

- **Scope state** (Playground): `scopeTargets: {key, chain}[]`, deduped by key + instance base path; derived-drop when a target's key leaves `displayedSpec` (patch/undo removed it — same derivation pattern as `effectiveKey`); cleared on route change (entry-scoped, session-only — not persisted)
- **Multi-target instruction** in `lib/editor`: new `scopeTargetsInstruction(targets, spec)` — numbered element list with `key`, component type, and `resolveInstanceScope` disambiguation (`instance i of n, state path /…`) + user request + "leave everything else unchanged"; single-target `scopeInstruction(key, type, instruction, scope?)` delegates to it and gains optional instance scope (drawer freeform path now repeat-accurate too)
- **Prompt-bar chips**: removable chip row above the input inside the bar (bar grows upward); label = component type + instance (`Imagen 3/8`, en/es i18n); per-chip ✕; chips survive a successful scoped steer (iterative follow-ups); hidden when scope empty (landing never shows them — scope clears on route change)
- **Send path**: `handleSend` steer branch composes `scopeTargetsInstruction` when scope non-empty (chips + spec), plain prompt otherwise; revision label unchanged (prompt text)
- **Drawer option**: labeled pressed-toggle below the panel header (visible across all tabs): "Añadir al ámbito del prompt" ⇄ "En el ámbito del prompt" — adds/removes the *current* selection (incl. root); works with pick on or off
- **Shift+click**: in PickOverlay's click handler — while pick is armed, shift+click toggles scope membership for the hit instance and does **not** change the editor selection; plain click keeps today's select behavior; no-op when pick is off (listener already gated)
- **Canvas highlights**: dashed accent outline per scoped element, rendered in the clipping overlay with the selection-ring's rAF-tracked wrapper-identity approach (`findWrapperForChain` — survives repeats, no overflow regression); `data-jr-scope` attribute on wrappers for e2e; visually distinct from the gradient selection ring
- **Loading feedback**: while `isStreaming` and scope non-empty, each scoped element's highlight gains `data-scope-loading`, a pulse animation, and a corner spinner
- **e2e harness**: MSW init records the last `/api/generate` request prompt on `window.__LAST_GENERATE_PROMPT__`; `GenerateMockConfig.delayMs` delays the response so tests can observe the loading state
- **Tests**: unit — multi-target formatting, instance disambiguation, single-target delegation; e2e — see Verification
- **Template scope (extension)**: `{key, chain: null}` becomes reachable for *repeated* keys —
  - **Gesture**: shift+alt+click (pick armed) toggles the shared template for the hit key; shift+click keeps instance semantics; no-op when pick off
  - **Drawer button**: second pressed-toggle under the existing one, rendered only when the selected key repeats — "Scope all N instances" ⇄ pressed; per-key exclusive with instance scope (toggling one drops the other)
  - **Instruction**: `describeTarget` for a repeated key with null chain → `shared template of element "…" (component type "…", applies to all N rendered instances)`; non-repeated keys unchanged
  - **Highlights**: template targets mark **every** wrapper with that `data-jr-key` (new `findWrappersForKey` in instance-dom); count from a repeat+visibility-aware spec-walk helper (unit-tested: 8 `product-image`, 1 root heading)
  - **Chip label**: `Image ×8` / `Imagen ×8` via new `playground.scopeChipAll: "{type} ×{count}"` (en/es); chip ✕ unchanged
  - **e2e**: shift+alt+click chip + highlight count + outgoing wrapper (template wording, no instance path); drawer template button; mutual exclusion both directions; plain shift+click unaffected

### Out of scope

- Persisting scope across reloads / into the history entry — session-only, re-picking is cheap (descoped 2026-10-08)
- Chip ↔ canvas hover cross-highlight — highlights are always-on; hover linking deferred (descoped 2026-10-08)
- Per-chip natural-language sub-instructions — v1 sends one shared user request over the enumerated targets; the model maps request parts to listed instances (descoped 2026-10-08)
- Reordering chips by canvas position — chips stay in add-order (descoped 2026-10-08)
- Clear-all affordance — per-chip ✕ only (YAGNI; descoped 2026-10-08)
- Keyboard shortcut for scope toggle — not requested; shift+click + drawer button cover it (descoped 2026-10-08)
- Scoping from x-ray chips — decorations are `pointer-events-none`; pick + drawer cover authoring (descoped 2026-10-08)

## Design decisions

1. **Scope state lives in the Playground as `{key, chain}[]`, type derived at render from `displayedSpec`** — mirrors the selection model (`selectedKey` + chain); rejected: storing `{key, type}` snapshots (stale types after a patch swaps the element), rejected: a separate context/store (single consumer tree, no sharing need)
2. **One request, enumerated targets** — `scopeTargetsInstruction` lists targets then the single user request; rejected: one model call per chip (N streams, N patches, race-prone), rejected: key-only listing (current disambiguation gap — the model cannot tell instance 3 from 5)
3. **`scopeInstruction` gains an optional scope param and delegates to the multi-target formatter** — the drawer freeform path (`playground.tsx:434`) becomes repeat-accurate with zero UI change; rejected: leaving freeform unscoped (same ambiguity bug persists)
4. **Shift+click toggles membership without moving the selection** — muscle-memory add/remove while inspecting a different element; rejected: select-alongside (drawer jumping defeats comparison workflows), rejected: add-only (asymmetric; chip ✕ exists but shift should be a true toggle)
5. **Chips render in the prompt bar, not the drawer** — the prompt is the consumer of scope; the drawer toggle only mutates membership; rejected: a floating scope HUD (second surface to keep in sync), rejected: chips below the input (form submit layout owns that row)
6. **Keep chips after a successful steer; derived-drop on element removal** — iteration without re-picking; chips whose key left the spec vanish via the same `effectiveKey`-style derivation (no effect round-trip); rejected: auto-clear on success (user must re-scope for follow-ups), rejected: manual cleanup of dead chips (derivation is free)
7. **Highlights are overlay boxes (rAF-tracked), not DOM styling** — reuses the proven selection-ring pattern: survives inner scrollers, adds zero overflow, never touches generated-UI styles; rejected: outline on the wrapper itself (same layout/paint interference the ring overlay was built to avoid)
8. **Loading = pulse + corner spinner on every scoped box while `isStreaming`** — scoped steers are the only streams that exist alongside a non-empty scope (landing generate has empty scope by construction); rejected: per-target pending maps (the stream is one request covering all targets — per-target status is not knowable), rejected: toast-only (user asked for on-element feedback)
9. **MSW records the last prompt and supports `delayMs`** — e2e asserts the *actual outgoing wrapper* (paths + user text) and the loading attribute during a delayed response; rejected: asserting only UI state (would not catch a composition regression in `handleSend`)
10. **Template scope = `{key, chain: null}` (no new target shape)** — the model and formatter already treat null chain as template-level; rejected: a `{kind: "template"}` tag (redundant with the chain), rejected: scoping by type instead of key (keys are unique per element definition; types are not)
11. **Shift+alt+click, not a shift+click cycle** — explicit, preserves instance muscle-memory; rejected: three-state cycle (overshoot, undiscoverable), rejected: drawer-only (canvas is where repeated instances are distinguished visually)
12. **Per-key exclusivity: template ⇄ instances, instances stay multi-selectable** — "edit instance 3" and "edit all" in one request contradict; toggling either side drops the other side's same-key targets; rejected: allowing both (conflicting instructions to the model), rejected: disabling the gesture when the other side is active (a toggle should replace, not no-op)

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build && bun run test:e2e` — all green; **205 unit / 629 assertions**; **56 e2e** (49 baseline + 7 new)
- [x] unit: multi-target formatting with distinct instance paths for repeated keys; singular template-level format; single-target delegation with/without scope (existing `scopeInstruction` test still green)
- [x] e2e `e2e/prompt-scope.spec.ts`: shift+click toggles without moving selection; pick-off guard; drawer toggle add/remove; outgoing wrapper captured via `__LAST_GENERATE_PROMPT__` (numbered targets + `/items/…` paths + user text); unscoped steer sends the raw prompt; `delayMs` stream shows `[data-scope-loading]` then clears while chips persist; chip ✕ + derived-drop after structure-remove
- [x] MCP spot-check on the user's real 8-product carousel (`/es/ui/b0dc8c9c-…`): shift+click scoped `Image 3/8` + `Image 6/8` (Vitamin C Serum + Smoothing Eye Cream), highlights pixel-aligned to both instances, Spanish drawer toggle `Añadir al ámbito del prompt` ⇄ `En el ámbito del prompt`, **real Gemini steer** sent the exact wrapper (both instance paths `/products/2` + `/products/5`) and the model patched precisely `/state/products/2/image` and `/state/products/5/image` — nothing else; chips persisted post-stream, ✕ removed one chip (`Quitar Image 3/8 del ámbito del prompt`), marks followed 2→1
- [x] both themes: chip legible on dark (`emerald-200` on `emerald-400/10`) and light (`emerald-700` on `emerald-600/10`); chips are shadcn `Badge asChild` remove-buttons
- [x] extension unit: template wording with count ("shared template … applies to all 3 rendered instances"); `countKeyInstances` (filtered repeat 2/2/1, nested 3/3/2, unknown 0); mixed template+instance listing — **210 unit / 643 assertions**
- [x] extension e2e (3 new, **59 total**): shift+alt+click → `Text ×6` chip + 6 marks + 6 boxes + outgoing wrapper is template wording (no "instance"); drawer template button add/remove with `aria-pressed`; mutual exclusion both directions; post-steer toggle uses the patched label (mock edit rewrites the template text)
- [x] extension MCP on the real carousel: shift+alt+click → `Image ×8` chip (es "Quitar Image ×8 del ámbito del prompt"), 8 marks + 8 rAF boxes, drawer `Las 8 instancias en el ámbito del prompt` pressed alongside the primary toggle; **real Gemini steer** sent the exact template wrapper ("shared template of element \"product-image\" … applies to all 8 rendered instances") and the model replied with a single template patch `/elements/product-image/props/className → "… grayscale"` — all 8 images rendered `grayscale(1)`; chip + marks persisted

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-08 | plan drafted (research: prompt bar sends unscoped; `scopeInstruction` lacks instance disambiguation; `resolveInstanceScope` provides index/count/path; ring overlay pattern reusable) |
| 2026-10-08 | approved — clarifying answers: shift+click toggles scope without selection, chips kept after steer, chip label = type + instance |
| 2026-10-08 | implemented — 205/629 unit, 56/56 e2e, live MCP steer hit both scoped instance paths exactly; drawer toggle initially landed in the Structure tab (wrong `{scope && (` anchor) and was moved below the header |
| 2026-10-08 | scope extended — template scope ("all card images"): shift+alt+click + second drawer button, per-key exclusivity; approved same turn |
| 2026-10-08 | template scope implemented — 210/643 unit, 59/59 e2e; live Gemini steer patched only `/elements/product-image/props/className` and all 8 instances went grayscale; count helper fixed mid-implementation (repeated containers render once per visible item) |
