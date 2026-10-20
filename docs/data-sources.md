# Data Sources — Reference (M1 + M2)

**Milestones:** M0+M1 (`docs/plan/043-data-sources/plan.md`) — declarative data blocks in the spec, a query mirror in runtime state, and `data_mutate` writes, backed by the visitor's own `localStorage`. M2 (`docs/plan/046-database-provider/plan.md`) — the `supabase` provider: the same declarative shape over the project database, per-visitor rows under RLS (see [Supabase provider (M2)](#supabase-provider-m2)).

A generated design can declare persistent data without any renderer changes: the three top-level spec blocks are ordinary spec content, and `/queries/**` is ordinary runtime state. Everything below lives in `lib/data-sources/` + `components/data-sources/`.

## The three spec blocks

```jsonc
{
  "root": "page",
  "elements": { "...": "..." },
  "state": { "newTodo": "" },            // raw form state only — never /queries
  "dataSources": {
    "localTodos": { "provider": "localStorage", "config": {} }
    // or the database provider (M2, config must stay EMPTY):
    // "dbTodos": { "provider": "supabase", "config": {} }
  },
  "resources": {
    "todos": {
      "dataSource": "localTodos",
      "schema": { "title": "string", "done": "boolean" },
      "collection": "todos",             // optional key override (defaults to the resource name)
      "primaryKey": "id"                 // optional (defaults to "id")
    }
  },
  "queries": {
    "todoList": { "resource": "todos", "operation": "list" },
    "oneTodo":  { "resource": "todos", "operation": "get", "params": { "id": "…" } }
  }
}
```

- **`dataSources`** — named stores. Two providers, one shape: `{ "provider": "localStorage"|"supabase", "config": {} }`. localStorage scopes keys with `config.storageKeyPrefix` (default `genui-data`); supabase takes **no config at all** — connection comes from app env, and any config field on it is a validation issue.
- **`resources`** — named collections inside a store. `schema` is the write-time contract: `create`/`update` records must carry every schema field with the declared type (`id` is generated on create; it is exempt).
- **`queries`** — named reads. Each query mirrors into state (below). Unknown references (`resource` → missing resource, `dataSource` → missing data source) and credential-shaped config keys (`apiKey`, `token`, …) are rejected at generate/import/publish with issue details.

## The query mirror (D1)

Every query writes `/queries/<name>` in runtime state:

```jsonc
{ "data": [ /* records */ ], "status": "loading", "count": 0, "error": null, "pending": false }
```

- `status`: `idle → loading → success | error` (the path always exists — bindings never see `undefined`).
- `count`: `data.length` — the empty state binds `{"$state": "/queries/<name>/count", "eq": 0}` together with `status: "success"` (implicit AND array).
- `error`: `null` or `{ "code": "<data error code>", "message": "…" }`.

Specs bind to it like any state: `repeat.statePath` over `/queries/<name>/data`, `$item` for per-record fields, `visible` branches on `status`/`count`, and on `pending` while a `data_mutate` write for the resource (plus its refresh) is running. Cross-component freshness is free — every bound component re-renders when the mirror is rewritten (verified by the count Text + list pair in the e2e fixture).

## Writing: `data_mutate`

