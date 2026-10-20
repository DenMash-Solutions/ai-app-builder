# Keyed API Lane (Lane 2) — Implementation Plan

**Status:** implemented
**Date:** 2026-10-20

## Goal

Plan 048 shipped the `api` provider for **keyless, browser-direct** calls
(Lane 1) and deferred keyed/authed APIs to Lane 2, with the invariant that a
key is origin-bound and must be injected by a server route, never shipped to
the browser. This plan implements that lane: a spec may **declare** that a
data source needs auth (`auth: { type, ref }` — shape only, never a value),
and a server proxy injects the deployment-held key for that origin. Keyless
data sources keep the Lane 1 browser-direct path untouched (additive swap
behind the adapter's existing `resolveFetch` seam).

## Scope

### In scope

- `auth` declaration in the api provider's config (`API_CONFIG_KEYS` grows a
  shape-only key: `{ type: "bearer" | "header", ref: string }`) — still no
  value, so `CREDENTIAL_CONFIG_KEYS` keeps rejecting secrets in specs
- Env-paired server config: `DATA_PROXY_REFS` style pairs of
  `(ref → allowed origin + key + header style)` — the proxy only ever sends a
  key to its **configured origin** (client cannot name a URL)
- `POST /api/data-proxy` route: ref + same-origin `path` + method + body →
  origin check vs the spec-declared `baseUrl` → inject header → fetch with
  timeout + response-size cap → stream JSON back; never logs the key
- Adapter transport: when `config.auth.ref` resolves, requests go through the
  proxy; otherwise Lane 1 direct fetch (unchanged)
- Validation seams: `auth` shape validated; declared `baseUrl` must match a
  configured ref's origin when `auth` is present (clear diagnostic otherwise)
- Tests: proxy unit tests (origin mismatch, key redaction, size cap,
  timeout), adapter fake-fetch tests (proxy vs direct routing), validation
  tests, MSW e2e journey for a keyed data source
- Docs: `docs/data-sources.md` Lane 2 section + recipe note (auth is
  declared, values are infra — model guidance unchanged otherwise)

### Out of scope

- **Per-user BYO keys** (Supabase secrets table + RLS + settings UI +
  masking) — the full product shape; this plan proves the transport with
  deployment-held keys first (descoped 2026-10-20, user decision; env pairs
  extend to per-user rows later without transport changes)
- Query-param auth (`?api_key=`) — reopens the query-string credential
  smuggling path 048 closed; header-only v1 (descoped 2026-10-20, user
  decision)
- OAuth / token refresh / credential broker from
  `reference-enterprise-plan.md` — unchanged enterprise deferral
- Sending ALL api traffic through the proxy — keyless stays browser-direct
  (descoped 2026-10-20, user decision)
- Hardened egress worker — mitigations here are scope-bounded instead: the
  proxy can only target deployment-configured origins (descoped 2026-10-20)
- Live spot-check against a real keyed API — verification is the MSW keyed
  fixture (user decision 2026-10-20); live can be added ad hoc later

## Design decisions

1. **The client never names a URL.** The proxy request is
   `{ ref, path, method, body }`; origin comes from the server's env pair
   (`ref → origin`), and `path` must be same-origin relative (no scheme,
   no `//`, no `@`). Rejected: client-supplied `baseUrl` — an attacker could
   point the proxy at their own host and harvest the injected key, and
   arbitrary-origin fetch is exactly the SSRF surface the plan-048 record
   refused to import without an egress worker.
2. **The spec declares auth SHAPE, infra holds the VALUE.**
   `config.auth = { type: "bearer" | "header", ref: "weather" }` — value-less
   by construction, so the existing `CREDENTIAL_CONFIG_KEYS` rejection keeps
   guarding every write seam; the ref is looked up server-side in env pairs.
   Rejected: key in spec config (published specs are public HTML/JSON); key in
   localStorage (any page script reads it; contradicts 048's origin-bound
   rationale).
