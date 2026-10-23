# Prompt: Data-Source Block Shapes & Pagination Conventions — Implementation Plan

**Status:** approved
**Date:** 2026-10-22

## Goal

Make a fresh model generation produce a working paged, keyed Pokédex — the
same shape as the hand-written `demo/pokedex-keyed-spec.json` — by teaching
what the system prompt never taught. Verification of 052 showed the composed
vocabulary lands (3.5 Lite emitted `watch` → `data_read`, `stepPage`,
`pageLabel`, `urlSync` in every run) but no run can work end-to-end: the
`dataSources`/`resources`/`queries` **block shapes are absent from the
38KB prompt** (`baseUrl`, `itemsPath`, `provider`, `"auth"`, `bearer`,
`Authorization` — all zero hits), so the model improvises and consistently
loses the one key whose shape is non-obvious (`auth` → direct fetch → 401),
writes non-pointer paths (`itemsPath:"results"`, `totalPath:"count"` →
`pickPointer` needs a leading `/`; `itemsPath` even throws DataError at
init), places `params`/`pagination` nondeterministically (on the query ✓ in
one run, inert on `repeat` in another — the description shows a bare object
with no home), and seeds `state.page: 1` while `urlSync` assumes 0-based
state (deep-link off-by-one). This is recipe-side (mistake #22): prompt
teaching only — zero runtime change.

## Scope

### In scope

- New `lib/playground/data-source-rules.ts` exporting `DATA_SOURCE_RULES`
  (pattern: `styling-rules.ts` + its test) teaching the three top-level
  blocks with worked shapes:
  - `dataSources.<name>`: `provider: "api"` + `config` keys — `baseUrl`,
    `itemsPath` (JSON pointer, must start with `/`, e.g. `"/results"`),
    `itemDetail.path` (`"/pokemon/{id}"`), `auth: { type: "bearer" |
    "header", ref }` — shape only, value deployment-held; **declared `auth`
    routes the source through the server key-injecting proxy, no `auth` =
    browser-direct** (the 401 the test runs hit)
  - `resources.<name>`: `{ dataSource, schema }`
  - `queries.<name>`: `{ resource, operation, params?, pagination? }` with
    an explicit "**`params`/`pagination` belong HERE, on the query
    declaration** — never on `repeat`, never on the `data_read` action
    (`data_read` params are `{ query }` only)" and `totalPath` pointer
    syntax (`"/count"`)
  - The page convention: **seed `state.page: 0` (0-based)**; `pageLabel`
    and `urlSync` present 1-based (`?page=2` ↔ state 1); the ±1 conversion
    is `urlSync`'s job — one worked end-to-end paged example tying the
    blocks together
- `route.ts`: append `DATA_SOURCE_RULES` to the system prompt (single
  call site, unconditional — like `STYLING_RULES`)
- `lib/playground/catalog.ts`: reword the `data_read` description — show
  `params`/`pagination` **inside the `queries.<name>` declaration** (kill
  the bare-object ambiguity) and state the 0-based seed explicitly
- Tests: `data-source-rules.test.ts` (content seams, `styling-rules.test`
  style); `catalog.test.ts` assertions for the reworded description
- Live re-verification: same prompt, fresh 3.5 Lite generation

### Out of scope

- Runtime tolerance for bare pointers / `repeat`-level params / 1-based
  state — strict validation with precise diagnostics is the product answer;
  masking authoring errors moves the off-by-one into `urlSync` (rejected
  2026-10-22, decision 4)
- Design-page history race: generation navigated to `/en/ui/5db47258…`
  before the history entry existed → "UI not found" → canvas reset lost the
  whole generation — separate client bug, candidate 054 (descoped
  2026-10-22)
- `gemini-3.8-flash` upstream 503 timeout observed in the same session —
  transient, plan 017 covers timeout handling (descoped 2026-10-22)
- Keyless (direct-fetch) lane changes, wrapper changes, adapter changes
  (descoped 2026-10-22 — nothing runtime is broken)

## Design decisions

1. **Teach block shapes in a new `DATA_SOURCE_RULES` constant appended in
   `route.ts`** — rejected: folding into the `data_mutate`/`data_read`
   action descriptions, because block declarations are not actions and the
   descriptions are already at their length limit; rejected: `customRules`
   at the `prompt()` call, because the rules-constant file + test is this
   codebase's established convention (`styling-rules.ts`, `i18n-rules.ts`)
2. **Placement fix is description wording, not runtime acceptance** — the
   query declaration is where 052's runtime reads `def.params`/`def.pagination`
   (`query-manager.ts:375`); rejected: honoring `repeat`- or action-level
   params, because 052 already rejected action-level overrides (YAGNI) and
   two homes for one value is how specs silently no-op
3. **0-based `/page` stays a stated convention, not a runtime coercion** —
   rejected: making `urlSync` infer 1-based seeds (heuristics break the
   deep-link contract; the demo and e2e pin 0-based)
4. **Pointer syntax is taught with `/`-led examples plus one explicit
   rule** — rejected: auto-coercing `"results"` → `"/results"` in
   `pickPointer`, because the strict `itemsPath` DataError ("must be a JSON
   pointer") is the better diagnostic and coercion hides authoring mistakes
5. **Verification is behavioral (fresh generation), not just wording
   snapshots** — rejected: prompt-content tests alone, because mistake #22
   showed verbatim vocabulary can still go unapplied; content tests gate the
   words, the live retest gates adherence

## Verification

- [ ] `bun run format && bun run lint && bunx tsc --noEmit && bun run test`
      (new `data-source-rules.test.ts` + updated `catalog.test.ts` green)
- [ ] `bun run build` (dev stopped, `.next` wiped — mistake #23) &&
      `bun run test:e2e`; restart dev :3000 + wrapper :4100
- [ ] Prompt ground truth: assembled system prompt contains the auth shape
      (`{"type": "bearer", "ref"`), `/results`-style pointers, the
      on-the-query placement line, and the 0-based seed rule
- [ ] Live MCP (3.5 Lite, same prompt as the 052 gap test): generated spec
      has `auth` in `config`, `/`-led `itemsPath`, `params`+`pagination` on
      `queries.pokemonList`, `state.page: 0`; first fetch goes through the
      proxy with `?offset=0&limit=12`; cards render (no 401);
      Next → URL `?page=2` + `offset=12`; deep link `?page=3&limit=6`
      first-fetch `offset=12&limit=6`

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-22 | plan drafted |
| 2026-10-22 | approved |