The catalog action (declared in `lib/playground/catalog.ts`, handled at runtime via `registerHandler` from `<QueryLoader>` — the registry's `actions` map is inert in this app, rev 1.2):

| op | params | notes |
| -- | ------ | ----- |
| `create` | `{ "resource", "input": { "title": { "$state": "/newTodo" }, "done": false } }` | `input` is an object whose fields may be state expressions (they deep-resolve); generates a UUID `id`; schema-validated |
| `update` | `{ "resource", "id": { "$item": "id" }, "input": { "done": true } }` | merge-patch; `not_found` for unknown ids |
| `delete` | `{ "resource", "id": { "$item": "id" } }` | `not_found` for unknown ids |

`$item` params resolve to the record's **absolute state path** (`/queries/todoList/data/2/id`) — `data_mutate` dereferences `/`-leading ids against live state (D2 rev 1.1); literal ids pass through. After every mutation the manager silently re-reads all queries over that resource, so the UI never needs a manual refresh. Failures `console.error` and leave the mirror untouched.

## Namespaces (D6)

Storage keys are `{prefix}:{namespace}:{collection}` — the namespace scopes records per design and surface:

| surface | namespace |
| ------- | --------- |
| playground canvas | the open entry's id (`local` before first save) |
| local preview + published pages | the design's `slug` (owner preview and visitor share one per-browser store) |
| featured live root | `featured` |
| spec-page (`app` chrome) | `app` |

Records are **per browser, per design** — never shared between visitors or designs. Cross-tab: a `storage` event silently re-reads the affected collection (last write wins; no merge).

## Architecture

```
<QueryLoader spec namespace>        (one per surface; components/data-sources/)
  └─ queryManager.attach({ namespace, dataSources, resources, queries, write })
       ├─ mirror writes via the provider's state channel (the SPEC is never written — T9)
       └─ loads through adapterRegistry.get(provider, def, { namespace })
            ├─ localStorageAdapter — injectable Storage, schema-validated writes
            └─ supabaseAdapter (M2) — session-ensure, PostgREST CRUD over genui_records
```

- `lib/data-sources/types.ts` — zod schemas, statuses, path helpers, `DataError` codes (`malformed`, `notFound`, `invalidRecord`, `unavailable`, `unknownProvider`, `resourceNotFound`, `unsupported`, `unknown`).
- `lib/data-sources/validate.ts` — `validateDataSources(spec)` (shape + cross-refs + credential rejection) + `describeDataIssues`; runs at generate/steer ingest, JSON import, and go-live.
- `lib/data-sources/adapter.ts` — the `DataSourceAdapter` contract.
- `lib/data-sources/adapter-registry.ts` — provider → factory map, one instance per `(dataSource, namespace)`, disposed on detach.
- `lib/data-sources/local-storage-adapter.ts` — M1 adapter.
- `lib/data-sources/supabase-adapter.ts` — M2 adapter: session ensure (reuse signed-in user, else one anonymous sign-in cached per document), PostgREST CRUD filtered on `(app_id, resource)`, client-side schema validation on reads and writes, normalized `DataError`s.
- `lib/data-sources/record-validate.ts` — shared record schema validation used by both adapters.
- `lib/data-sources/query-manager.ts` — mirrors, dedupe, refresh, storage events; per-document singleton. Detach **supersedes** in-flight reads (per-query generation counter): a stale load never writes over its replacement's mirror, and its dedupe slot is freed — this is what keeps StrictMode's mount→detach→mount honest.
- `lib/data-sources/stream-blocks.ts` — **stream recovery**: `useUIStream` (in `@json-render/react` ≤0.21.1) applies patches through an applier that only understands `/root`, `/state` and `/elements/*` — `add /dataSources|/resources|/queries` lines are silently dropped mid-stream. The playground's completion commit is therefore deferred until the stream settles, and this helper re-folds the raw JSONL lines with the core SpecStream compiler, merging the blocks back onto the spec.
- `components/data-sources/query-loader.tsx` — attach/detach lifecycle + `data_mutate` handler registration.
- `lib/publish/bake.tsx` — `classifySpec` returns `stateful` for any spec with data blocks (D4), so published pages keep the runtime.

## Limitations (by design)

- **No sharing of stored records, ever**: records are always the visitor's own — per-browser with localStorage, per signed-in visitor with supabase (RLS). There is no cross-visitor access on either storage provider; the api provider (M3) differs in kind — it reads public upstream data every visitor sees identically and stores nothing. Published `content` pages with data blocks are `stateful` and need JavaScript.
- **Per-document singleton**: one manager per page; multiple `<QueryLoader>`s of the same namespace dedupe reads, but M1 targets one data-bearing surface per document.
- **localStorage is synchronous**: the loading mirror lasts microseconds (localStorage never yields) — the loading branch is unit-covered and paints for the async supabase provider (M2 e2e).
- **No credentials, ever**: credential-shaped config keys are rejected at every ingest seam.
- **Cross-tab = last write wins** (silent re-read, no merge; supabase updates are last-writer-wins too — see below).

## Implementing another adapter (M2/M3)

1. Create `lib/data-sources/<provider>-adapter.ts` exporting a factory matching `AdapterFactory` (`(def, context) => DataSourceAdapter`) — implement `initialize/list/get/create/update/delete/dispose`, throw `DataError` with the right code, honor `resource.schema` on writes, and scope every key/record by `context.namespace`.
2. Register it in `adapter-registry.ts`'s `FACTORIES` map (object-based — no string literals) and add the provider to `DATA_SOURCE_PROVIDERS` + `dataSourceDefSchema` in `types.ts`.
3. Credential-bearing providers: extend `validateDataSources` to reject secrets in specs while reading real credentials from runtime config, never from the spec.
4. Cover it with the same test shape as `local-storage-adapter.test.ts` (fake store, no DOM).

## Supabase provider (M2)

**Milestone:** M2 (`docs/plan/046-database-provider/plan.md`) — the same three spec blocks, backed by the project database instead of the visitor's browser:

```jsonc
"dataSources": { "dbTodos": { "provider": "supabase", "config": {} } }
```

### Config

The config must be **empty** — any field is a validation issue (`dataSources.<name>.config … takes no config … RLS`). The connection (`NEXT_PUBLIC_SUPABASE_URL`, anon key) is app configuration read through `@/lib/supabase/client`; a spec never carries connection details, and specs stay credential-free as on every provider.

### Scoping: one table, `(app_id, resource)` row scopes

All generated data lives in one approved table, `public.genui_records` (`supabase/migrations/0001_genui_records.sql`):

| column | meaning |
| ------ | ------- |
| `app_id` | the design namespace (same D6 table as localStorage: entry id / slug / `featured` / `app`) |
| `resource` | the resource name from the spec |
| `id` | client-generated record id (PK part) |
| `user_id` | `auth.uid()` — the owning visitor session |
| `data` | the record payload (`jsonb`), schema-validated client-side on read and write |

Resources map to `(app_id, resource)` filters over `data` — never to named tables (rejected alternative: a table per resource; every app would need DDL on generation, which specs must never trigger). Composite PK `(app_id, resource, id)`; index on `(app_id, resource, created_at)` serves list reads.

### RLS expectations (the authorization boundary)

Four policies (`select/insert/update/delete … to authenticated using (user_id = auth.uid())`) make rows visible and writable **only by their owning session** — RLS, not the client, is what actually enforces isolation; the adapter filters scope, policies enforce it. Consequently:

- The adapter **ensures a session before any query**: a signed-in user reuses their session; a fresh visitor is transparently signed in anonymously once per document (cached — the sign-in runs at most once).
- Anonymous sign-in must be enabled on the project (Authentication → Sign In / Providers → Anonymous). If it's off, fresh visitors get the friendly `unavailable` error branch — signed-in visitors are unaffected.
- Sessions carry the `authenticated` role (Supabase anonymous users included), so policies admit them.
- Error normalization: RLS denial (42501/403) and expired/missing session (PGRST3x/401) and network failures (empty PostgREST code) → `unavailable`; unique violations (23505) → `unknown`.

### Semantics

- **Reads/writes are async** — the loading branch genuinely paints (M2 e2e) — the mirror contract is unchanged.
- **Update = read-modify-write** (merge-patch against the row's `data`) → **last-writer-wins** across tabs/devices of the same visitor; no server merge.
- Post-mutation auto-refresh, `$item` params, empty/error branches, and namespaces behave exactly as on localStorage — the mirror and `data_mutate` are provider-agnostic (the M1 e2e fixture ships the same design with only the data source line swapped: `TODO_UI_LINES_SUPABASE`).

### Adapter notes

`lib/data-sources/supabase-adapter.ts` — factory injectable with a resolver (`createSupabaseAdapter(def, context, resolveClient?)`, defaulting to a dynamic import of `@/lib/supabase/client`), so tests drive a structural fake PostgREST client (no network, no real supabase-js). The factory is registered in `adapter-registry.ts` `FACTORIES` (plus the `registerFactory` seam for tests). Deferred: Realtime updates (cross-device live refresh) is a follow-up milestone.

## API provider (M3)

**Milestone:** M3 (`docs/plan/048-api-data-source/plan.md`) — reads and writes a plain HTTPS JSON API **directly from the visitor's browser** (Lane 1: keyless, public endpoints — no server route, no proxy; Lane 2 adds keyed APIs via the server proxy — see [Keyed APIs](#keyed-apis--lane-2-docsplan050-keyed-api-laneplanmd) below):

```jsonc
"dataSources": {
  "shopApi": {
    "provider": "api",
    "config": { "baseUrl": "https://shop.example/v1", "itemsPath": "/data" }
  }
}
```

### Config

Three keys are accepted (`API_CONFIG_KEYS`): `baseUrl` (required), `itemsPath` (optional JSON pointer that unwraps an enveloped list response) and — since Lane 2 — `auth` (the shape-only keyed-API declaration below). Anything else (headers, query values) is a validation issue; credential-shaped keys remain globally rejected, and `auth` itself cannot carry a key value: it accepts only `type`, `ref` and `header`, so anything value-shaped fails `checkApiAuth` at the seams and again in the adapter.

### Endpoint policy (seams + adapter, defense in depth)

`checkApiBaseUrl` (`lib/data-sources/api-url.ts`) runs at all three ingest seams and again in the adapter's `initialize`:

- **https only** — plain http allowed for `localhost`/`127.0.0.1` (dev/e2e)
- no `user:pass@` userinfo, no `?query` (it would bypass the credential-key check), no `#fragment`
- no literal private/link-local/metadata addresses (10/8, 172.16/12, 192.168/16, 100.64/10, 169.254/16, 0/8, unique-local/link-local IPv6)
- hostname-based SSRF is bounded by the browser itself: CORS decides which origins answer. Lane 1's transport decision — a browser fetch is confined to the visitor's own network perspective; the enterprise reference plan's "server-side always" assumed a hardened egress worker this app deliberately does not build.

### Semantics

- `collection` → URL path segment: `GET|POST baseUrl/<collection>`, `GET|PATCH|DELETE baseUrl/<collection>/<id>` (both segments URL-encoded)
- Reads: `list` expects a JSON array (or an `itemsPath`-unwrapped one); `get` returns `null` on 404 (missing reads are not errors). Responses pass the shared `record-validate` schema check like every other provider
- Writes: `create` = POST (a valid echoed record wins over the client-generated one); `update` = read-merge-validate-PATCH (same partial-patch semantics as supabase, validation strictly before the write); `delete` = DELETE
- Error normalization to shared codes: 401/403/429/5xx/network/CORS → `unavailable`, 404 → `not_found`, 400/422 → `invalid_record`, non-JSON body → `malformed` — upstream detail never reaches the UI
- 15 s request timeout so a hanging API cannot pin `pending` forever
- The mirror, `$item` params, empty/error branches, validation gating and pending behave exactly as on the storage providers — the query manager never learns what a fetch is

### Adapter notes

`lib/data-sources/api-adapter.ts` — factory injectable with a fetch resolver (`createApiAdapter(def, context, resolveFetch?)`, defaulting to `globalThis.fetch`), so unit tests drive a scripted fake that asserts the exact URL/method/body per call (no network). No caching, no query-param plumbing, no cross-tab events (there is no shared store to observe) — post-mutation `refreshResource` is the freshness mechanism.

### Spot-check (M3 verification)

A plain-language Pokédex generation against `https://pokeapi.co/api/v2/pokemon/` exercised the provider end to end (live list reads through the browser-direct fetch; loading/error/empty branches covered by the e2e journeys). Derived per-item URLs must use the registered composition — `{"$concat": [base, {"$item": "id"}, ".png"]}` — because JavaScript inside `$template` silently resolves to `""`; the recipe line in `lib/playground/styling-rules.ts` teaches exactly this. Evidence log: `docs/plan/048-api-data-source/plan.md` (verification + incidents); general lesson: `.agents/lessons/template-derived-strings.md`.

## Keyed APIs — Lane 2 (`docs/plan/050-keyed-api-lane/plan.md`)

A spec may declare that an api data source needs a key. The declaration is **shape only** — the value lives in deployment env pairs and is injected by the server, so the browser never holds a credential and published specs stay secret-free:

```jsonc
"dataSources": {
  "weatherApi": {
    "provider": "api",
    "config": {
      "baseUrl": "https://api.weather.example",
      "auth": { "type": "bearer", "ref": "weather" }
    }
  }
}
```

`auth.type` is `"bearer"` (→ `Authorization: Bearer <key>`) or `"header"` with a named `header` (→ `X-API-Key: <key>`). Both fields are declarative for humans reading the spec — **the server's env pair decides how the key is actually sent**, so a spec can never change where or how a credential travels.

### Server configuration (env pairs)

Per ref, on the server (see `.env.example`):

```bash
DATA_PROXY_WEATHER_ORIGIN=https://api.weather.example  # bare https origin
DATA_PROXY_WEATHER_KEY=…                               # the secret, server-only
DATA_PROXY_WEATHER_HEADER=                             # optional; default Authorization: Bearer
```

Incomplete or invalid pairs (http on a public host, a path component, userinfo, private-address literals, bad header names) are skipped — the ref then reads as *unconfigured*.

### How a keyed request travels

1. The adapter (with `config.auth`) rewrites every CRUD request to `POST /api/data-proxy` with `{ ref, path, method, body }` — a path, never a URL.
2. The route (`app/api/data-proxy/route.ts`) resolves the ref in its env pairs, enforces that the path stays on that pair's **configured origin**, injects the auth header from its own config, and fetches with `redirect: "error"` (no key-bearing redirect hops), a 10 s timeout and a 2 MB response cap.
3. Upstream statuses/bodies pass through untouched — the adapter's existing error normalization maps them exactly as in Lane 1, so the mirror, branches, `$item` params and pending behave identically.

### Security posture (why no egress worker is needed here)

- **The client never names a URL.** A key is only ever sent to its env-paired origin; an attacker cannot steer the proxy at their own host to harvest it.
- **The client never holds a key.** No key material in the spec, in localStorage, or in any browser-visible response (specs are published as public HTML/JSON).
- **Only auth-declared sources use the proxy** — keyless stays browser-direct (Lane 1 unchanged), so the SSRF surface exists solely for deployment-configured origins.
- The key appears in no log line and no error body; an unconfigured ref answers `unknown_ref` (404) and the adapter's diagnostic names the ref plus the env vars to set.
- Out of scope for v1 (plan 050): per-user BYO keys (Supabase + UI), query-param auth, OAuth — the transport swap behind the adapter seam is the compatible foundation for all three.

e2e: the MSW worker stands in for the proxy (`*/api/data-proxy` handler) and asserts the client call carries **no** auth header; unit tests cover the route's origin enforcement, key redaction, caps and verb allowlist (`app/api/data-proxy/route.test.ts`, `lib/data-proxy/refs.test.ts`).