3. **Only auth-declared data sources use the proxy** — keyless keeps
   browser-direct (CORS remains the third party's own gate; no new egress
   path exists to abuse). Rejected: proxy-all (uniformity is not worth a
   full-SSRF-surface upgrade for calls that need no secret).
4. **Unknown/unconfigured `auth.ref` refuses at runtime with a named
   diagnostic** — the proxy answers 404 for a ref the deployment hasn't
   configured, and the adapter maps that to its `DataError` message naming
   the ref, which the existing error branch already renders. (An earlier
   draft said the validation seams would catch it, but those seams run in
   the browser where server env is invisible — shape-checking stays
   client-side, availability is server-side truth.)
5. **Header-only auth v1** (`Authorization: Bearer` or a named header).
   Rejected for v1: query-param auth, because 048 banned query strings in
   `baseUrl` precisely to stop credential-shaped values from smuggling past
   config validation — supporting it now needs a separate design, not a
   carve-out.

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test &&
      bun run build && bun run test:e2e` — all green (format/lint/tsc clean;
      **569/569** unit; build OK with `/api/data-proxy` in the route map;
      **111/111** e2e). Prod build ran with dev stopped and `.next` wiped
      first (mistake #23 discipline), then `.next` wiped again so the next
      `bun run dev` starts clean
- [x] Proxy route unit tests (13, `app/api/data-proxy/route.test.ts`):
      ref→origin allowlist with bearer + custom-header injection, key
      never echoed (502 path asserted key-free), same-origin `path`
      enforcement (`//host`, `/\host`, absolute URL, relative — all 400,
      zero upstream fetches), method allowlist (non-CRUD and non-string →
      400), body forwarding (writes carry JSON, GET never does), upstream
      status passthrough, 502 unreachable / 504 timeout / 502 size cap
      (2 MB), invalid env pairs degrade to `unknown_ref`
- [x] Adapter tests (6, `lib/data-sources/api-adapter.test.ts` "keyed"
      describe): `auth.ref` rewrites to `POST /api/data-proxy`
      `{ref, path, method}`, writes carry the inner record, unconfigured
      ref fails `unavailable` naming the ref + env vars, genuine upstream
      404 through the proxy still reads as notFound/null, malformed auth
      fails initialize, **Lane 1 regression pinned** (keyless fetches the
      absolute URL directly)
- [x] Validation tests: shape-only auth accepted (bearer + named header),
      five malformed shapes rejected at `config.auth`, a key VALUE hidden
      in `auth.key` rejected ("never live in specs"), allowed-keys message
      now lists `"baseUrl", "itemsPath", "auth"`
- [x] e2e (2 journeys, `data-sources.spec.ts` "keyed API" describe, MSW
      `*/api/data-proxy` handler): keyed todo design renders the store
      only reachable through the proxy, create round-trips with
      `__LAST_PROXY_WRITE__ = {ref: "weather", path: "/todos", method:
      "POST"}` and `clientSentAuth: false` (the MSW handler fails the
      invariant if any auth header rides the client call); reload re-reads
      the origin's fresh state (nothing stored locally); unconfigured ref
      degrades to the friendly error branch with the page intact
- Live spot-check against a real keyed API: not run at implementation —
  verification is the MSW keyed fixture per user decision (2026-10-20);
  **executed later the same day, see "Live spot-check" below**

### Live spot-check (executed 2026-10-20, via chrome-devtools MCP)

The ad-hoc deferred check ran against a purpose-built **protected API**:
`demo/keyed-pokedex-server.ts` (port 4100, requires
`Authorization: Bearer <DEMO_KEY>`, forwards to pokeapi.co; committed so
the demo is reproducible) paired via
`DATA_PROXY_POKEDEX_ORIGIN/KEY` in `.env.local` (dev hot-reloads env).
Design `demo/pokedex-keyed-spec.json` imported through the History
drawer's "Import JSON" — the import seam accepted `auth.ref` live.

