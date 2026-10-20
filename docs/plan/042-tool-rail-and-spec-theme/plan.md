# ToolRail "Add language" + spec-driven theme — Implementation Plan

**Status:** implemented (rev 3; rev 2 before it)
**Date:** 2026-10-17

## Goal

1. The **Add language** action moves to the ToolRail as its **single home** (the TopBar popover entry is removed), so it is always reachable on any open spec — today it hides with the Content language pill whenever `hasCopy` is false (observed on an imported spec with empty `state.copy` but an existing `i18n.es` layer).
2. **Generated UIs get first-class theme switching, spec-driven like language**: the spec carries the theme, a catalog component toggles it, every surface applies it, and **the user's toggle decision is persisted** so a visitor who picks dark keeps dark on return. Today a generated UI can only follow the app-shell theme (`dark` on `<html>`); no spec state, no component, no action.

## Context

- ToolRail renders whenever `displayedSpec && !isStreaming` (`playground.tsx:1308`) — the always-on home for the action. `AddLanguageDialog` is already wired via `addLangOpen` (`playground.tsx:201`).
- Language precedent to mirror (decision 13 in `lib/i18n/language-switcher.ts`): a **declared catalog action** (`switch_language`, declared in `catalog.ts:125` actions block) + a state convention (`state.locale`) + surface-supplied handlers (`playground.tsx:454`, `preview-client.tsx:85`, `live-page.tsx:79`; static `spec-page`/`bake` pass `handlers={{}}`).
- **`ThemeInit`** (`components/theme-init.tsx`, rendered in `app/[locale]/layout.tsx:56`) runs on **every route incl. public pages**: a pre-paint inline script that adds `dark` to `<html>` when `genui-theme` is stored. Persistence + no-flash for the user's decision already exists; nothing on a public page has ever *written* it (chrome-less pages have no toggle).
- **`classifySpec`** (`lib/publish/bake.tsx:30`): a spec with `on`/`watch`/`$bindState` is `stateful` → served with the client engine (handlers run); interaction-free specs bake to pure static markup.
- Theme plumbing (`lib/theme/theme.ts`): app-level `genui-theme` localStorage + `dark` class on `<html>` — chrome concern; `theme.test.ts` covers the read/write helpers.
- CSS: `@custom-variant dark (&:is(.dark *))` (`app/theme-tokens.css:1`) — a `dark` class on ANY ancestor scopes tokens to its subtree, so the canvas can go dark while app chrome stays light.
- Component precedents: `Icon` (app-side catalog definition in `catalog.ts` + renderer impl) and `GridImpl` (override wired through `registry.tsx`). The Button props schema has no icon slots (T4 lesson) — a dedicated `ThemeSwitcher` component is the right surface for a sun/moon affordance.

## Decisions

