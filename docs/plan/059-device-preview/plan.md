# Device Preview (viewport emulation + zoom) — Implementation Plan

**Status:** draft
**Date:** 2026-10-27

## Goal

The playground renders every design at the browser's own size, so there is no way to
check how a generated UI behaves on a phone or tablet. This adds a DevTools-style
device preview to the canvas: a picker with predefined presets (Mobile 390×844,
Tablet 768×1024, Desktop = fill, Custom W×H) that renders the UI at that exact
viewport — **real media queries, real `vh`/`dvh`** — plus zoom (fit-to-screen default
and 50–150% steps) and a size label. The rendered spec currently uses viewport
breakpoints (`sm:grid-cols-2`, `lg:grid-cols-4`, `md:text-5xl` on the real Pokédex),
so a width-constrained `<div>` would lie about the mobile view: `@media` follows the
browser window, not a wrapper. True fidelity needs a real viewport → an iframe.

## Scope

### In scope (user answers 2026-10-27: all four recommended options)

1. **True viewport emulation** — same-origin iframe sized to the preset; the existing
   React tree is **ported into it** (`createPortal` into `iframe.contentDocument`), so
   providers, state overrides, actions, streaming and pick/x-ray/drag overlays keep
   working unchanged
2. **Presets** — Mobile 390×844, Tablet 768×1024, Desktop (fill, = current inline
   behavior), Custom (W×H input); picker lives in the TopBar as an icon + Popover
   (same pattern as the existing TopBar menus)
3. **Zoom** — default Fit-to-screen (recomputed on stage resize via ResizeObserver),
   manual steps 50 / 75 / 100 / 125 / 150 %; scaling wraps the frame so the iframe's
   CSS viewport (and therefore breakpoints) never change
4. **Minimal chrome** — subtle rounded frame border + size label chip
   (`390 × 844 · fit 82%`); preset and zoom persist in localStorage
5. **Accessibility** — iframe `title` (WCAG frame requirement), picker with radio
   semantics + keyboard operation, sane focus flow into/out of the frame
6. **Picker availability** — shown only while a spec renders (nothing to preview on
   the landing empty state)
7. **Verification** — full gate chain, e2e proving a preset actually flips media
   queries inside the frame, MCP spot-check

### Out of scope

- Device bezel / notch / status-bar mockup — cosmetic, no fidelity gain (descoped 2026-10-27, user chose minimal chrome)
- Orientation (rotate) toggle — the Custom W×H input covers landscape (descoped 2026-10-27, user chose the lean preset set)
- Safe-area / `env(safe-area-inset*)` emulation (descoped 2026-10-27)
- Free-form zoom (slider, ctrl+scroll, pinch) — fixed steps + fit are enough for v1 (descoped 2026-10-27)
- **Input-modality emulation** — `@media (hover: hover)`, `pointer: coarse` and
  `userAgent` still see desktop Chrome inside an iframe; preview = layout/breakpoints/
  `dvh` fidelity, **not** touch behavior (declared 2026-10-27 to set expectations —
  "like DevTools" minus DevTools' device-toolbar input emulation)
- Spec-driven portal overlays (Dialog/Select/Popover/Tooltip) escaping the frame —
  **documented known limitation** with follow-up F16, see R6 (declared 2026-10-27)
- Breakpoint *forcing* (view as-if width ≠ frame width), screenshot/export, DevTools-like element inspector inside the frame
- Rewriting generated CSS to container queries — would fix fidelity without an iframe but is fragile across Tailwind output + HMR

## Design decisions

1. **True viewport via same-origin iframe** — rejected: width-constrained div (media
   queries keep following the real window → a 390px frame would still render
   `lg:grid-cols-4`, i.e. the desktop grid squeezed); rejected: rewriting the
   stylesheet's `@media` blocks to container queries (fragile, breaks under Turbopack
   HMR and arbitrary variants)
2. **Desktop preset stays inline (no iframe)** — the iframe mounts only for
   Mobile/Tablet/Custom. Rejected: always-iframe, which would force `frameLocator`
   into all 114 existing e2e tests and change the default canvas
