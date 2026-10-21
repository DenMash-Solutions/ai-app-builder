# Server-Side Pagination — Implementation Plan

**Status:** approved
**Date:** 2026-10-20

## Goal

Let a spec paginate a remote list at the API instead of in the browser: a
paged query resolves its `page`/`limit` from spec state (seeded from the
browser URL via `urlSync` when the link is deep-linked), the API adapter
translates them into the declared request shape (`?offset=&limit=` for
PokéAPI-style, `?page=&limit=` for page-native APIs via `pagination.pageParam`),
and the query mirror exposes derived pagination fields (`page`, `maxPage`,
`hasNext`, `hasPrev`) that the spec binds Next/Prev/label UI to. This closes
the gap found while answering "how can we handle pagination and search" —
today `list` takes no params, `get`'s `params.id` is a literal at attach,
queries run once per spec attach, the keyed transport strips query strings at
two hops, and spec state never sees the browser URL. Client-side paging
(`filterItems`/`sliceItems`/`stepPage`, plans 040/041) already works for
browser-scale lists and stays untouched.

## Scope

### In scope

- `data_read` action — re-runs one named query of the spec (declared in the
  catalog prompt; registered next to `data_mutate` in `QueryLoader`), with
  the query-manager's existing supersession counter keeping last-write-wins
  under rapid clicks
- `queries.<name>.params` values may be expressions (`{"$state": "/page"}`)
  resolved at run; literals already work and keep working
- `queries.<name>.pagination: { pageParam?: "offset" | "page", totalPath?: string }`
  — paged read declaration; adapter returns `{ rows, page }` for it;
  `pageParam` picks the request shape (below)
- API adapter: `list(resource, params?)` appends resolved params as
  querystring; translates the 0-based bound `page` into the declared
  request shape — `offset = page * limit` for `pageParam: "offset"`
  (default, PokéAPI-style) or `page = state + 1` for `pageParam: "page"`
  (page-native APIs, 1-based convention) — arithmetic lives in product
  code (specs cannot compute, per the `sliceItems` precedent); derives
  `hasNext`/`total` from the envelope's `next` presence and optional
  `totalPath`
- Query mirror: optional `page`, `maxPage`, `hasNext`, `hasPrev` fields
  (absent for non-paged queries); `count` semantics unchanged
- Keyed transport forwards querystrings end-to-end: `proxyFetchFor` sends
  `pathname + search` (today `pathname` only, `api-adapter.ts:87`), the
  wrapper forwards `search` upstream (today `pathname` only,
  `keyed-pokedex-server.ts:78`); proxy route path validation verified
  unchanged-safe
- `pageLabel` computed function accepts direct `{ page, maxPage }` args
  ("Page X of Y") in addition to the existing source-based form
- Demo: Pokédex spec seeds `/page: 0` + `/limit: 12`, declares
  `urlSync: ["page", "limit"]`, buttons are pure `setState` via `stepPage`,
  `watch` on `/page` fires `data_read`; label +
  Prev/Next bind the mirror fields; 051 per-card fan-out kept (25 calls per
  page step through the keyed proxy)
- Spec-level `urlSync: ["page", "limit"]` — deep-linkable pagination: the
  declared top-level state keys mirror browser query params (`page` 1-based
  in the URL ↔ `/page` 0-based in state; `limit` passes through; numeric
  strings coerced to numbers; invalid/absent values keep the spec seed).
  The overlay applies to the state seed before `QueryLoader` attaches (the
  first fetch is already the linked page; `watch` fires only on later
  changes — MCP-verified: no page-0 roundtrip); runtime `/page`/`/limit`
  changes write back through the existing `onStateChange` seam with
  `history.replaceState` (in-place — no history spam). Helpers live in
  `lib/playground/url-sync.ts` (dependency-injected, unit-tested);
  the playground wires them
- Unit tests: adapter param building / page translation / envelope derivation
  / degradation, keyed path keeps `search`, `data_read` re-run + mirror
  fields + supersession, `pagination` validation, `pageLabel` direct args;
  docs (`docs/data-sources.md` pagination section)

### Out of scope

- Search-by-id and multi-filter params UI — deferred after pagination; the
  `params` record carries them later without shape changes (descoped
  2026-10-20, per "focus on pagination first")
- Cursor / next-URL pagination — PokéAPI's `next` URL is unexpressible in
  spec expressions; offset/limit is the portable shape (descoped 2026-10-20)
- Client-side paging rework — works today via plans 040/041 primitives
  (descoped 2026-10-20)
- Infinite scroll / virtualized lists (descoped 2026-10-20)
- Action-level param overrides on `data_read` — YAGNI until search needs
  per-fetch params (descoped 2026-10-20)
- Auto-refresh query-def flag — rejected below; `watch` is the native
  trigger (descoped 2026-10-20)
- `popstate` / back-forward restore — write-back uses `replaceState`
  (in-place, shareable) so there are no history entries to replay
  (descoped 2026-10-21)

## Design decisions

