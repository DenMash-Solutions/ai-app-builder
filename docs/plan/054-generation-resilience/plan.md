# Generation Resilience — Implementation Plan

**Status:** approved
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

## Verification

- [ ] `bun run format && bun run lint && bunx tsc --noEmit && bun run test`
- [ ] `bun run build` (dev stopped, `.next` wiped) && `bun run test:e2e`
- [ ] Unit: repair turns the real `[":watch"]` line from run `98041ba7` into
  parseable JSON; never touches valid lines; escaped-quote strings are not
  corrupted; `repairPatchText` records drops with line numbers; dangling
  detection reports parent → child pairs and ignores inline children
- [ ] Live MCP retest (3.5 Lite, Pokédex prompt): cards render, **zero**
  `Missing element` console warnings, Next/Prev refetch at offset 12, deep
  link `?page=3&limit=6` opens on page 3
- [ ] If any run dangles during the retest: the auto-heal steer appears in
  the network log and the healed spec commits

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-23 | plan drafted |
| 2026-10-23 | approved (user confirmed in session) |
