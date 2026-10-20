# Scrollable Single-Row Carousel — Implementation Plan

**Status:** implemented
**Date:** 2026-10-07

## Goal

Model-generated carousels must render as a **single non-wrapping row** at every viewport, with a horizontal scroll container so cards beyond the fold remain reachable — today a carousel with 8 items on `grid-cols-4` silently wraps into 2 rows and stops being a carousel. This closes the gap with one prompt rule, compile coverage for the scroll-pattern classes models will need, a probe that pins the behavior, and one real-API generation verified at mobile width.

## Scope

### In scope

- **A. Prompt rule** (in `lib/playground/styling-rules.ts`, shared by generate + steer):
  - Carousel-style sections (product rows, card decks, galleries) = one non-wrapping row inside a scroll container: `flex` + `overflow-x-auto` + `snap-x` with `shrink-0 min-w-*` cards (or `grid grid-flow-col auto-cols-*` + `overflow-x-auto`)
  - **A-structure** *(added 2026-10-07, from the 3.5 Lite live test)*: when cards come from state, the `repeat` goes on the **scroll container** with each repeated child being one full card — never on the card itself (Lite put it on the card → 8 products stacked inside one card inside a 1-child container that never scrolled)
  - Never express a carousel as a wrapping grid (`grid-cols-N`) — wrapping grids are for galleries/tables, not carousels
  - Cards get fixed width via **named** tokens (`min-w-64`, `min-w-72`, …) per the existing A2 named-over-arbitrary rule
- **B. Compile coverage** in `app/globals.css` `@source inline` (observed-evidence enumeration, same trimmed approach as B2):
  - scroll/snap set: `overflow-x-auto`, `overflow-x-scroll`, `scroll-smooth`, `snap-x`, `snap-start`, `snap-end`, `snap-always`, `snap-mandatory`, `snap-proximity`
  - non-shrinking row: `shrink-0`, `grow-0`, `flex-nowrap`, `grid-flow-col`, `auto-cols-{min,max,fr,3xl,2xl,xl,lg,md}`
  - card widths: named `min-w-{0,16,…,96}` (full named scale), plus observed arbitrary `min-w-[240px|260px|280px|300px|320px]`
  - named `max-w-{48,52,56,60,64,72,80,96}` *(added 2026-10-07)* — Lite paired `min-w-72 max-w-72` for fixed cards but only `max-w-{xs…3xl}` compiled
  - arbitrary `max-w-[240px|260px|280px|300px|320px]` *(added 2026-10-07)* — steer run emitted `min-w-[280px] max-w-[280px]` but only min-w compiled → cards stretched `w-full` (1167px each, 1 visible per view)
  - edge-bleed idiom often emitted with carousels: `-mx-*`/`px-*` pairs already partially covered — verify and add the `-mx-{4,6}` forms if missing
