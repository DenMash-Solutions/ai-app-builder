# API Data Source — Implementation Plan

**Status:** approved
**Date:** 2026-10-19

## Goal

Add a third data-source provider — `api` (planned as M3 of the data-sources
program) — so generated designs can bind to plain HTTP/JSON APIs through the
same declarative blocks (`dataSources` / `resources` / `queries`), the same
`/queries/<name>` mirror, and the same `data_mutate` flow that already serve
`localStorage` and `supabase`. The adapter contract in
`lib/data-sources/adapter.ts` was designed for exactly this ("M2 (database)
and M3 (API) adapters implement exactly this interface"), so the query
manager, QueryLoader, validation gating and loading states all carry over
untouched — this milestone delivers the adapter, its config policy, and the
recipe language for pointing a spec at a public JSON API.

Architecture settled after reviewing the full enterprise API-integration
design (`reference-enterprise-plan.md`, beside this file): its invariants are
kept where they cost nothing (invocations reference declared operations, never
runtime URLs; responses are untrusted and schema-checked; no secrets anywhere;
capability gating), while its platform machinery (definition registry,
credential broker, isolated egress worker, private connectors, OAuth,
multi-tenant audit) is deferred as **Lane 2**. This milestone is **Lane 1:
keyless public APIs, browser-direct** (user decisions, 2026-10-19).

## Scope

### In scope

- `DATA_SOURCE_PROVIDERS.api` constant + `api-adapter.ts` implementing
  `DataSourceAdapter` (standard REST verb mapping, `DataError` normalization,
  per-provider capabilities)
- Spec-level config `{ baseUrl: string, itemsPath?: string }` — endpoints are
  public, so a URL is not a credential; `CREDENTIAL_CONFIG_KEYS` rejection
  stays global
- Endpoint policy: **spec-declared `baseUrl`** with hard seam validation —
  https-only outside localhost, no userinfo, no fragment, no
  private/link-local/metadata IP literals; no allowlist, no registry
  (user decision, 2026-10-19). Residual risk recorded as accepted: a spec can
  direct visitor requests at arbitrary *public* origins — CORS still governs
  what actually responds
- Transport: **direct browser fetch** (user decision, 2026-10-19) — a browser
  is confined to the visitor's own network perspective (public→private
  requests blocked by the platform), so keyless direct fetch needs no egress
  worker; CORS is the natural permission boundary; no new server surface
- `collection` doubles as the path segment (`GET baseUrl/collection`);
  `itemsPath` (JSON pointer) unwraps enveloped list responses
- `validate.ts`: per-provider config policy for `api` (baseUrl required, plus
  the URL-shape rules above)
- Recipe (`styling-rules.ts`): provider line gains `{"provider": "api",
  "config": {"baseUrl": "…"}}`; guidance on read-first patterns, error
  branch reuse, and that writes target standard REST endpoints only
- Unit tests: adapter CRUD + errors via MSW (same pattern as
  `supabase-adapter.test.ts`), URL-shape/cfg validation cases, recipe
  assertions
- e2e journey: api-provider fixture (baseUrl on the app origin + MSW route
  interception) — list renders, error branch on 500, `data_mutate` write
  round-trip
- `docs/data-sources.md`: API provider appendix (config, URL policy, CORS
  stance, limitations)

### Out of scope

- **Lane 2 — keyed/authed APIs** (API keys, bearer tokens, OAuth, server-side
  execution): a key is origin-bound, so it requires an origin-registered
  server route that injects it — never the browser. The adapter interface
  hides transport, so Lane 1 → Lane 2 is a non-breaking swap; deferred until
  a concrete keyed demo needs it (descoped 2026-10-19)
- Server-side proxy route for keyless calls — imports SSRF into the app host
  (which has no hardened egress worker) to solve what browser confinement
  already solves; revisit together with Lane 2 (descoped 2026-10-19)
- Enterprise platform machinery from `reference-enterprise-plan.md` —
  definition/connection/binding tables, credential broker + secret store,
  isolated HTTP worker, private connectors, OAuth, tenant-scoped cache,
  audit/retention systems: threat-model reference only, not build items
  (descoped 2026-10-19)
- Query-param plumbing (`queryDef.params` → request URL) — the adapter
  interface is id-based; params need a contract change (descoped 2026-10-19)