3. **Portal the same React tree, don't mount a second root** — `createPortal` into the
   iframe document keeps `JSONUIProvider`/visibility/query/state context identical
   (no state duplication, no extra bundle). Rejected: a separate React root inside the
   iframe (loses providers, doubles runtime wiring)
4. **Portaled unit = the canvas stage interior** — the `containerRef` scroller
   (`Renderer`, `CanvasDnd`, `HoverBadge`) **and** the overlay siblings (`XrayLabels`,
   `PickOverlay`) move inside the frame wrapped in an absolute-inset stage div;
   TopBar, ToolRail, prompt bar and edit panel stay outside. All rect math then
   happens among portaled elements (self-consistent coordinates, no cross-frame
   offset/scale math); React refs work across portals unchanged
5. **Style parity = clone + observe** — clone the page's `<style>`/`<link>` head nodes
   into the iframe head and keep them in sync with a `MutationObserver` (Turbopack HMR
   replaces style tags); mirror `<html>` class (`dark`/`light`) + `lang` so theme
   follows; iframe body gets the canvas backdrop classes (`dot-grid`)
6. **Zoom scales the frame, never the viewport** — `transform: scale()` on the iframe
   wrapper: the iframe's CSS viewport stays 390×844 at every zoom level, so
   breakpoints stay device-accurate while the frame fits the stage
7. **Prefs follow the `model-store.ts` module-store pattern** — `getServerSnapshot()`
   returns the default (`Desktop` / `Fit`) so SSR/hydration never mismatches
   (react-inline-scripts lesson family); localStorage key `genui-device-preview`,
   try/catch fallback to defaults
8. **Picker UI reuses the TopBar Popover pattern** (lucide `Smartphone` icon, preset
   list, zoom steps) — no new chrome component vocabulary; i18n keys under
   `playground.devicePreview.*` (en/es)

## Architecture refinements (external review 2026-10-27, verified against the codebase)

Refinements to the sections above — they do not change the iframe/portal architecture.
Where a claim was auditable, it was checked against the actual code (findings inline).

### R1 — Subtree lifecycle & state preservation

Changing the portal container **unmounts and remounts** the moved subtree — React
context survives a portal, component *instances* do not. Requirements:

- Audit what must survive Desktop ↔ preset transitions: selection + edit-panel state
  (lives above the boundary ✓), streaming (above ✓), **canvas scroll offset** (lift
  before the switch, restore after ready), **uncommitted input drafts inside the
  canvas** (a remount drops `draft` — the `controlled-input-drafts` lesson; either
  lift or document the reset as intended)
- Test transitions mid-selection, mid-edit, and mid-streaming; remounts must not
  create duplicate subscriptions, listeners, or streaming operations
- Legitimate local resets (open popovers, focus) are acceptable — but must be
  deliberate and verified, never assumed

### R2 — Explicit iframe readiness lifecycle

An iframe element existing ≠ ready to receive the portal. Define:
`inactive → initializing → ready → disposed`.

- Portal renders only on **ready** (document + mount node + viewport config +
  theme/lang + initial styles applied); decide explicitly whether first render waits
  on stylesheet readiness or shows a controlled loading state
- Generation token: stale async work (slow stylesheet, preset switched mid-init)
  must never mount content into a superseded/disposed iframe; load/init failures
  surface an error state, never a partially-initialized "ready"
- Pending work cancelled on preset switch/dispose; setup/teardown idempotent under
  Strict Mode (safeguard 6)

### R3 — Coordinate-system & global-API audit (codebase-verified findings)

- **Bug-in-waiting:** `canvas-dnd.tsx:91` calls `document.elementFromPoint` — the
  global `document` is the parent's after portaling → must be
  `container.ownerDocument.elementFromPoint`
- **Bug-in-waiting:** `canvas-dnd.tsx:255` and `xray-labels.tsx:423` listen for
  `keydown` on the global `window` — key events with focus inside the frame fire on
  the iframe's `defaultView`; Escape/cancel handling must attach there (parent keeps
  its own listener for outside-frame keys)
