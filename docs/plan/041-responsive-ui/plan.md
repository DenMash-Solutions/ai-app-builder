# Responsive UI — mobile/desktop parity for generated UIs + gallery bug fixes — Implementation Plan

**Status:** implemented (T1–T6 done; full gate green 2026-10-17)
**Date:** 2026-10-16

## Goal

Every generated UI renders well on mobile (~375 px) and desktop (~1440 px) at all three surfaces (playground canvas, preview, live/published), and the three observed gallery bugs on `890bddee` are fixed: (1) items grouped into one card, (2) pagination pages running to −1 / past the end, (3) items not filling the container.

## Context (research findings, verified 2026-10-16)

- **Repeat semantics (bug 1 root cause).** `@json-render/react` v0.21.0 renders `element.repeat` by keeping the element **singular** and repeating **its children** per item (`ReactiveElementRenderer`: `children = repeat ? <RepeatChildren/> : renderChildKeys(...)`; `RepeatChildren` maps `element.children` under `RepeatScopeProvider`). Our own fixture documents it: `e2e/msw/fixture.ts:586` — *"The renderer repeats the repeated element's children, not the element itself."* Therefore **grid cells require `repeat` on the Grid container** (`filter-grid` does this at `fixture.ts:195`).
- **Spec `890bddee` evidence.** `repeat` sits on `icon-card` (the item template) → preview DOM is `div.grid.grid-cols-3` with **one child** (the Card) containing 6×(icon + label) — all items grouped in a single card, two of three columns empty. Round 1 of the organic run put `repeat` on the Grid, round 2 on the Card — **same rules, different reading**: the D7/D8 bullets only say *"the list's `repeat` reads …"* and never name the element. Test gap: `icons.spec` counts `svg.lucide` anywhere in the canvas, so grouping vs shopping is invisible to it.
- **Bug 2 (page bounds).** `sliceItems` clamps the *slice* (grid never blanks) but `/page` state is unbounded; the indicator is `$template: "Page ${/page} of 2"` which reads raw state and cannot compute (`$template` interpolates state refs only; expressions have no conditionals). Organic observations: "Page 3 of 2", Previous → −1.
- **Bug 3 (full-size items) = three stacked causes.** (a) bug 1 empties 2 of 3 columns; (b) the shadcn `Grid` renders **fixed `grid grid-cols-{n}`** at every viewport (computed `135.805px ×3` in a 431 px container) — no responsive behavior exists; (c) model-authored constraints (`max-w-5xl mx-auto`, content-hugged stacks, fixed px widths) need prompt guidance.
- **Existing leverage.** Registry override precedent: Button/Input already overridden in `lib/playground/registry.tsx` (`withStyleProps` merges `className`/`style`). Function plumbing exists: `PLAYGROUND_FUNCTIONS` is auto-listed in the prompt and passed to all three `JSONUIProvider`s. `visible` supports `{"$state": "/page", "gt": 0}` (visibility operators accept literals or `$state` RHS). `columns`/`gap` props of the shadcn Grid def to be re-read at implementation time.
- **Verification tooling.** MCP `emulate({viewport})` + `take_screenshot` for visual checks (`resize_page` did not move `innerWidth` in-session — `emulate` is the reliable lever); Playwright viewport tests assert computed `grid-template-columns` (single track at 375, `columns` tracks at 1280).

## Decisions

1. **D1 — Scope: generated UIs only.** Catalog components + rules at canvas/preview/live. The app shell (playground sidebar/editor chrome on phones) is a **separate follow-up plan**; the playground is a desktop-first authoring tool.
2. **D2 — Bug 2 via two registered functions** (rides `PLAYGROUND_FUNCTIONS`, zero wiring):
   - `stepPage({ page, source, limit, delta })` → clamped new page: `page + delta` (non-number → 0 / delta → 0) bounded to `[0, maxPage]` with the same fallbacks as `sliceItems` (invalid limit → whole source; non-array source → 0). Press actions become `setState /page = {$computed: stepPage, …}` then the existing slice action (each binding reads fresh state). `/page` can never leave range — `sliceItems`' clamp stays as belt-and-braces.
   - `pageLabel({ page, source, limit })` → `"Page 1 of 2"` (1-based, correct total) used as a `Text` `text` prop instead of the un-computable `$template`.
   - Polish: Previous hidden at page 0 via `visible: {"$state": "/page", "gt": 0}` (one rules sentence; Next needs no hiding — `stepPage` bounds it).
   - Rejected: nested `$math` min/max/ceil chains (JSON too fragile for lite models), display-only fix (state still −1).