- **C. Probe**: new e2e case in `e2e/runtime-classes.spec.ts` — 8 fixed-width cards in `flex overflow-x-auto snap-x` → assert (a) all 8 card rects share the same y (single row, no wrap), (b) `scrollWidth > clientWidth` (actually scrollable), (c) last card x is beyond client width (hidden content exists)
- **D. MCP live check (real API)**: generate an 8-card carousel prompt at a mobile viewport (~390px) → verify one row + horizontal scroll (scroll to end, 8th card visible), then desktop width → still one row (scrolls); light + dark both readable
- **Example-prompt chip** *(added 2026-10-07)*: expose the tested 8-card carousel prompt on the empty state (`example-prompts.ts`) so the pattern can be re-tested with one click
- **E. Derived render-time scroll-layout fixup** *(added 2026-10-07 from the cross-model test, see design decision 5)*: the shadcn `Stack` renderer hardcodes `flex-row flex-wrap` for `direction: horizontal`, and parent Stacks default to `items-start` — prompt compliance alone can never guarantee a single scrollable row (1/5 models emitted `flex-nowrap` unprompted; without a width-definite ancestor chain the container's `w-full` resolves circularly against fit-content parents — measured: 2332px-wide container, whole canvas scrolled). `fixupScrollLayout` (`lib/playground/scroll-layout-fixup.ts`) produces a derived render copy of the spec at the `Renderer` feed in `page.tsx`: every `overflow-x-auto/scroll` element gets `flex-nowrap` + `w-full` (unless it sets `w-*`) + `min-w-0` (unless `min-w-*`), and every spec ancestor gets `w-full` when it declares no width — the stored spec, editing, and history all keep operating on the model's original output. The rule text now explains the injection and requires those classes. Unit-pinned in `scroll-layout-fixup.test.ts`
- **F. Cross-model comparison report** *(added 2026-10-07, user directive)*: capture the carousel prompt against ≥4 models through the real `/api/generate` endpoint (script `responses/capture.ts`, raw JSONL + folded spec + analysis per model under `responses/`), measure each captured spec in the playground UI before/after the fix, and write `docs/plan/013-scrollable-carousel/model-comparison.md` — API responses, analyses, UI verdicts, and the conclusion on whether the failure is a model limitation or a renderer/prompt problem. **Pending as of this commit** (captures + verification done; report not yet written)
- Update this plan's status log + verification on completion

### Out of scope

- Retrofitting the stored "Richard's Favorites" history entry — future generations adopt the pattern; existing drafts can be steered manually (descoped 2026-10-07, user chose full scope without retrofit)
- Custom scrollbar styling / hide-scrollbar utilities — cosmetic, not required for reachability (descoped 2026-10-07)
- Carousel *behavior* (arrows, dots, autoplay, drag-to-scroll) — that is component interactivity, not layout; scroll container alone satisfies reachability (descoped 2026-10-07)
- Wrapping on large screens — user decision: always a single row at every viewport (2026-10-07)

## Design decisions

1. **Single row at every viewport, scroll on overflow** — rejected: wrap into rows above `lg`, because it splits carousel semantics by breakpoint and doubles the prompt rule's conditional surface; user decision 2026-10-07
2. **Prompt steers the pattern, CSS only guarantees the classes** — rejected: forcing scroll layout post-generation (spec rewriting), because it mutates model output outside the patch/steer path and is brittle; the prompt rule already proved effective for dual-theme (feature dual-theme-generation)
3. **Coverage via trimmed `@source inline` enumeration, not exhaustive arbitrary space** — same decision as dual-theme #6: enumerate the scroll-pattern forms models plausibly emit (named min-w scale + a few observed arbitrary widths), let prompt rule A2 keep output in named tokens
4. **Probe asserts geometry, not class strings** — same rationale as dual-theme #3: same-y + scrollWidth checks prove the visible behavior (one row, scrollable) regardless of which syntactic variant (`flex` vs `grid-flow-col`) the test fixture uses
5. **Derived render-time fixup, not spec rewriting or prompt-only** *(2026-10-07, cross-model test)* — rejected: prompt-only, because the renderer injects `flex-wrap` itself and only 1/5 models counteracted it with an explicit `flex-nowrap`; rejected: mutating the stored spec (decision 2's concern stands — editing/history keep the model's original output); rejected: a registry-level class guard for the container alone, because `w-full` on the container is circular unless the ancestor chain is width-definite too, and ancestors are only reachable from the spec. The fixup sits at the single `Renderer` feed, applies to generate/steer/edit/restore alike, is reference-stable when it changes nothing, and only touches classNames of scroll containers and their ancestors

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build && bun run test:e2e` — all green (**143 unit / 32 e2e**)
- [x] Unit: styling-rules test pins the carousel clause — single row, `overflow-x-auto`, `shrink-0 min-w-64`, `grid-flow-col`, no wrapping grid, named `min-w-*`, plus the `NEVER add flex-wrap` strengthening (7th test)
- [x] e2e: 8-card single-row + scrollable probe passes (one row via same-y, `scrollWidth > clientWidth`, card 8 beyond edge, `min-w-64` = 256px, `grid-flow-col`/`auto-cols-min`/`min-w-[260px]` variants); no existing probe regresses (32/32)
- [x] MCP (real API, 3.7 Flash): gen #1 hedged with `flex-wrap` + `overflow-x-auto` → wrapped into 3 rows at 390px, never scrolled → rule strengthened (`NEVER add flex-wrap … not even for small screens`), gen #2 full adherence: `flex-nowrap overflow-x-auto snap-x snap-mandatory scroll-smooth shrink-0 min-w-64` — at 390px: 8 cards one row (all y=155), scrollable 2652>310, scroll-to-end brings card 8 to 97% visible (snap-aligned); at 1280px: still one row, scrollable 2652>1200; dark screenshot verified fresh (body lab(2.75), cards lab(7.78)); light verified via computed probes (no `.dark` anywhere, body/cards/chrome `lab(100)`, button `aria-label="Switch to dark mode"`) — MCP screenshots were persistently stale for the light state (mcp-verification failure mode; evaluate is ground truth)
- [x] Example-prompt chip added and verified in the a11y snapshot (5th chip on the empty state)
- [x] CSS size delta: 3,095,385 → **3,097,247 raw / 231,444 gzip** (+1,9 KB raw / +439 B gzip)
- [x] Cross-model capture: 5/8 models captured through the real endpoint (3.1-lite, 3.5-lite, 3.5/3.6/3.8 Flash); 3.7 Flash timeout ×3, 3-Flash & 2.5-Flash 503 — raw/spec/analysis artifacts in `responses/`
- [x] Pre-fix UI verdicts: 5/5 FAIL — 3.1-lite/3.5-lite/3.6-flash wrapped (4 rows), 3.5-flash single row but 2228px container with canvas-level scroll (3.8-flash measured post-fix only)
- [x] Post-fix UI verdicts: **5/5 PASS** — heading-confirmed, 8 cards, one row, `nowrap`, container scrollable at viewport width (contW 625, scroll 2132–2480 > 625); chain green (**158 unit / 32 e2e**, build OK)
- [ ] `model-comparison.md` report written (scope F — pending)

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-07 | plan drafted (scope confirmed via question tool: always-one-row + full scope incl. live test) |
| 2026-10-07 | approved — plan committed (`9d9724d`) before code |
| 2026-10-07 | live test #1 exposed `flex-wrap` hedge → rule strengthened + unit-pinned, same turn |
| 2026-10-07 | implemented — chain green (143 unit / 32 e2e), live gen #2 full adherence at 390px + 1280px, chip added |
| 2026-10-07 | cross-model test (user directive): 5/8 models captured → root cause = Stack injects `flex-wrap` + circular ancestor widths; scope E + decision 5 added |
| 2026-10-07 | implemented E — derived `fixupScrollLayout` at Renderer feed; 5/5 captured specs verified single scrollable row post-fix (158 unit / 32 e2e); one stale-uid measurement caught and re-measured with heading-confirmed identity |