- Rect math is already self-consistent: pick/xray/hover overlays compute rect pairs
  **between portaled elements**, and a parent transform does not propagate into the
  iframe's coordinate space → overlay alignment is zoom-safe by construction
  (still verify at 50/100/150%)
- Rule: portaled code must never touch global `document`/`window` — always
  `ownerDocument` / `defaultView`; this includes **`matchMedia`** (would measure the
  parent viewport), **`ResizeObserver`/`IntersectionObserver` construction realm,
  `getComputedStyle`, `document.fonts`, `elementFromPoint`**; edit-panel ↔ canvas
  communication stays via React props/state (audit for direct DOM queries crossing
  the boundary)

### R4 — Stylesheet synchronization & parity

- Delta sync must also catch **in-place content mutations** of an existing style
  node (observe `childList` + subtree/characterData; verify what Turbopack actually
  does first — avoid a general CSSOM sync engine unless testing proves it necessary)
- Preserve node **order** and attributes (`media`, `integrity`, `crossorigin`);
  deterministic behavior on stylesheet load errors; verify relative URL/font
  resolution inside the frame (`about:blank` iframe inherits the parent base URL —
  confirm rather than assume)
- Readiness: stylesheets required before **ready**; `document.fonts.ready` gates
  interactive readiness separately from the layout tripwire
- Performance constraints from safeguards 2–3 unchanged: delta-based, coalesced,
  observer mounted only while the preview is

### R5 — Scaled-frame layout & fit policy

- The wrapper's **layout box = unscaled device size**; the transform is visual only,
  so the parent layout must reserve the **scaled** dimensions (margins/negative-margin
  compensation or equivalent) to avoid wrong whitespace, overlap, or clipping
- **Policy (explicit decision):** Fit and fixed percentages are **mutually
  exclusive modes**. Fit: `fitScale = min(stageW / deviceW, stageH / deviceH)`
  computed from the **unscaled** stage; fixed % applies directly
- Frame larger than the stage at fixed % → **clipped** (stage keeps
  `overflow-hidden`; chrome is never pushed — Fit is the way to see everything, and
  the size label flags `150% · clipped`); frame smaller → centered
- No-op guard + transform-only output (safeguard 5) — ResizeObserver watches the
  unscaled stage, and transforms can't re-trigger it

### R6 — Portal leakage of spec-driven overlays (known v1 limitation)

**Evidence:** `@json-render/shadcn` implements Dialog/Select/Popover/Tooltip with
`Portal(...)` (10 call sites), and Radix's Portal resolves
`container = globalThis?.document?.body` — the **parent** document, always (all
React runs in the parent realm; `globalThis.document` cannot be redirected per
instance). A spec-driven overlay opened while a device preset is active would mount
outside the frame, and its popper measures iframe-internal trigger rects against the
parent viewport → mispositioned.

- Current fixtures use none of these components (existing tests unaffected), but
  generated form UIs with a `Select` are common → **v1: documented known limitation**
- Rejected: MutationObserver relocation of stray portal nodes (coordinates stay
  wrong — same (0,0) class as the select bug fixed in 058 step 4)
- Follow-up **F16** (`docs/follow-ups.md`): portal-container support — upstream
  `container`/portal-context in `@json-render/shadcn`, or a registry-level wrapper
- Verification item *characterizes* the behavior so the limitation is tested, not
  assumed

## Performance safeguards

Background: cost = how far down the rendering chain an operation invalidates
(`style recalc → layout → paint → composite`). Plan 057 measured the failure mode
(rule count × element count ≈ ~1s stalls at 42k rules); these constraints keep the
preview on the curated 057 baseline (~64 FPS, DevTools open).

1. **Recalc stays inside the iframe** — the iframe is a separate document with its
   own style engine; a preset switch recalcs only the iframe's spec subtree, never
   the main document's viewport (that's the DevTools-emulation pathology we're
   avoiding). Rule: never resize or re-style the main canvas to emulate a device
2. **Frame-open timing as a CSS-bloat tripwire** — the iframe parses its own copy of
   the stylesheets on mount; measure mount → first layout inside the frame and keep
   it under threshold (~50ms). It degrades in lockstep with safelist creep — an
   early warning for the 057 failure class
