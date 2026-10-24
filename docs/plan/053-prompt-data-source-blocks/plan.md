# Prompt: Data-Source Block Shapes & Pagination Conventions — Implementation Plan

**Status:** implemented
**Date:** 2026-10-22

## Goal

Make a fresh model generation produce a working paged, keyed Pokédex — the
same shape as the hand-written `demo/pokedex-keyed-spec.json` — by teaching
what the system prompt never taught, and by fixing what it falsely taught.
Verification of 052 showed the composed vocabulary lands (3.5 Lite emitted
`watch` → `data_read`, `stepPage`, `pageLabel`, `urlSync` in every run) but
no run can work end-to-end. Corrected evidence (post-draft re-measure,
mistake #21: the first pass grepped `catalog.prompt()` alone, excluding the
appended rules): the three block shapes WERE taught by `STYLING_RULES`'
data-sources paragraph — but that paragraph predates 050/051/052 and
**actively contradicts them**: *"a PUBLIC, unauthenticated HTTPS JSON
API… authenticated APIs are unsupported… never put keys, tokens or query
strings in the spec"*, a `queries` shape with no `params`/`pagination`, no
`itemDetail`, and the keyed `auth` shape appears **nowhere** in the prompt
(`"bearer"`, `"auth"` — zero hits). So the model improvises the non-obvious
seams: drops `auth` (direct fetch → 401), writes non-pointer paths
(`itemsPath:"results"`, `totalPath:"count"` → `pickPointer` needs a leading
`/`; `itemsPath` even throws DataError at init), places `params`/`pagination`
nondeterministically (on the query ✓ in one run, inert on `repeat` in
another), and seeds `state.page: 1` while `urlSync` assumes 0-based state
(deep-link off-by-one). This is recipe-side (mistake #22): prompt teaching
only — zero runtime change.

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
- **Fix the stale pre-050 api paragraph in `lib/playground/styling-rules.ts`**
  (added 2026-10-22, post-draft re-measure): drop "authenticated APIs are
  unsupported" / "never put … query strings in the spec" (false since
  050/052), point protected APIs at the `config.auth` shape-only ref and
  keep the credential-VALUE ban (already double-taught at the paragraph's
  end); update the two pinned assertions in `styling-rules.test.ts`
  (lines 236/238) to pin the corrected stance
- Tests: `data-source-rules.test.ts` (content seams, `styling-rules.test`
  style); `catalog.test.ts` assertions for the reworded description
