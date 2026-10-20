# Dual-Theme Generation (light + dark) — Implementation Plan

**Status:** implemented
**Date:** 2026-10-06

## Goal

Model-generated specs must render correctly in **both** light and dark themes, but nothing today steers or enables that: the generation prompt never mentions dual-theme output (and misleadingly lists `dark:` under "interaction states"), and semantic theme utilities the model may pick (e.g. `bg-destructive`, `border-primary`, `text-accent`) are not force-compiled — Tailwind v4 only emits classes found in scanned source or `@source inline`, so such classes silently produce no CSS. This feature closes both gaps: prompt rules that mandate both-theme correctness with clear guidance, full compile coverage for theme-aware classes, and probes that pin the behavior.

## Scope

### In scope

- **A. Prompt rules** (generate + steer share the same system prompt):
  - Output must read correctly in both light and dark (theme toggle is always available)
  - Prefer semantic theme tokens for surfaces/text (`bg-background/card/muted/primary`, `text-foreground/muted-foreground`, `border-border`, …) — they auto-adapt via the `.dark` var swap
  - Explicit palette colors require a `dark:` counterpart (e.g. `bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100`); colored surfaces with contrasting text (`bg-blue-600 text-white`) are fine in both themes as-is
  - Never hardcode colors (hex, black/white) in the `style` prop — colors go through classes so they can follow the theme
  - Fix the misleading line that groups `dark:` with `hover:`/`focus-visible:`/`active:` as "interaction states"
  - **A2 (scope extension 2026-10-06)**: prefer named tokens over arbitrary `[…]` values in className (`bg-card` not `bg-[#hex]`, `shadow-sm` not `shadow-[…]`, `aspect-video` not `aspect-[…]`) — arbitrary-value space cannot be enumerated in `@source inline`, so the prompt must steer models toward tokens that are guaranteed compiled
- Rules move to `lib/playground/styling-rules.ts` (exported `STYLING_RULES`), imported by `app/api/generate/route.ts` — colocated with `models.ts`/`example-prompts.ts` so `bun test lib` can pin the clauses
- **B. Compile coverage** in `app/globals.css` `@source inline`:
  - full semantic token set: `{bg,text,border}-{background,foreground,card,card-foreground,popover,popover-foreground,primary,primary-foreground,secondary,secondary-foreground,muted,muted-foreground,accent,accent-foreground,destructive,destructive-foreground,border,input,ring}` with `{,hover:,focus-visible:,active:,dark:,dark:hover:}` prefixes
  - `dark:`/`hover:`/`dark:hover:`/`focus-visible:`/`active:` variants of `text-{white,black}` and `bg-{white,black}/{existing shades}` (base forms already covered)
  - **B2 (scope extension 2026-10-06, from real-API evidence)** — classes models emit that produced no CSS:
    - slash-opacity palette forms: `{bg,text,border}-{palette}-{shade}/{40,50,60,70,80,90}` + `{hover:,dark:,dark:hover:}` prefixed copies — `dark:bg-stone-900/90` and friends are exactly the pairings rule A promotes, yet were silently dead
    - responsive variants: `{sm:,md:,lg:,xl:}` over `grid-cols`, `col-span`, `text` sizes, `px`/`p`/`gap` sets (the carousel stacked 1-column because `lg:grid-cols-4` never compiled)
    - typography/misc observed in output: `font-{serif,sans,mono,light,normal}`, `italic`, `not-italic`, `opacity-{…,85,…}`, `leading-snug`, `items-{start,end,stretch,baseline}`, `inset-x-*`, `inset-y-0`, `tracking-{wide,wider,widest}` + observed arbitrary `tracking-[0.18em|0.2em|0.25em]` / `text-[9px|10px|11px|13px]`, `line-clamp-{1,2,3}`, `aspect-{auto,square,video,portrait}` + `aspect-[3/4|4/3|16/9]`, `shadow-xs`, `rounded`, `group-hover:`/`dark:group-hover:` palette text + scale forms
- **C. Tests**:
  - `lib/playground/styling-rules.test.ts` — pins both-theme clause, semantic-token guidance, `dark:` pairing rule, `style`-prop color ban, and that `dark:` is not listed as an interaction state
  - `e2e/runtime-classes.spec.ts` — new probes: previously-missing semantic utilities compile+apply (`border-primary`, `bg-destructive`, `text-accent`, …); `dark:` palette class applies inside a `.dark` wrapper and not outside it
  - **C2 (scope extension 2026-10-06)**: probe responsive variants (`sm:grid-cols-2`/`lg:grid-cols-4` tracks, `md:text-5xl` size), slash-opacity palette (`bg-stone-100/50` non-transparent, `dark:bg-stone-900/90` gated on `.dark`), and typography/misc (`font-serif`, `italic`, `opacity-85`, `aspect-[3/4]`, `items-stretch`)
- **MCP verification with the real API**: one real generation in the dev server, toggle light/dark, screenshots of the canvas in both themes

### Out of scope