**Battery (all passed):**

- Wrapper alone: no key → **401**; with key → pokeapi data (rows
  enriched server-side with official-artwork `image` URLs — derived
  server-side per the derived-strings lesson)
- Keyed section renders **12/12 artwork images loaded** (`naturalWidth`
  475) through the proxy; browser network shows the whole read as one
  `POST /api/data-proxy [200]` whose body is `{"ref","path","method"}`
  with **no authorization header**, and **zero** app-driven requests to
  `:4100` for the keyed path
- **Keyless contrast section** (second data source, no `auth` → Lane 1
  browser-direct): `GET localhost:4100 [401]` from the browser with no
  `authorization` header (CORS enabled on the wrapper by demo decision
  so the 401 is *readable*), and the error branch renders the **actual**
  adapter message bound from
  `/queries/directList/error/message`: "The API refused the request
  (HTTP 401) — this provider supports public, unauthenticated endpoints
  only." — gallery above keeps rendering (query isolation)
- **Unconfigured ref (decision 4) observed live by accident**: with the
  env pair removed mid-test the keyed section degraded to its error
  branch while the keyless section kept reaching the API; route probe
  answered `{"error":"unknown_ref"}` — per-ref isolation confirmed
- Wrapper log interleaves `key present` (proxied) / `key MISSING/wrong`
  (direct); degradation + recovery proven by killing/restarting the
  wrapper (error branch → reload → 12/12 back)
- Evidence: MCP screenshots were taken during the session and reviewed
  live (gallery render, degradation state, keyless-401 section); the
  image files were not kept in the repo — this record is the log
- Gates after demo changes: format / lint / tsc / 569 unit — green
  (demo `.ts` is inside the tsconfig `**/*.ts` scope)

**Demo decisions:** wrapper enables CORS (`Access-Control-Allow-Origin`)
so a keyless browser-direct call surfaces a real 401 instead of an
opaque CORS failure — the API remains protected (401 without the key
regardless of origin); images are official artwork
(`sprites/pokemon/other/official-artwork/{id}.png`).

### Implementation notes (decisions refined during build)

- **The env pair owns the header style entirely.** The spec's
  `auth.type`/`auth.header` are declarative (shape documentation for
  humans); the injected header name + style come only from the server's
  `DATA_PROXY_<REF>_*` pair — a spec cannot influence how a credential
  travels. Incomplete/invalid pairs skip (ref degrades to unconfigured).
- **`requestJson` now re-throws `DataError`s** from the fetch layer
  untouched (was re-labeling the adapter's unknown-ref diagnostic as
  "network or CORS").
- **MSW keyed store resets on reload** (handlers run in page context) —
  the journey asserts the origin's fresh seed after reload, which pins
  the "nothing stored locally" property.

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-20 | plan drafted after lessons grep (nothing lane-specific) + json-render skill audit + 048 record review; open questions: custody model, demo target, proxy scope, auth shapes |
| 2026-10-20 | approved — env-held app keys + MSW-only fixture, auth-declared sources only, header-only auth; decision 4 revised to runtime refusal (client seams cannot see server env) |
| 2026-10-20 | implemented — `POST /api/data-proxy` + `lib/data-proxy/refs.ts` env pairs + `lib/data-sources/api-auth.ts` policy; adapter transport swap behind `config.auth`; INDEX row 049 fixed stale + 050 added; gates green (format/lint/tsc/569 unit/build/111 e2e) |
| 2026-10-20 | live spot-check executed (deferred check) — `demo/keyed-pokedex-server.ts` protected wrapper + `demo/pokedex-keyed-spec.json` gallery/keyless-contrast design; MCP-verified: keyed 12/12 images via proxy, keyless direct 401 rendered live, unknown_ref isolation observed; gates green |
