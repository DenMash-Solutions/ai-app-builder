# Per-Card Detail Reads — Implementation Plan

**Status:** implemented
**Date:** 2026-10-20

## Goal

The keyed-Pokédex demo (plan 050's live spot-check) must show cards whose
content comes from the Pokémon **detail** endpoint: load the list first,
then one `GET /pokemon/{id}` per card, through the keyed proxy — so each
card can render reference-quality type colors, type chips, Title-Case
label, and artwork. Today's runtime cannot express this: `get` queries
read a literal string `params.id` once at spec-attach
(`query-manager.ts:304-313`), queries run once per spec, and elements
have no mount event — so there is no per-repeat-item read primitive.
This plan adds a declarative `itemDetail` fan-out to the API adapter:
after `list()` returns N rows, the client issues N detail fetches
through the same transport (the keyed proxy when `auth` is declared),
merges each detail into its row, and the existing query mirror re-renders
every card — zero new action grammar.

## Scope

### In scope

- `itemDetail: { path }` config on `api` data sources — after `list()`,
  resolve `{id}` per row and fetch `baseUrl + path` through the same
  transport as the list (proxied when `auth` is declared), merging
  `{ ...row, ...detail }` before schema validation/emit
- `{id}` resolution: `row.id` when present, else the last path segment
  of `row.url`; failure to resolve skips that row's detail (base row
  kept) with a `console.warn`
- Config validation in `validate.ts` — `itemDetail.path` must be
  `/`-leading and contain `{id}` (otherwise every row would fetch the
  same detail); dynamic allowed-keys error message follows the 050
  `API_CONFIG_KEYS` pattern; prompt-facing `.describe()` text so the
  recipe teaches the key
- `demo/keyed-pokedex-server.ts`: new keyed `GET /pokemon/{id}` route →
  forwards to `pokeapi.co/api/v2/pokemon/{id}` and **shapes** the
  payload for cards server-side (label, `types` display labels,
  `typeKey`, artwork URL, height/weight, trimmed `stats`) while
  dropping upstream's huge `moves` array — derivation stays out of the
  spec (`template-derived-strings` lesson)
- `demo/pokedex-keyed-spec.json`: **direct-call section removed**
  (elements + `pokedexDirect` source + `pokemonDirect` resource +
  `directList` query); cards restyled to the approved reference —
  type-color `$cond` chain on `typeKey`, nested `repeat` over `types`
  for chips, Title-Case `label`, artwork right; grid keeps 2-per-row
  mobile / 3 desktop
- Unit tests: fan-out through the proxy transport with auth injected,
  id-from-url fallback, merge order, single-detail failure degradation,
  validation rejects
- `docs/data-sources.md` `itemDetail` section

### Out of scope

- Event-driven `data_read` action + element mount trigger — rejected:
  no mount event exists; new grammar + recipe + handler surface far
  exceeds the need (user decision 2026-10-20, chose client fan-out)
- Wrapper-side N+1 (detail fetched inside the list route) — rejected:
  the browser must literally call the detail endpoint per card
  (user decision 2026-10-20; network panel is the proof surface)
- Stats bars / height / weight on cards — reference look only
  (user decision 2026-10-20); payload carries them for future demos
- e2e journeys for `itemDetail` — the 111 existing e2e must stay green;
  fan-out is unit-pinned and MCP-live-verified (rationale: fixtures
  model the todo/generic flows, not the demo spec; revisit if a fixture
  ever declares `itemDetail`)
- Query-level `params.id` expressions — rejected: queries attach before
  any list data exists (chicken-and-egg) and cannot see repeat scope

## Design decisions

1. **Client fan-out inside the adapter's `list()`** — rejected:
   wrapper-side N+1 (browser never calls detail) and a new `data_read`
   action (no trigger event; new grammar), because the fan-out needs no
   spec-side mechanism at all — one config key, cards stay plain
   bindings.
2. **Detail rides the list's transport** (reuses `proxyFetchFor` /
   `authRef`) — rejected: a separate detail transport, because keyed
   sources must inject the key for detail calls exactly as for the list.
3. **`{id}` from `row.id` else derived from `row.url`** — rejected:
   requiring rows to carry `id` (pokeapi list rows only have
   `name`/`url`), and rejected: wrapper adding ids (keep the upstream
   shape; derivation is plain TS in the adapter, not spec template JS).
4. **Merge `{ ...row, ...detail }`**, detail wins on collisions; base
   row survives any detail failure (`console.warn`, query still
   succeeds) — rejected: failing the whole query, because one flaky
   detail must not blank a gallery that already loaded.
5. **Wrapper shapes and trims the detail payload** — rejected: shape
   transforms in the spec, because `$template` interpolates state paths
   only and cannot derive labels/type keys (template-derived-strings
   lesson); rejected: passing pokeapi's raw detail through, because
   `moves` alone is tens of KB per card.
6. **Validation demands `/`-leading path with `{id}` placeholder** —
   rejected: silent acceptance, because a placeholder-less path would
   fire N identical requests (self-inflicted N+1 on the wrong URL).

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test
      && bun run build && bun run test:e2e` — all green (dev server
      **stopped** and `.next` wiped before `build` — mistake #23):
      format/lint/tsc clean, 578 unit tests, production build ok,
      111 e2e passing
- [x] Unit: fan-out issues one proxied detail request per row with the
      auth header injected (keyed source); id falls back to the `url`
      segment; merge order detail-wins; failed/non-object details and
      unresolvable ids keep the base row and the query succeeds;
      `validate.ts` rejects paths without `{id}` or without leading `/`
      (+ adapter `initialize` defense-in-depth rejects malformed
      `itemDetail`) — 6 new adapter tests + 2 new validation tests
- [x] MCP live (2026-10-20): network shows exactly 1 list + 12 detail
      `POST /api/data-proxy` (bodies verified: `/pokemon`,
      `/pokemon/1|5|12`), zero app-driven calls to `:4100`; wrapper log
      `key present` ×13 for the browser session (list + 12 details);
      cards render per-type backgrounds (4 unique bgs across
      grass/fire/water/bug), Title-Case labels, type chips, 12 artworks;
      direct-call section absent; grid 2 tracks @500px / 3 @1280px.
      Screenshots not kept in the repo (same decision as 050) — this
      record is the log
- [x] Recipe/prompt text (`types.ts` config `.describe()`) +
      `docs/data-sources.md` `itemDetail` section updated

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-20 | plan drafted — mechanism + content forks confirmed (client fan-out, reference look); predecessor 050 committed first as `61ddf77` per user sequencing |
| 2026-10-20 | approved — start implementation |
| 2026-10-20 | implemented — full gate chain green (578 unit / 111 e2e) + MCP live proof: 1 list + 12 keyed detail reads, reference-look cards, direct section removed |