- Post-generation spec lint / auto-steer for non-compliant specs (fixed colors without `dark:` counterparts) — probabilistic enforcement is a possible follow-up, but prompt rules + compile coverage are this feature's mechanism (descoped 2026-10-06)
- Migrating existing history entries / stored specs to theme-aware classes — old drafts regenerate on edit, no bulk migration needed (descoped 2026-10-06)
- Chart tokens (`chart-1..5`) and sidebar tokens in `@source inline` — models have no reason to emit them from a UI-generation prompt (descoped 2026-10-06)
- Changing registry/catalog components — they are already token-based via shadcn (descoped 2026-10-06)

## Design decisions

1. **Prompt rules live in `lib/playground/styling-rules.ts`, not in the route** — rejected: keeping them in `app/api/generate/route.ts`, because `bun run test` runs `bun test lib` only, so route-local rules could not be unit-pinned; rejected: snapshotting the whole system prompt, because catalog prompt output is large and unstable
2. **Compile coverage via `@source inline`, not "use more tokens in source"** — rejected: sprinkling unused semantic classes into components to trigger source scanning, because it is fragile (a later refactor silently drops them) and dishonest; rejected: generating all utilities unconditionally, because it bloats CSS; `@source inline` is the project's established mechanism (globals.css:14-20) with a runtime probe guard. Cost accepted for the extension: CSS grew 57 KB → **231 KB gzip** (measured, trimmed once by dropping unobserved forms; decision 2026-10-06)
3. **Probe-based e2e instead of screenshot diffing** — rejected: theme screenshot comparisons, because they are flaky across environments; computed-style probes (existing `runtime-classes.spec.ts` pattern) prove compile + apply deterministically, and MCP screenshots cover the visual layer once
4. **Semantic tokens recommended over mandatory `dark:` pairs** — rejected: requiring `dark:` variants for everything, because semantic tokens auto-adapt (the `.dark` block swaps the vars), so demanding redundant `dark:bg-card` noise would bloat outputs; palette colors still require explicit `dark:` pairs
5. **Real-API MCP check included** *(user-confirmed 2026-10-06)*: prompt adherence cannot be proven with MSW mocks — one live generation + theme toggle screenshots close the loop
6. **Coverage gaps fixed by observing real model output, not guessing** *(scope extension, user-confirmed 2026-10-06)*: the "Richard's Favorites" test generation proved responsive/slash-opacity/arbitrary classes were dead CSS — enumeration targets are drawn from that evidence plus the shadcn idiom; rejected: runtime in-browser Tailwind compilation (architecture change, double CSS, unproven with Next build), rejected: prompt-only (CSS must exist for any class the model does emit), rejected: exhaustive arbitrary-value enumeration (infinite space — handled by prompt rule A2 instead)

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build && bun run test:e2e` — all green (**142 unit / 31 e2e** after extension)
- [x] Unit: `lib/playground/styling-rules.test.ts` pins every dual-theme clause incl. A2 named-tokens-over-arbitrary (6 tests)
- [x] e2e: `runtime-classes.spec.ts` semantic-token probes + inside/outside-`.dark` `dark:` probe pass (2 tests; blue-500 asserted applied-vs-transparent because Chrome serializes oklch as `lab()`)
- [x] e2e (C2): third probe passes — responsive (`lg:grid-cols-4` = 4 tracks), slash-opacity (`bg-stone-100/50`, `dark:bg-stone-900/90` gated on `.dark`), typography (`font-serif`, `italic`, `opacity-85`, `aspect-[3/4]` asserted as applied-vs-transparent / `3 / 4` serialization, `items-stretch`)
- [x] CSS size (design decision #2 trade-off documented): baseline 442 KB raw / 57 KB gzip → extension **3.1 MB raw / 231 KB gzip** (first attempt 4.2 MB / 310 KB trimmed by dropping unobserved `text`+opacity forms)
- [x] MCP (real API): "Revenue dashboard" generated → canvas readable in light **and** dark, screenshots both. Notes: first attempt streamed only `state` (empty `elements`) — pre-existing generate-mode truncation flake, retry succeeded; retry output used `text-emerald-500` without a `dark:` pair (lite-model adherence variance, still legible both themes; auto-remediation descoped)
- [x] MCP (real API, extension): "Richard's Favorites" carousel generated (3.8 Flash emitted `repeat:` without `state` → steer repair on 3.7 Flash; 3.8 also 503'd repair) → restored from history and verified **light + dark with fresh element screenshots**: 4-across grid (`lg:grid-cols-4`), ui-serif heading, cards get `dark:bg-stone-900/90` (slash-opacity `@source inline` live), inverted CTA. Known residual: `bg-[#FAF9F5]` arbitrary still dead by design (A2 steers future output); page screenshots were stale compositor frames — `evaluate_script` + resize-forced repaint confirmed ground truth

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-06 | plan drafted (preview shown to user with scope options A+B+C) |
| 2026-10-06 | approved — scope A+B+C (prompt + compile coverage + tests) with real-API MCP verification |
| 2026-10-06 | implemented — chain green (141 unit / 30 e2e), MCP real-API dual-theme screenshots verified |
| 2026-10-06 | scope extension approved (A2 + B2 + C2) — real-API carousel test proved responsive/slash-opacity/arbitrary classes silently dead; fixed via observed-evidence enumeration + prompt rule |
| 2026-10-06 | extension implemented — chain green (142 unit / 31 e2e), CSS 3.1 MB raw / 231 KB gzip (prod), carousel verified live in light + dark (element screenshots + computed styles) |