3. **Coalesced, delta-based style sync** — Turbopack HMR replaces `<style>` tags
   constantly; never re-clone the head wholesale. Rule: marker-tracked incremental
   add/remove, batched to one sync per animation frame, observer connected **only
   while a frame is mounted**
4. **Transform-only, stepped zoom** — `transform: scale()` on the frame wrapper
   invalidates paint/composite only (width/font-size/CSS-`zoom` zoom would force
   iframe content reflow; continuous slider would re-raster the iframe surface per
   frame → the reason free zoom stays out of scope). No `will-change` on the frame.
   Side benefit: the iframe's CSS viewport stays exactly 390px at every zoom level,
   so breakpoints never shift while zooming
5. **Fit-loop guard** — fit output is always a transform (transforms don't affect
   layout, so the ResizeObserver can't be re-triggered by our own output) + a no-op
   guard that recomputes only when stage/device/zoom values actually changed
6. **Idempotent lifecycle** — Strict Mode double-mounts effects in dev: setup and
   teardown must be exact inverses (`disconnect()` observer, remove iframe, null
   refs — safe to call twice) or leaked documents/observers drain CPU silently
7. **No double React tree** — the portal **moves** the canvas subtree; keeping an
   "instant-switch inline copy" would mean two `Renderer`s (double render, double
   streaming, double listeners). One tree, one mount
8. **Default path pays nothing** — Desktop = current inline canvas: no iframe, no
   observer, no style cloning; the feature's code paths don't execute unless a
   preset is chosen (also why the 114 existing e2e tests stay untouched)

## Steps

1. **Device frame** — `lib/playground/device-preview.ts` store (presets + persistence,
   model-store pattern) + TopBar picker (icon + Popover, radio semantics, i18n) +
   `device-frame.tsx`: readiness lifecycle (R2), delta style mirroring (R4,
   safeguards 2–3), portal of scroller + overlays with the R3 global-API fixes
   (`elementFromPoint`, keydown realm), backdrop + size label; e2e: preset provably
   flips media queries inside the frame, pick inside → panel outside, back to
   Desktop inline
2. **Zoom & fit** — transform-only stepped zoom with R5 policy (fit formula on the
   unscaled stage, clipping at fixed % > stage, scaled-space reservation), no-op
   guard, canvas scroll-offset restore across transitions (R1); unit tests for fit
   math + store persistence
3. **Polish & verification** — custom W×H validation, a11y (iframe title, picker
   keyboard/ARIA, focus flow), portal-leakage characterization test (R6), frame-open
   tripwire + FPS spot-check, MCP spot-check, full gate chain, plan bookkeeping

## Verification

- [ ] `bun run format && bun run lint && bunx tsc --noEmit && bun run test`
- [ ] Unit: fit-scale math (stage size × device size × zoom step clamp), preset
      constants, store persistence (write → read → fallback on corrupt value),
      custom W×H validation/clamping
- [ ] e2e: activate Mobile → an `iframe` exists with width 390; **inside the frame**
      (`frameLocator`) the Pokédex-style responsive grid no longer applies `lg:`
      styles while the inline view does (media queries provably follow the frame);
      pick an element inside the frame → edit panel opens outside; overlay selection
      ring lands on the element; switching back to Desktop removes the iframe and the
      canvas renders inline
- [ ] e2e: existing 114 stay green (Desktop default → inline rendering untouched)
- [ ] Zoom: Fit recomputes when the edit panel docks (stage resize); % steps change
      the frame scale without changing the iframe's CSS viewport width
- [ ] Frame-open timing tripwire — **defined**: starts at preset activation
  (initializing), ends at the first layout inside the iframe after its stylesheets
  have applied (first rAF following ready; **fonts excluded** — `document.fonts.ready`
  gates readiness separately). Primary in development mode, probe reusable in prod.
  ~50ms is a **regression tripwire for CSS bloat, not a budget**; reported separately
  from FPS (a fast first layout ≠ correct or interactive render) (safeguard 2)
- [ ] State preservation (R1): Desktop → Mobile → Desktop **during selection, an
  in-progress edit, and active streaming** → required state survives, no duplicate
  subscriptions/listeners/streaming ops; canvas scroll offset restored across the
  transition; canvas-local draft behavior verified as intended (`controlled-input-drafts`)
- [ ] Iframe readiness (R2): delay stylesheet loading and switch presets rapidly →
  no stale mount into a superseded iframe, no unhandled async work, no
  partially-initialized state reported as ready; failure surfaces an error state
- [ ] Coordinate correctness (R3): select, hover, and drag elements at 50 / 100 /
  150% zoom; overlay geometry aligned; correct when the edit panel docks; global-API
  audit passes — `elementFromPoint`/keydown and any other global use goes through
  `ownerDocument`/`defaultView` (the two codebase findings in R3 are fixed)
- [ ] Style parity (R4): fonts, relative assets, dark/light theme, stylesheet
  ordering after insert/remove/replace, and HMR updates all correct inside the
      iframe with no duplicate or stale stylesheets
- [ ] Scaled layout (R5): frames smaller and larger than the stage in both
      dimensions → correct centering, documented clipping at fixed % > stage, Fit
      recalculation on stage resize; iframe CSS viewport unchanged at every zoom
- [ ] Teardown (R2/safeguard 6): repeatedly enter/leave device-preview mode in dev —
      pending work, observers, and event listeners cleaned up; document node and
      observer counts stay stable (Strict Mode double-mount)
- [ ] a11y: iframe carries a `title`; picker is keyboard-operable with radio
      semantics; focus flow into/out of the frame behaves sanely
- [ ] Portal-leakage characterization (R6, known limitation): with a preset active, a
      spec-driven Radix overlay (Select/Dialog) mounts in the parent body — assert
      the documented behavior so follow-up F16 has a failing/passing reference
- [ ] FPS spot-check per `css-safelist-performance.md` protocol — **control arm
      (inline Desktop) measured first, DevTools open** (the reported condition;
      DevTools-closed reads ~120 on every variant): rapid preset cycling
      Mobile↔Tablet↔Desktop must not regress the 057 baseline (~64 FPS, 0 frames
      >100ms). Two prior FPS runs were invalidated by measuring with DevTools closed
      — follow the protocol exactly; never `bun run build` while `next dev` serves
      the same `.next` (mistake #23)
- [ ] MCP spot-check: real spec at Mobile → screenshot showing single-column layout,
      size label correct; back to Desktop → identical to pre-preview state
- [ ] i18n: en/es keys present for picker/label strings

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-27 | plan drafted (draft) — lessons grepped (`css-safelist-performance`, `ui-design-implementation`), json-render skill loaded, canvas structure + real-spec breakpoints audited; 4 clarifying questions answered (all recommended options) |
| 2026-10-27 | performance discussion — **Performance safeguards** section added (8 binding constraints) + frame-open timing, protocol-correct FPS spot-check and Strict-Mode lifecycle verification items; roadmap decisions (composition = copy-expand + provenance, projects = A1+A2+A3) recorded in `docs/follow-ups.md` F14/F15 |
| 2026-10-27 | external review (ChatGPT) folded in as **Architecture refinements R1–R5** — subtree remount/state preservation, iframe readiness state machine, coordinate/global-API audit (**2 real hazards verified in code**: `document.elementFromPoint` + global `window` keydown), stylesheet parity (in-place mutation catch), scaled-frame layout + explicit Fit/percent policy; verification extended accordingly, timing tripwire precisely defined |
| 2026-10-27 | gap sweep — **R6 portal leakage** found in code (`@json-render/shadcn` uses `Portal(…)` 10×, Radix targets `globalThis.document.body` → spec overlays would escape the frame): v1 known limitation + follow-up F16; R3 audit extended (`matchMedia`, observer realm, `getComputedStyle`); added a11y scope, input-modality out-of-scope (viewport ≠ touch fidelity), picker availability, and a **Steps** section (3-step commit breakdown) |