3. **D3 — Responsive `Grid` via registry override** (same precedent as Button/Input): `columns` is the **desktop target** — `n ≤ 1` → `grid-cols-1`; `n = 2` → `grid-cols-1 sm:grid-cols-2`; `n ≥ 3` → `grid-cols-1 sm:grid-cols-2 lg:grid-cols-{n}`; `gap` unchanged; `className`/`style` still merged via `withStyleProps`. Horizontal control rows (pagination) get `flex-wrap` from a **rules sentence**, not a component override. Rejected: `repeat(auto-fill, minmax(...))` — fills any width with ~9 columns when the model asked for 3 (violates intent, untestable against `columns`).
4. **D4 — Showcase: steer-edit `890bddee` in place.** After fixes land, use the playground's edit/steer flow on that same entry (keeps id/url; **exercises the new rules organically in edit mode**), then verify at emulated 375 and 1440 with screenshots. Manual canvas edits are the fallback if steer misbehaves. The Grid override improves the entry with **no spec change** (that's the layering payoff); steer fixes the repeat placement + pagination wiring.
   - **Fallback triggered (2026-10-17):** `890bddee` unrecoverable — browser restart wiped localStorage; `uis` has no matching row; `published_pages` empty for the slug. Showcase = fresh organic generation (model 3.5 Flash Lite) exercising the new rules; verified below.
5. **D5 — Task/verification structure T1–T6** (below): rules first (they gate the showcase), functions + Grid override in parallel, showcase, e2e regressions (grid-children count, viewport computed styles, page-label edges), full gate.

## Out of scope

App-shell/editor responsive redesign · locale-aware `pageLabel` copy (i18n follow-up; English "Page X of Y" for now) · auto-fill grid strategy · component overrides for Stack/Row (wrap guidance lives in rules) · `columns` semantics beyond the ladder (e.g. per-breakpoint arrays) · Lighthouse/mobile-UX scoring as a gate.

## Tasks

- [x] T1 (D1/D3) Rules: amend the D7/D8 bullets' repeat phrasing to **name the container** ("`repeat` lives on the Grid/Stack whose children are the per-item template — never on the item element") + add a **responsive section** (full-width sections, `w-full` inputs, `flex-wrap` on horizontal control rows, padding pairs like `p-4 md:p-6`, `columns` = desktop target) + the Previous-at-0 `visible` sentence. Unit: rules contain all of it.
- [x] T2 (D2) Functions: `stepPage` + `pageLabel` in `computed-functions.ts` (registered via `PLAYGROUND_FUNCTIONS`). Unit: clamping both ends, delta/non-number fallbacks (parity with `sliceItems`), label 1-based/total correct, prompt lists both names.
- [x] T3 (D3) Grid override: responsive ladder from `columns` in `lib/playground/registry.tsx` (+ whatever the shadcn Grid def/impl needs re-reading first). Unit: rendered class list per `columns` value (1/2/3/5) + `withStyleProps` merge preserved.
- [x] T4 (D4) Showcase: fresh organic generation (fallback D4 — `890bddee` unrecoverable), steer-repair of the pagination in the UI, verify search + pagination + screenshots at 375/1440 (MCP emulate). Record spec delta + screenshots in the status log.
- [x] T5 e2e regressions: (a) **grid children == rendered item count** (grouping bug — on the existing filter fixture, canvas + preview); (b) viewport: computed `grid-template-columns` single track at 375, `columns` tracks at 1280; (c) pagination edges: Previous at start stays `"Page 1 of …"`, Next past end stays on the last page.
- [ ] T6 Full gate (`format, lint, tsc, unit, build, e2e`) → `Status: implemented`.

