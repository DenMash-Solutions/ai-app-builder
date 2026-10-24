# Generation Resilience — Implementation Plan

**Status:** implemented
**Date:** 2026-10-23

## Goal

A fresh generation that streams one malformed JSONL line must not lose an
element, and a spec with dangling child references must heal itself instead
of rendering blank sections. Live Pokédex verification (plan 053) hit both
faces of this root cause twice: run `98041ba7` wrote a JS computed key
`[":watch"]:` (invalid JSON) and the whole `content-stack` op was
**silently discarded** by `parseLine` in `@json-render/react`
(`catch { return null }`), blanking the content area; the next run referenced
`pokemon-card` (the grid's repeat template) and `page-info` that were never
defined, so 12 rows of perfectly fetched data rendered **zero cards**
(`Missing element "pokemon-card" (repeat)` ×24). Edit mode is already
protected (buffer → `validatePatchText` → retry once); generate mode has
zero protection and zero observability — drops are invisible even in the
server log (only the last 300 chars are kept).

## Scope

### In scope

- `lib/playground/repair-patch-line.ts` (+ test): per-line repair of the
  one observed malformation — JS computed string keys `[":key"]:` →
  `"key":` — only ever applied to lines that already failed `JSON.parse`;
  plus `repairPatchText` for whole-buffer use (edit mode)
- `app/api/generate/route.ts`: **generate relay frames lines itself** —
  repair before enqueueing, and **log** every repaired/dropped line with
  line number + prefix (observability); **edit path** repairs before
  `validatePatchText` (saves the retry/503 on the same malformation)
- `lib/playground/dangling-refs.ts` (+ test): `danglingChildRefs(spec)`
  (children strings with no element definition), the heal instruction, and
  a developer-facing description
- `components/playground/playground.tsx`: at the completion commit, after
  `validateDataSources` passes — if dangling refs exist and this op has not
  healed yet, re-enter the commit with `healAttempted: true` and send ONE
  targeted steer ("define the missing elements or remove the references")
  through the existing validated edit path; the healed spec is what lands
  in history (single clean revision, no navigation race — the landing
  mount owns the heal stream). A still-broken healed completion commits
  what it has and shows a `playground.uiIncomplete` toast (never loops)
- `lib/i18n/locale/en.json` + `es.json`: `playground.uiIncomplete` toast
  strings
- **Generic root-member stream recovery** (added 2026-10-24 after live
  verification): `add /urlSync` — the top-level member plan 052/053 teaches
  every paged spec to declare — is dropped by `useUIStream`'s applier
  (renderer-owned paths only: `/root`, `/state`, `/state/*`, `/elements/*`)
  and recovered by NOBODY: `withDataBlocksFromLines` re-folds only
  `DATA_BLOCK_KEYS` (`dataSources|resources|queries`), so the committed
  spec never carries `urlSync` and both URL sync directions no-op. Fix by
  generalizing the completion-seam recovery: re-fold and merge EVERY root
  member the renderer applier does not own (`root`/`state`/`elements` stay
  with the hook) — `urlSync` and any future top-level extension survive by
  construction. Rename `withDataBlocksFromLines` → `withRootBlocksFromLines`
  (the old name would mislead: urlSync is covered too)

### Out of scope

- Buffering generate mode like edit mode — kills the progressive streaming
  render, the playground's headline UX (descoped 2026-10-23)
- Synthesizing placeholder elements client-side — only the model knows what
  `pokemon-card` was meant to contain (descoped 2026-10-23)
- Forking/patching `@json-render/react`'s silent `parseLine` — the server
  relay is the seam we own (descoped 2026-10-23)
- Auto-healing old broken entries on page open — surprising side effect on
  mere load; the heal runs on commit only (descoped 2026-10-23)
- General JSONRepair heuristics (trailing commas, single quotes) — only the
  observed malformation class is repaired; logging reveals the rest
  (descoped 2026-10-23)
- `urlSync` support on the published live page (`/[slug]` —
  `preview-client.tsx` has no overlay/write-back) — a committed spec that
  declares `urlSync` renders inert there (an unknown spec member is
  ignored); the playground is the editing/sharing surface (descoped
  2026-10-24)
- Propagating steer `remove` ops for root members (e.g. `remove /urlSync`)
  through the line re-fold — pre-existing data-block semantics, no live
  failure observed (descoped 2026-10-24)

## Design decisions

1. **Repair only what was observed, deterministically** — rejected: generic
   lenient JSON fixing, because heuristics over invalid text risk corrupting
   string values; one exact repair (computed keys) covers the live failure
   and every unknown class becomes visible via drop logs instead of guessed
   at
2. **The server relay repairs, not the client** — rejected: client-side
   repair, because the parse that drops lines lives inside the library's
   `useUIStream` hook; the route is the last point we own before the bytes
   reach it, and it can log with line numbers
3. **Heal = one steer through the existing validated edit path** —
   rejected: synthesizing elements in the app (cannot invent design),
   rejected: looping heals (unbounded model cost); one attempt, then
   commit-with-toast
4. **Heal before the generate commit/navigation** — rejected: heal after
   `router.push('/ui/[id]')`, because the destination remount drops the
   in-flight stream (fresh hook state); re-entering the commit effect with
   `healAttempted` keeps the stream on the landing mount and commits the
   healed spec once
5. **Dangling refs are checked after `validateDataSources`** — the data
   validator guards data-block references; element-tree completeness is a
   separate class checked at the same seam, so an otherwise-invalid spec
   still fails the existing way (no double handling)
6. **Recovery is generic over non-renderer root members, not a fourth
   whitelist entry** — rejected: adding `urlSync` to `DATA_BLOCK_KEYS`,
   because every future top-level extension (and the data blocks of any
   later plan) would need the same fix; the renderer applier owns exactly
   `root`/`state`/`elements`, so "everything else is recovered from lines"
   is the invariant that cannot drift. Steer semantics stay as today: a
   member declared by the current stream replaces the base's; absent
   members keep the base (a steer `remove /urlSync` does not propagate —
   same pre-existing limitation as the data blocks)

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test`
      (639 unit tests green, incl. 8 repair + 6 dangling + 6 root-recovery)
- [x] `bun run build` (dev stopped, `.next` wiped) && `bun run test:e2e`
      (111 e2e green); dev :3000 + wrapper :4100 restarted
- [x] Unit: repair turns the real `[":watch"]` line from run `98041ba7` into
  parseable JSON; never touches valid lines; escaped-quote strings are not
  corrupted; `repairPatchText` records drops with line numbers; dangling
  detection reports parent → child pairs and ignores inline children
- [x] Unit: the completion seam recovers `urlSync` (and any non-renderer
  root member) from raw lines while `root`/`state`/`elements` keep coming
  from the stream hook; steer-safety preserved
- [x] Live MCP retest (3.5 Lite, Pokédex prompt — keyless pokeapi.co lane,
  2026-10-24): cards render (12/12 images loaded), **zero** console
  errors/warnings, **committed spec carries `urlSync: ["page","limit"]`**,
  Next/Prev step + refetch (offset=0→12→24 observed) AND the URL writes
  `?page=2`, deep link `?page=3&limit=6` opens on "Page 3 of 226" with
  first fetch `offset=12&limit=6`
- [x] Run dangled during the retest: generate dropped lines 46/48
  (malformed `data_read` shorthand appended to the button adds) →
  prev/next became dangling children → **auto-heal fired** (`[edit]
  patch ok patches=2`, buttons re-added), zero `Missing element`
  warnings after heal; two steer edits (`patch ok patches=1` ×2) fixed
  an image `$state`-vs-`item` slip and the missing page watcher

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-23 | plan drafted |
| 2026-10-23 | approved (user confirmed in session) |
| 2026-10-24 | scope +: generic root-member stream recovery (`urlSync` drop found in live verification; user directed inclusion in this plan) |
| 2026-10-24 | implementation complete — repair (8 tests) + dangling-refs (6 tests) + generic `withRootBlocksFromLines` (6 tests) + heal re-entry; 639 unit, build, 111 e2e green |
| 2026-10-24 | live retest (keyless pokeapi.co): all verification items pass — heal fired on a real dangling pair (`[edit] patch ok patches=2`), committed spec carries `urlSync`, deep link + URL write-back + refetch verified, zero console errors |
| 2026-10-24 | implemented |
