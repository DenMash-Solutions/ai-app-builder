# Prompt Scope Chips — Implementation Plan

**Status:** draft
**Date:** 2026-10-08

## Goal

Let the user compose a main-prompt steer against an explicit set of elements instead of the whole spec: pick one or more elements into a visible "prompt scope" (removable chips in the prompt bar), highlight them on the canvas, show a loading indicator while the model works, and send an instance-accurate instruction — so "fix only the Vitamin C Serum image" (or two images on two different cards in one request) targets exactly the right elements. Also fixes the existing gap where `scopeInstruction` cannot disambiguate repeated instances (the drawer's freeform action says "product-image" without saying which of 8).

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

## Verification

- [ ] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build && bun run test:e2e` (baselines: 202 unit / 618 assertions, 49 e2e)
- [ ] unit (`lib/editor/editor.test.ts`): `scopeTargetsInstruction` — two repeated instances of the same key produce distinct numbered entries with correct instance index/count/path; mixed-type targets; delegation of single-target `scopeInstruction` with and without scope
- [ ] e2e new (`e2e/prompt-scope.spec.ts`, stateful fixture):
  - shift+click (pick on) "Item C" → chip `Text 3/6`-style appears; `[data-jr-scope]` count 1; selection/panel unchanged
  - shift+click a second element → 2 chips; re-shift+click first → membership toggles off
  - shift+click with pick OFF → plain selection, no chip
  - drawer toggle adds current selection / pressed state removes it
  - scoped steer: fill prompt + submit → `window.__LAST_GENERATE_PROMPT__` contains both numbered targets with `/items/…` paths and the user text
  - `delayMs` mock: during stream `[data-scope-loading]` present on scoped elements; after completion absent; chips still present
  - chip ✕ removes it; undo that removes the scoped element drops the chip (derived-drop)
- [ ] MCP spot-check (carousel): scope two different `product-image` instances (shift+click + drawer toggle), verify two dashed highlights at the right instances, spinner during a real delayed-feel steer, Spanish chip labels + drawer toggle text, chips removable

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-08 | plan drafted (research: prompt bar sends unscoped; `scopeInstruction` lacks instance disambiguation; `resolveInstanceScope` provides index/count/path; ring overlay pattern reusable) |