- Live re-verification: same prompt, fresh 3.5 Lite generation
- **Gap fix 7 (2026-10-24, live verification of imported spec
  `14b59e37`)**: `DATA_SOURCE_RULES`' stepPage bullet gains the **complete
  args shape** — `source`, `page`, `limit`, `delta`, **and
  `maxPage: {"$state": "/queries/<name>/maxPage"}`** — plus the failure
  mode ("without `maxPage`, `stepPage` clamps against the loaded rows, so
  Next never advances"). The catalog's `data_read` description already
  taught `maxPage`; the rules section (the one models follow for paged
  lists) did not → 3.5 Lite omitted it and pagination silently no-op'd.
  Pinned in `data-source-rules.test.ts`
- **Gap fix 8 (2026-10-24, same run)**: `STYLING_RULES` `$item` teaching
  gains "**`$item` always names a field** (`{"$item": "label"}`), **never
  the empty string** — `{"$item": ""}` resolves to the whole row object,
  which breaks text rendering (e.g. a Badge `text` receives an object →
  contained crash, chip missing)". Pinned in `styling-rules.test.ts`

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
6. **Contradicted teaching is fixed in place, not outweighed** — the stale
   `STYLING_RULES` api paragraph ("authenticated APIs are unsupported")
   stays only if corrected: two sections saying opposite things is exactly
   the nondeterminism the 052 test showed (run C placed `params` right, run
   D on `repeat`); rejected: relying on section order or repetition to
   dominate, because conflicts resolve per-run, not on average
7. **Gap fixes 7/8 are teaching-only; runtime masking is rejected** —
   rejected: changing `stepPage`'s clamp fallback (e2e fixture
   `icons.spec.ts` relies on limit-clamp against `source`; the mirror
   already carries the right `maxPage`, the model just must pass it) and a
   registry prop-guard for `$item:""` (masks the defect; the
   `ElementErrorBoundary` already contains the crash — the fix is to stop
   the model emitting it)

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test`
      (639 unit tests green, incl. the new gap-7/gap-8 pins)
- [x] `bun run build` (dev stopped, `.next` wiped — mistake #23) &&
      `bun run test:e2e` (111 e2e green); restart dev :3000 + wrapper :4100
- [x] Prompt ground truth: assembled system prompt contains the auth shape
      (`{"type": "bearer", "ref"`), `/results`-style pointers, the
      on-the-query placement line, and the 0-based seed rule
- [x] Live MCP (3.5 Lite, same prompt as the 052 gap test): generated spec
      has `/`-led `itemsPath`, `params`+`pagination` on the query,
      `state.page: 0`; **keyless lane (2026-10-24, user directive — real
      `https://pokeapi.co` instead of the keyed demo wrapper: browser-direct
      fetch, no `auth`, no proxy)**; first fetch
      `?offset=0&limit=12`; cards render; Next → URL `?page=2` + `offset=12`;
      deep link `?page=3&limit=6` first-fetch `offset=12&limit=6`
      — **result 2026-10-24 (entry `13e8aeaf`)**: `?offset=0&limit=12`
      browser-direct ✓, 12 cards + 12/12 images + 18 type chips ✓, Next →
      `?page=2`/`?page=3` + label + refetch (offset 0→12→24) ✓, deep link
      `?page=3&limit=6` → first fetch `offset=12&limit=6`, "Page 3 of 226" ✓,
      zero console errors ✓; gap-7 (`maxPage` in stepPage args) and gap-8
      (`$item` field paths) both present in the fresh generation ✓

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-22 | plan drafted |
| 2026-10-22 | approved |
| 2026-10-23 | implementation complete (unit tests + build + e2e pass) |
| 2026-10-23 | live test: 3.5 Lite generation shows auth shape ✓, /-prefixed pointers ✓, 0-based state ✓ |
| 2026-10-23 | live test gap 1: itemDetail placement (was sibling to config → now added to example) |
| 2026-10-23 | live test gap 2: params manual offset computation (was $math multiply → now forbidden) |
| 2026-10-23 | live test gap 3: state variable named /offset instead of /page (model bypasses pageParam conversion) |
| 2026-10-23 | live test gap 4: params key "offset" instead of "page" (fixed: explicit NOTE that params key is ALWAYS "page") |
| 2026-10-23 | live test gap 5: manual $math add/subtract for pagination (fixed: rule to use stepPage) |
| 2026-10-23 | live test gap 6: urlSync placed inside dataSources instead of top-level (fixed: explicit rule that urlSync is top-level) |
| 2026-10-23 | fixes applied to DATA_SOURCE_RULES to address gaps (itemDetail example, offset computation ban, /page naming requirement, params key always "page", use stepPage, urlSync top-level) |
| 2026-10-24 | live gap 7: stepPage called WITHOUT maxPage (DATA_SOURCE_RULES bullet never mentioned it) → clamp ceiling = loaded rows → Next no-op (fixed: full args shape + failure-mode sentence in DATA_SOURCE_RULES) |
| 2026-10-24 | live gap 8: model wrote `{"$item": ""}` on a Badge text → whole-row object → contained render crash, chips missing (fixed: "$item always names a field, never empty string" rule in STYLING_RULES) |
| 2026-10-24 | gap fixes 7+8 implemented (test pins in data-source-rules.test.ts + styling-rules.test.ts) |
| 2026-10-24 | live verification target switched to the keyless `pokeapi.co` lane (user directive — real API, browser-direct, no auth/proxy) |
| 2026-10-24 | live verification PASSED (entry `13e8aeaf`): gap-7 `maxPage` + gap-8 `$item`-field both present in the fresh 3.5 Lite spec; 12 cards + 12/12 images + 18 chips; first fetch `?offset=0&limit=12` browser-direct; Next → `?page=2`/`?page=3` + label + refetch (offset 0→12→24); deep link `?page=3&limit=6` → "Page 3 of 226", first fetch `offset=12&limit=6`; zero console errors |
| 2026-10-24 | observations from that run (no new rules — one-run sampling, both teachings exist and were followed elsewhere in the same spec): (a) watcher omitted — model wrote malformed `data_read` shorthand inside `press`, line dropped + healed without refetch → steer added the watcher; (b) one image `src` bound `$state` instead of `$item` → steer fixed; (c) preview route `/en/<slug>` renders the result fully but does not wire `urlSync` (deep-link read+write are canvas-only, `playground.tsx` D9) — recorded for the shareable-URL story |