1. **Spec-owned page state + adapter-owned arithmetic.** `/page` and
   `/limit` are ordinary spec state (seeded, `$bindState`-able, driven by
   the existing `stepPage`); the adapter translates `page` → `offset`.
   Rejected: query-owned page state (invisible to spec expressions,
   breaks `stepPage` reuse); spec-side offset computation (`$math` is not
   taught in the prompt and `visible` conditions take no arithmetic).
2. **`data_read` action, fired by `watch` on `/page`.** Buttons only
   `setState`; the watcher re-runs the query — one declarative wiring point,
   and `watch` never fires on initial render (attach already ran the query
   at page 0). Rejected: a hidden auto-refresh flag on the query def
   (magic; `watch` is the json-render-native trigger). Alternative
   documented in docs: `on.press` action arrays
   (`setState` → `data_read`) for explicit flows.
3. **Def-level `params` with expression resolution.** `params` already
   exists in the schema as a record; values resolve via the shared
   expression resolver at run (`{"limit": 12, "page": {"$state": "/page"}}`).
   Rejected: action-level override params — deferred until search needs
   per-fetch values.
4. **Querystring travels as a plain path suffix.** `?offset=12&limit=12`
   is client-visible data, so it rides the existing `{ ref, path }` proxy
   body unchanged; only the two `pathname`-only hops start including
   `search`. Rejected: opaque/base64 payloads (no secret to hide, more
   surface).
5. **Mirror-derived pagination fields.** For `pagination` queries the
   adapter returns `{ rows, page: { hasNext, hasPrev, total? } }` and the
   mirror gains `page`/`maxPage`/`hasNext`/`hasPrev`; `hasPrev = page > 0`;
   `hasNext` from envelope `next` presence, else `offset + limit < total`
   (via `totalPath`), else the self-correcting probe (full page → true,
   short page → false; an exact-last-full-page yields one empty fetch that
   flips it). Non-paged queries: fields absent → bound UI hides. Rejected:
   overloading `count` (stays `data.length`); stateful "last page" on the
   adapter instance (races).
6. **Adapter interface grows an optional options param and richer return.**
   `list(resource, params?)` — storage adapter ignores both (never paged).
   Rejected: a second `pagedList` method (duplication across adapters).
7. **`pageLabel` accepts direct `{ page, maxPage }`.** Specs cannot add 1;
   the function renders `Page ${page + 1} of ${maxPage + 1}` from mirror +
   state bindings, keeping the existing source-based form intact.
8. **Demo keeps the 051 fan-out.** Every page step proves both features at
   once (list page → per-card detail through the keyed proxy); `/limit: 12`
   keeps it to 25 requests per step.
9. **URL mirrors state, with each convention where humans expect it.**
   `urlSync` names top-level state keys; the URL is a projection of spec
   state — `page` is 1-based in the URL (the human/REST convention) and
   0-based in state (`stepPage`/`pageLabel` convention); the ±1
   conversions live in the sync helpers, never in the spec. Rejected: a
   0-based URL mirror (surprising in a shared link); per-param mode
   config (YAGNI — these are the only two conventions in the wild).
10. **`pagination.pageParam` declares the API's page shape.** `"offset"`
    (default) translates `page × limit`; `"page"` passes the 1-based page
    through — PokéAPI-style and page-native backends (`?page=2&limit=6`)
    are each one config line. Rejected: auto-detecting the backend shape
    (magic); always-offset (excludes page-native APIs).

## Verification

- [ ] `bun run format && bun run lint && bunx tsc --noEmit && bun run test`
      with dev stopped, then `bun run build && bun run test:e2e` (mistake
      #23: never build over a live dev server)
- [ ] Unit: adapter builds `?offset=12&limit=12` from `{page: 1, limit: 12}`,
      passes literal params through, derives `hasNext` from `next`/`total`,
      degrades without envelope; `pageParam: "page"` emits `?page=2&limit=12`
      (1-based) for the same state; keyed lane sends `pathname + search` in
      the proxy body; wrapper forwards `search` upstream; `data_read` re-runs
      the named query, supersession keeps last-write-wins; `pagination`
      without a well-formed `totalPath` fails validation; `pageLabel`
      direct args
- [ ] Unit: URL overlay maps `?page=2&limit=6` → `{ page: 1, limit: 6 }`,
      clamps/falls back to the seed on `page=0`/`page=abc`, coerces numeric
      strings; write-back merges existing search params and flips `page`
      back to 1-based
- [ ] MCP live (playground): network panel shows `?offset=…&limit=…` on
      paged reads through the keyed proxy; Prev/Next visibility flips per
      page; label reads "Page N of M" from the mirror; fan-out still 25
      keyed calls per step, zero direct-origin calls
- [ ] MCP live (deep link): opening the imported spec at `?page=2&limit=6`
      fetches `?offset=6&limit=6` on the FIRST read (single fetch, no
      page-0 roundtrip), label reads "Page 2 of …", and Next rewrites the
      URL to `?page=3&limit=6`
- [ ] `docs/data-sources.md` gains the pagination section (`data_read`,
      `params`, `pagination`, mirror fields)

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-20 | plan drafted |
| 2026-10-21 | scope amended — URL deep-link sync (`urlSync`, decision 9) + `pagination.pageParam` (decision 10), per "both" |
| 2026-10-21 | approved |