## Verification

- [x] Unit: `stepPage`/`pageLabel` semantics + prompt listing + rules sentences (repeat placement, responsive, visible-at-0).
- [x] Unit: Grid override class ladder per `columns`; style-props merge intact.
- [x] e2e: grid-children == item count; 375 vs 1280 computed grid tracks; page-label edge behavior.
- [x] Showcase: fresh generation + steer-repair, verified at 375/1440 (search narrows, paging bounded, items fill columns), screenshots recorded live.
- [x] Full gate green (format, lint, tsc, unit, build, e2e — 426 unit, 91 e2e).

## Follow-ups (discovered during T4, out of this plan's scope)

- **Generate mode drops malformed JSONL lines silently.** Gemini lite models emit the `Button` `on.press` (two-action array) line with one missing `}` — reproduced 3/3 on 3.5-lite and 2/2 on 3.1-lite; `useUIStream`'s `parseLine` swallows the `JSON.parse` failure → element never lands → "Missing element" warnings (search in 3.1-lite runs, prev/next buttons in all runs). Edit mode is protected (`validatePatchText` buffers, validates, retries once — and indeed the steer produced clean lines); generate mode streams blindly. Candidate fix: server-side line validation + targeted repair/retry in generate mode. Worked around in the showcase via a plain-language steer (user-directed: "ask the model to fix it" through the UI).

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-16 | goal set (mobile/desktop responsive generated UIs + 3 gallery bugs on `890bddee`); recon proved root causes — repeat semantics (container repeats its children: source + fixture comment), rules never name the repeat element (round1 grid vs round2 card), `/page` unbounded (`$template` can't compute), shadcn `Grid` fixed-cols at all viewports; decisions D1–D5 drafted (scope, `stepPage`+`pageLabel`, ladder override, steer showcase, T1–T6) — **plan awaiting approval** |
| 2026-10-17 | plan approved; T1 rules (repeat-placement + responsive + rewritten pagination bullets), T2 `stepPage`/`pageLabel` + 51 unit tests green, T3 `GridImpl` ladder wired |
| 2026-10-17 | T5 e2e green (grid-children count, pagination edges, viewport ladder) — during which a **real app bug** surfaced and was fixed: `app/[locale]/[slug]/preview-client.tsx` was missing `functions={PLAYGROUND_FUNCTIONS}` on its `JSONUIProvider` ($computed props rendered empty on preview/live) |
| 2026-10-17 | finding: renderer wraps each repeated child in `<span data-jr-key style="display:contents">` on playground surfaces only (editor affordance); preview/live render plain divs — e2e counts labels per grid, surface-agnostic |
| 2026-10-17 | T4 showcase: `890bddee` unrecoverable (localStorage wiped, no DB row) → fresh organic generation on 3.5 Flash Lite. Generation rendered grid + `w-full` search + `pageLabel` ("Page 1 of 2") + responsive ladder (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`) but prev/next Button ops were **malformed JSON at the wire** (missing `}` — see Follow-ups) and got silently dropped. User-directed repair: plain-language steer in the playground UI ("the Previous and Next buttons disappeared…") → edit mode emitted a clean 2-op patch → Previous hidden at start via element-level `visible`, Next clamped by `stepPage`, live search re-pages via container `watch`; screenshots verified at 375 (1 column) and 1440 (3 columns) |
| 2026-10-17 | T6 full gate green: format, lint, tsc, 426 unit, build, 91 e2e. Note: the first e2e run failed3 `authed` tests (sync push stuck on "Syncing to your account…") **while the signed-in MCP showcase browser sat on localhost:3000** — its sync polling + realtime connections contended on the shared free-tier Supabase project; navigating the MCP page off the app made all91 pass. Lesson: park the MCP session (`about:blank`) before running authed suites |