1. **D1 — Rail is the single home.** `ToolRail` gains `onAddLanguage` + a Languages icon button (reuses i18n key `editor.contentLang.add`, no keyshortcuts) above Clear, wired to `setAddLangOpen(true)`. Available on every displayed spec — imported, empty-copy, whatever. The **TopBar popover row and its `onAdd`-style prop are removed** from `ContentLanguageSwitcher`; the pill keeps its `hasCopy` gate (it is about *switching* copy languages). The i18n e2e journey is updated to open the dialog from the rail (same dialog, same searchable picker assertions). — *partly superseded by rev 3 below: the icon button is replaced by a current-language trigger that carries the popover, and the Add row returns inside it.*
2. **D2 — Theme = spec state + declared action + component** (language's shape):
   - **State convention:** `spec.state.theme: "light" | "dark"` — the spec's theme lives and persists with the spec (entry + publish).
   - **Catalog action:** `SWITCH_THEME_ACTION = "switch_theme"`, params `{ theme: { $state: "/theme" } }` — declared in the catalog actions block next to `switch_language`.
   - **Component:** `ThemeSwitcher` — app-side catalog definition (zod props: optional `size`, extends STYLE_PROPS; event `change`) + renderer impl: ghost icon button showing Sun when the bound value is `dark` (switch to light) and Moon when `light`; value read/written via `{ $bindState: "/theme" }`; press flips the bound value and emits `change` so the model's binding (`switch_theme`) dispatches. Rules document the canonical one-binding wiring, same as the language switcher.
3. **D3 — Effective theme + persistence per surface** (refined during implementation):
   - **Public routes (live root, published `/{locale}/{slug}` serving):** effective theme = **stored user decision (`genui-theme`) if present → else `spec.state.theme` → else light.** Pre-paint: `ThemeInit` already applies the stored decision; `SpecThemeInit` (new) applies the **spec default only when no decision is stored** — rendered from the client components, which SSR-render, so the script lands in the served HTML (no flash; CSS-only for static content pages). The `switch_theme` handler **persists the visitor's decision** to `genui-theme` — the directive: a user who picks dark keeps dark across visits (and site-wide, same key `ThemeInit` honors).
   - **Preview `/{locale}/{slug}` — both audiences, one rule:** the route is chrome-less, so it themes `<html>` for owners and visitors alike (decision > spec default, seeded into `state.theme` client-side; SSR renders the spec default and the pre-paint scripts already painted the frame). A `ThemeHtmlSync` inner component keeps `<html>` on the seeded state. **Persistence is the only split**: serving the published projection (visitor) writes the decision; an owner's toggle is session view state — the spec's default owns what returns on reload.
   - **Playground canvas (author context):** `CanvasContent` wraps the design in the scroll container with a reactive `dark` class (`useStateValue("/theme")`, hook `data-canvas-surface`) — scoped, app chrome unaffected; no `genui-theme` write.
   - Pure-static `content` pages stay `handlers={{}}` (no toggle exists; theme applies pre-paint).
4. **D4 — Rules:** one styling-rules bullet: when the user asks for dark/light theme switching, seed `"theme"` in state, place `ThemeSwitcher` bound to `/theme` with the `switch_theme` change binding, and keep sections on theme tokens (`bg-background`, `text-foreground`) so both themes read well.
5. **Rejected:** reusing the app-shell toggle as the mechanism (chrome concern — violates "the spec must handle it"); per-spec "lock theme, ignore visitor pref" flag (out of scope below); scope-per-design visitor keys (one site-wide decision, same as the app's); a scoped `.dark` wrapper on the preview route (SSR can't know owner-vs-visitor — `entry` resolves client-side — so the pre-paint script must key off `published`; the chrome-less route themes the page for everyone and persistence carries the audience split).

## Out of scope

- Per-spec theme lock (author forcing their theme over a visitor's stored decision) — follow-up if asked.
- Theme-aware `i18n` overlays (themes don't translate).
- App-shell mobile redesign (existing responsive-ui D1 follow-up).
- Playground/preview writing `genui-theme` (author context — spec state is the persistence).

## Tasks

- [x] T1 ToolRail: `onAddLanguage` prop + button + playground wiring; **remove** the popover Add row + `ContentLanguageSwitcher` prop; update `i18n.spec.ts` journey to open via the rail (also `authed.spec.ts`'s feature/unfeature journey, which opened the picker from the popover); e2e also covers the rail on an empty-copy spec (must be **text-free** — `normalizeSpecCopy` lifts element text into `state.copy` at ingest, so any spec with a string gains copy).
- [x] T2 Theme core: `switch_theme` action declaration + `ThemeSwitcher` catalog definition + renderer impl + registry wiring; unit: definition/impl per value (sun/moon) + `$bindState` round-trip. Impl split into a pure `ThemeSwitcherButton` (forwards `className`/`style` — `withStyleProps` clones the returned element) + a hooked `ThemeSwitcherImpl` shell.
- [x] T3 Surfaces: scoped wrapper (canvas — `data-canvas-surface` hook) + `<html>` application and **spec-default pre-paint script** (`SpecThemeInit`, rendered whenever `published` is served so it lands in the SSR HTML; `entry` resolves client-side on the slug route) + `ThemeHtmlSync` on the preview, + handlers, incl. **persisting the visitor's decision** to `genui-theme` on public routes; unit: effective-theme helper (decision > spec > light) + persistence; e2e: fresh visitor sees spec theme → toggle → survives reload → stored decision beats a changed spec default; preview honors spec theme.
- [x] T4 Rules bullet + prompt listing; unit assertions.
- [ ] T5 Full gate (format, lint, tsc, unit, build, e2e) → `Status: implemented`; commit after user's go-ahead.

## Rev 3 — language control moves from the TopBar into the rail

**Scope (user-directed):** in the ToolRail the language button must **show the current language instead of an icon**, and the **popover moves from the top** (desktop pill + mobile overflow row) **to the rail**. "Add language…" becomes a row inside that moved popover (user's choice: a single rail control).

**Decisions**

- **R3-D1 — one rail control.** `ContentLanguageSwitcher` becomes rail-only: its trigger is an icon-size rail button displaying the **current content language uppercase, truncated** (pending spinner + missing-count badge kept), aria-label stays `editor.contentLang.title`. The popover opens `side="left"` / `align="start"` — the rail hugs the right edge, so the menu opens inward over the canvas.
- **R3-D2 — "Add language…" returns as a popover row** (the same row rev 2 removed, same key `editor.contentLang.add`, same dialog; the popover closes before the dialog opens — stacked focus, existing pattern). The rail stays Add's single home — D1's intent holds, only the mechanism changes: rail trigger → popover row → dialog.
- **R3-D3 — reachability: the rail control is NOT `hasCopy`-gated.** `contentLangProps` builds unconditionally; on a spec without copy `languages` falls back to `[seedLang]`, and the translate/revert rows self-hide (`missing = 0`, `canRevert = false`) — leaving switch (seed only) + Add. This preserves rev 2's fix: a copy-less spec can still reach "Add language…".
- **R3-D4 — TopBar loses the SPEC content language only.** The user's boundary (approval note): **the TopBar controls the app shell and keeps its own language** — `LocaleSwitcher` (app locale en/es), `ThemeToggle`, `ModelSwitcher`, `History`, sync dot all stay, in both the desktop cluster and the mobile overflow menu. What leaves is the **spec** content-language UI: the desktop pill and the mobile `variant="row"` row. **ToolRail = spec controls only** (Pick/Drag/X-ray/Clear + now the spec's content language). With both shapes gone, `ContentLanguageSwitcher` keeps one rail shape → the `variant` prop and the dead pill/row branches are deleted. `playground.tsx` passes `contentLang` (+ `onAddLanguage`) to `ToolRail` instead of `TopBar`.
- **Known behavior:** the rail renders only while `displayedSpec && !isStreaming` (same gate as Pick/X-ray/Clear today) — during a steer stream the language UI is briefly unavailable. Accepted; no gate changes in this rev.

**Tasks**

- [x] R3-T1 Components: `ContentLanguageSwitcher` rail trigger (current tag + corner spinner/missing badge, `side="left"` popover, optional `onAddLanguage` row, `variant` and dead pill/row branches dropped). `ToolRail`: renders the switcher between X-ray and Clear, Languages-icon button removed, `data-tool-rail` test hook added.
- [x] R3-T2 TopBar + playground: `contentLang` prop and both renders removed (LocaleSwitcher/app-shell controls stay — user boundary), `contentLangProps` un-gated from `hasCopy` (now includes `onAddLanguage`), passed to `ToolRail` instead of `TopBar`.
- [x] R3-T3 Tests: **unit** — `components/playground/tool-rail.test.tsx` (trigger shows current tag; absent with null props; icon button gone) + test script widened to `bun test lib components`. **e2e** — `i18n.spec` picker journey opens trigger → popover → Add row; empty-copy test **inverted** (exactly one control, in `[data-tool-rail]`, shows the seed tag, popover → Add → dialog); `authed.spec` picker journey opens the popover first; `responsive.spec` re-checked (no language assertions). **MCP (manual, live dev + real model):** generated design → rail trigger "Content language: English" present, TopBar pill absent, popover rows = English(Source) + Add language…, opens leftward in-viewport, Add row → "Add a language" dialog with full catalog.
- [x] R3-T4 Full gate green (format, lint, tsc, 439 unit, build, **95 e2e passed**).

## Verification

- [x] Unit: rail renders the action; switcher def/impl; action declared; rules contain the theme bullet; effective-theme + scoped-class helpers.
- [x] e2e: add-language via rail (incl. empty-copy spec); theme journey (canvas flip + reload persistence; public route decision persistence + precedence); preview honors spec theme.
- [x] Full gate green.

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-17 | user report: "Add language" unavailable on imported spec `6ff055e4` — root cause `hasCopy` gate (`playground.tsx:1249`) hides the only entry point when `state.copy` is empty even though `state.i18n.es` exists; user directed: action belongs in the ToolRail, theme must become spec-handled like language — plan drafted |
| 2026-10-17 | rev 2 (user): popover entry **moves** to the rail (not duplicated); visitor's theme decision **persists** on public routes (stored decision > spec default, `genui-theme` key, `ThemeInit` pre-paint) — **awaiting approval** |
| 2026-10-17 | rev 2 approved and implemented; refinements during build: preview route themes `<html>` for both audiences (SSR can't know owner-vs-visitor — persistence carries the split), `SpecThemeInit` keyed on `published` so the script lands in SSR HTML, `data-canvas-surface` test hook, text-free `NO_COPY_UI_LINES` fixture, `authed.spec` picker journey moved to the rail; gate green: format, lint, tsc, 437 unit, build, **95 e2e passed** |
| 2026-10-17 | rev 3 (user): rail language button shows the **current language** instead of an icon; the popover **moves from the TopBar** (desktop pill + mobile row) **to the rail**; "Add language…" becomes a popover row (user chose the single-control shape) — **awaiting approval** |
| 2026-10-17 | rev 3 approved with clarification: **TopBar = app shell keeps its own language** (`LocaleSwitcher` stays, incl. mobile menu); only the SPEC content language moves; **ToolRail = spec only** — implementing |
| 2026-10-17 | rev 3 implemented; test script widened to `bun test lib components` for the first component unit test; gate green: format, lint, tsc, 439 unit, build, **95 e2e passed** + MCP live smoke (trigger/popover/Add chain, TopBar pill absent) |