- Non-REST shapes (GraphQL, RPC, envelope variants beyond `itemsPath`) —
  v1 targets conventional REST (descoped 2026-10-19)
- Cross-tab refresh events for API data — no shared storage to observe;
  post-mutation `refreshResource` covers freshness (descoped 2026-10-19)

## Design decisions

1. **Provider id `"api"`, config `{baseUrl, itemsPath?}` at the data source**
   — rejected: per-resource URLs (resource-level `url` field), because one
   data source should denote one API origin (matches supabase/localStorage
   semantics and keeps URL validation per data source).
2. **Spec-declared `baseUrl`, no allowlist, no registry (user decision
   2026-10-19)** — rejected: env origin allowlist (`DATA_API_ALLOWLIST`),
   because a generated spec cannot know the allowlist and demos become
   brittle; rejected: the enterprise design's definition registry
   (`ApiDefinition`/`ApiOperation` tables), because declaration-time policing
   is already what the three seams do for every other spec block; rejected:
   fully app-registered named endpoints (supabase-style empty config),
   because the URL itself is the model's useful output and carries no
   secret. Residual risk recorded and accepted; malformed URL forms and
   private/link-local/metadata IP literals are still rejected at the seams.
3. **Direct browser fetch for Lane 1 (user decision 2026-10-19)** — rejected:
   server-side execution from day one, because the enterprise design's
   "server-side always" premise assumes a hardened, isolated egress worker
   (private-IP blocking, redirect policy, network-layer enforcement) that a
   single Next.js process does not have — proxying spec-directed fetches
   from the app host would import SSRF into our own network, while a browser
   is confined to the visitor's own network perspective and CORS is the
   natural permission boundary. Server execution returns in Lane 2, where a
   secret forces it.
4. **Standard REST verb mapping with `collection` as path segment** —
   rejected: action-template config (`{list: "GET /x"}`), because templated
   request DSLs push spec complexity into config and duplicate what the
   adapter interface already abstracts; non-conventional APIs wait for the
   params/template milestone.
5. **https-only `baseUrl` (localhost http allowed for dev/e2e)** — rejected:
   plain http anywhere, because browser contexts increasingly block mixed
   content and there is no legitimate http use outside local development.
6. **Adapter capabilities: full CRUD** — rejected: read-only v1, because the
   write path (POST/PATCH/DELETE) is the same fetch code as reads and the
   `data_mutate` + pending machinery is already built; the recipe steers
   models toward read-first usage where the target API is read-only. (The
   enterprise design's read-only-first phase governs *credentialed*
   operations, which live in Lane 2.)
7. **Record validation reuses `record-validate.ts`** — the same
   schema-check that guards supabase reads guards API responses (malformed →
   `malformed` error branch), so a sloppy API degrades to the friendly error
   state, never a broken page.
8. **The spec never carries a runtime URL** — the enterprise invariant kept
   for free: queries reference `resource`/`collection`, and the adapter
   composes the request from the data source's `baseUrl`; `data_mutate` and
   the query manager learn nothing provider-specific.

## Verification

- [ ] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build && bun run test:e2e`
- [ ] Adapter unit tests (MSW): list/get/create/update/delete happy paths;
      non-2xx → `DataError` codes; `itemsPath` unwrapping; arbitrary https
      origin accepted
- [ ] Validation tests: `api` config with credential-shaped key rejected;
      missing baseUrl rejected; http rejected outside localhost; localhost
      http accepted; userinfo/fragment/private-IP-literal rejected
- [ ] Recipe test: provider line + read-first/write guidance present
- [ ] e2e: api fixture journey (list render, error branch, mutate +
      refresh) with MSW intercepting the app-origin baseUrl
- [ ] MCP steer spot-check: plain-language prompt pointing the todo entry at
      a public API renders list + error branches correctly

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-19 | plan drafted (post lessons-grep + json-render skill audit) |
| 2026-10-19 | architecture re-set after reviewing the enterprise reference plan: browser-direct keyless lane, spec-declared endpoints, keyed lane deferred |
| 2026-10-19 | approved (browser-direct keyless lane; spec-declared endpoints; Lane 2 keyed APIs deferred) |
