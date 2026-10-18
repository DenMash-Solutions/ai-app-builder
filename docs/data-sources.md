# Data Sources — Reference (M1)

**Milestone:** M0+M1 (`docs/plan/data-sources/plan.md`) — declarative data blocks in the spec, a query mirror in runtime state, and `data_mutate` writes, backed by the visitor's own `localStorage`.

A generated design can declare persistent data without any renderer changes: the three top-level spec blocks are ordinary spec content, and `/queries/**` is ordinary runtime state. Everything below lives in `lib/data-sources/` + `components/data-sources/`.

## The three spec blocks

```jsonc
{
  "root": "page",
  "elements": { "...": "..." },
  "state": { "newTodo": "" },            // raw form state only — never /queries
  "dataSources": {
    "localTodos": { "provider": "localStorage", "config": {} }
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

- **`dataSources`** — named stores. M1 supports `{ "provider": "localStorage", "config": {} }`; `config.storageKeyPrefix` (default `genui-data`) scopes every key.
- **`resources`** — named collections inside a store. `schema` is the write-time contract: `create`/`update` records must carry every schema field with the declared type (`id` is generated on create; it is exempt).
- **`queries`** — named reads. Each query mirrors into state (below). Unknown references (`resource` → missing resource, `dataSource` → missing data source) and credential-shaped config keys (`apiKey`, `token`, …) are rejected at generate/import/publish with issue details.

## The query mirror (D1)

Every query writes `/queries/<name>` in runtime state:

```jsonc
{ "data": [ /* records */ ], "status": "loading", "count": 0, "error": null }
```

- `status`: `idle → loading → success | error` (the path always exists — bindings never see `undefined`).
- `count`: `data.length` — the empty state binds `{"$state": "/queries/<name>/count", "eq": 0}` together with `status: "success"` (implicit AND array).
- `error`: `null` or `{ "code": "<data error code>", "message": "…" }`.

Specs bind to it like any state: `repeat.statePath` over `/queries/<name>/data`, `$item` for per-record fields, `visible` branches on `status`/`count`. Cross-component freshness is free — every bound component re-renders when the mirror is rewritten (verified by the count Text + list pair in the e2e fixture).

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
            └─ localStorageAdapter — injectable Storage, schema-validated writes
```

- `lib/data-sources/types.ts` — zod schemas, statuses, path helpers, `DataError` codes (`malformed`, `notFound`, `invalidRecord`, `unavailable`, `unknownProvider`, `resourceNotFound`, `unsupported`, `unknown`).
- `lib/data-sources/validate.ts` — `validateDataSources(spec)` (shape + cross-refs + credential rejection) + `describeDataIssues`; runs at generate/steer ingest, JSON import, and go-live.
- `lib/data-sources/adapter.ts` — the `DataSourceAdapter` contract.
- `lib/data-sources/adapter-registry.ts` — provider → factory map, one instance per `(dataSource, namespace)`, disposed on detach.
- `lib/data-sources/local-storage-adapter.ts` — M1 adapter.
- `lib/data-sources/query-manager.ts` — mirrors, dedupe, refresh, storage events; per-document singleton. Detach **supersedes** in-flight reads (per-query generation counter): a stale load never writes over its replacement's mirror, and its dedupe slot is freed — this is what keeps StrictMode's mount→detach→mount honest.
- `lib/data-sources/stream-blocks.ts` — **stream recovery**: `useUIStream` (in `@json-render/react` ≤0.21.1) applies patches through an applier that only understands `/root`, `/state` and `/elements/*` — `add /dataSources|/resources|/queries` lines are silently dropped mid-stream. The playground's completion commit is therefore deferred until the stream settles, and this helper re-folds the raw JSONL lines with the core SpecStream compiler, merging the blocks back onto the spec.
- `components/data-sources/query-loader.tsx` — attach/detach lifecycle + `data_mutate` handler registration.
- `lib/publish/bake.tsx` — `classifySpec` returns `stateful` for any spec with data blocks (D4), so published pages keep the runtime.

## Limitations (M1, by design)

- **Client-only**: reads/writes happen in the visitor's browser; no server persistence, no sharing, no auth-scoped data. Published `content` pages with data blocks are `stateful` and need JavaScript.
- **Per-document singleton**: one manager per page; multiple `<QueryLoader>`s of the same namespace dedupe reads, but M1 targets one data-bearing surface per document.
- **Synchronous store**: the loading mirror lasts microseconds (localStorage never yields) — the loading branch is unit-covered, and becomes paintable with async adapters (M2/M3).
- **No credentials, ever**: credential-shaped config keys are rejected at every ingest seam.
- **Cross-tab = last write wins** (silent re-read, no merge).

## Implementing another adapter (M2/M3)

1. Create `lib/data-sources/<provider>-adapter.ts` exporting a factory matching `AdapterFactory` (`(def, context) => DataSourceAdapter`) — implement `initialize/list/get/create/update/delete/dispose`, throw `DataError` with the right code, honor `resource.schema` on writes, and scope every key/record by `context.namespace`.
2. Register it in `adapter-registry.ts`'s `FACTORIES` map (object-based — no string literals) and add the provider to `DATA_SOURCE_PROVIDERS` + `dataSourceDefSchema` in `types.ts`.
3. Credential-bearing providers: extend `validateDataSources` to reject secrets in specs while reading real credentials from runtime config, never from the spec.
4. Cover it with the same test shape as `local-storage-adapter.test.ts` (fake store, no DOM).
