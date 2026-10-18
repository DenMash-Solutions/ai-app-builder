# Data Sources M0+M1 (localStorage) — Implementation Plan

**Status:** implemented — verification green (format, lint 0, tsc, 491 unit, build, 99 e2e, MCP real-generation spot-check). Rev 1.3
**Date:** 2026-10-17
**Source:** root `data sources.md` (program document — M2 Database, M3 API, config UI stay unformalized there until separately scoped). *User decision: keep the root file for reference; it gets deleted once this feature is done.*

## Goal

Generated UIs read and write persistent data through a **provider-independent contract**, without coupling specs to a storage provider. Milestone 0 (schema + validation + adapter contract) and Milestone 1 (localStorage end-to-end) are formalized here: a generated todo list reads saved todos, creates/completes/deletes them, keeps them after reload, exposes loading/empty/error states — and the **model can generate all of this** (approved: guidance is in M1).

## Context — LS-01 audit findings (verified 2026-10-17)

Empirical (scripts run against the installed packages):

- `validateSpec` accepts new top-level `dataSources`/`resources`/`queries` keys → `valid: true, issues: []`.
- `validatePatchText` (`lib/playground/patch-text.ts`) checks op + non-empty path only — no path allowlist; `/dataSources/*` lines pass the generate route's validator.
- `createSpecStreamCompiler` applies `add` patches to brand-new top-level keys (auto-creates intermediates); compiled spec carries all three blocks.
- Tolerant seams (no changes needed): `isNonEmptySpec` (root + ≥1 element), `normalizeSpecCopy` (returns `{ ...spec, state, elements }`), `parseSpecJson` (returns the raw object after shape checks), `serializeSpec` (stringifies the whole spec).

Structural:

- **Runtime state ≠ persisted spec.** The provider's state store is separate from `displayedSpec`/`entry.spec`; entries, publish payloads, and exports serialize spec objects only. `handleCanvasStateChange` (`playground.tsx:451`) reacts to the `locale` path and ignores everything else — so a runtime `/queries/**` mirror **cannot leak into saved specs**.
- **State write paths exist**: `useStateBinding(path): [value, setValue]` and `ActionFn(params, setState, state)` are exported from `@json-render/react`.
- **Action wiring precedent**: `switch_language`/`switch_theme` are declared catalog actions; surface `handlers` (playground/preview/live) exist and are stable-once behind refs; static bake passes `handlers={{}}`; registry carries inert defaults.
- **Gap — `classifySpec`** (`lib/publish/bake.tsx:30`): stateful ⇔ element `on`/`watch`/`$bindState`/`$bindItem`. A queries-only spec would bake to static `content` and never fetch → queries/dataSources presence must force `stateful`.
- **Gap — key namespacing**: `storageKeyPrefix: "genui"` alone shares one store across every design and every visitor's public page.
- **Gap — model guidance**: program has no prompt/rules/fixture work; without it only hand-written specs work.

## Decisions

1. **D1 — Mirror, don't invent binding grammar.** The query manager mirrors results into runtime state under the reserved namespace **`/queries/<name>` = `{ data, status: "idle"|"loading"|"success"|"error", count: number, error: {code,message}|null }`** (rev 1.1: **`count` added** during T6 design — the empty branch and the "N items" counter need `visible: {"$state": "/queries/<n>/count", eq: 0}` / a plain count read; without it they'd need a new `$computed` function, which is more machinery than one mirrored field). Components use the existing machinery unchanged: `{ "$state": "/queries/todoList/data" }`, `repeat: { statePath: "/queries/todoList/data" }`, `visible: { "$state": "/queries/todoList/status", eq: "loading" }` (`{$and: [...]}` combines branches), `$template`, `watch`. The program's `{ "binding": "queries.todoList.data" }` syntax is dropped — it violated its own "follow existing runtime conventions". `spec.state.queries` (seed) is ignored/overwritten by the manager for declared queries; documented as reserved.
2. **D2 — Mutations = declared catalog action `data_mutate`, registered at RUNTIME inside the provider tree.** Params `{ op: "create"|"update"|"delete", resource: string, input?: expr, id?: expr }` (zod in the catalog actions block next to `switch_language`/`switch_theme`; `$state` expressions for input). *Rev 1.2 mechanism correction (audit addendum, empirically verified against the installed json-render + app wiring):* `defineRegistry`'s `actions` map is **inert in this app** — surfaces pass their own `handlers` to `JSONUIProvider`, `ActionProvider` consults only those (plus built-ins and runtime `registerHandler`); the registry stubs for `switch_language`/`switch_theme` never execute (theme's persistence is a surface handler; the ThemeSwitcher's bound write does the state change). Therefore `data_mutate` = catalog declaration (prompt-facing) + inert registry stub (type requirement) + **`registerHandler` wiring from `<QueryLoader>`**, the same precedent as `auth.*`/`admin.*` actions registered inside SpecPage's providers. One shared component mounted next to each surface's `Renderer` keeps provider-generic placement; the handler resolves `resource → dataSource` from the spec config the loader attached to the manager and reads live state (`useStateStore().getSnapshot()`) for `$item`-path deref. Static `content` bakes never carry queries (D4), so no handler exists there — consistent.
   *Rev 1.1 (T7 design, empirically verified):* per-item ids come from `{ "$item": "id" }` — json-render resolves `$item` action params to the **absolute state path** (`resolveBindItemPath` → `/queries/todoList/data/<i>/id`, the documented "resolves to the absolute state path" behavior built for `setState`/`removeState`). `data_mutate` therefore dereferences a `/`-leading `params.id` against the received `state` (`getByPath`) before hitting the adapter; literal ids (UUIDs) pass through unchanged. Adapter contract stays id-based (provider-independent — a DB adapter must not care about repeat indices).
3. **D3 — Spec blocks + validation.** Top-level `dataSources` (provider ∈ `{"localStorage"}` + config), `resources` (dataSource, collection, schema, primaryKey), `queries` (resource, operation) — names per program §5. New `validateDataSources(spec)` (zod-based) checks required fields, duplicate ids, unknown references, supported providers/ops, and **rejects credentials/secret-shaped config keys**. Wired at: generate completion, `parseSpecJson` import, publish. Failures return actionable issues through the existing failure dialog/toast path (**one new i18n key pair en/es if no existing copy fits** — flagged exception; decided per-repo-rule for friendly copy).
4. **D4 — `classifySpec` counts queries.** Non-empty `spec.queries` or `spec.dataSources` → `"stateful"` (client engine, handlers/registry active). `bake.test.ts` gains a case.
5. **D5 — State ownership.** Runtime query results live only under `/queries/**`, written only by the manager; persisted specs never contain them (Context structural finding); mutations persist **through the adapter**, which is the whole point. UI-only state (form drafts, selection) stays in normal state paths outside `/queries`. Mirror writes are safe from `onStateChange` (non-locale paths are ignored).
6. **D6 — localStorage strategy.** One JSON array per collection; key `"{prefix}:{namespace}:{collection}"` with `prefix` default `genui-data` and **namespace = entry id (playground) / slug (published + preview)** — per-design isolation (audit gap fixed). `crypto.randomUUID()` ids, primary-key uniqueness enforced, schema-subset validation before every write, malformed/unavailable storage → `status:"error"` with a recoverable message. Cross-tab: `storage` event refresh; documented limitation: last-write-wins on concurrent mutations.
7. **D7 — Model guidance in M1.** Styling-rules bullet (canonical wiring: dataSources/resources/queries + `$state` reads + `data_mutate` + loading/empty/error `visible` branches; secure-by-construction: never declare credentials) with unit assertion; catalog action description; **MSW fixture `TODO_UI_LINES`** so e2e stays deterministic (repo e2e rules — browser UI only, no live model).
8. **D8 — React glue.** `lib/data-sources/` (types, validate, registry, `providers/localstorage.ts`, manager). A `<QueryLoader spec={spec}/>` component renders **inside each surface's `JSONUIProvider`** next to `Renderer` (playground, preview-client, live-page, spec-page client): mounts declared queries, dedupes reads, mirrors state via `useStateBinding`, refreshes affected queries after `data_mutate`, subscribes to `storage` events. Per-document singletons (adapter registry + query cache) — documented M1 limitation.
9. **D9 — No new catalog components.** Todo = existing Stack/repeat, form components, buttons; loading/empty/error = `visible` conditions on the mirrored status. Catalog changes: the `data_mutate` declaration only.

**Rejected:** new binding grammar (`binding: "queries…"`); per-spec executable code (program §3); config editor (deferred with M2/M3); optimistic updates without rollback (API milestone concern); shared `genui` key prefix.

## Out of scope

- Milestone 2 (database) and Milestone 3 (API) — unformalized; see root program document.
- Data-source configuration UI (separate plan, after runtime stabilizes).
- Offline queueing, optimistic updates, schema migrations, cross-tab write arbitration beyond storage-event refresh.

## Tasks

- [x] T0 (LS-01) Audit — completed pre-approval; findings in Context (empirical evidence recorded above).
- [ ] T1 (LS-02) Types: `lib/data-sources/types.ts` — zod schemas for data-source/resource/query definitions + operation union; stable-id rules; extensible provider enum.
- [ ] T2 (LS-03) `validateDataSources(spec)`: required fields, duplicate ids, unknown references, unsupported providers/ops, credential-shaped keys rejected; wire into generate completion, `parseSpecJson`, publish; actionable en/es errors via existing failure surfaces (new key pair only if none fits).
- [ ] T3 (LS-04) Adapter contract: `DataSourceAdapter` (`initialize/list/get/create/update/delete/dispose`), normalized `DataError {code,message}`, capability flags.
- [ ] T4 (LS-05) Adapter registry: provider → adapter, per-document singleton, shared init, dispose on runtime teardown.
- [ ] T5 (LS-06) localStorage adapter: namespaced keys (D6), array-per-collection, UUID ids, write validation, malformed/missing/unavailable handling.
- [ ] T6 (LS-07 + LS-11) QueryManager + `<QueryLoader>`: resolve query → resource → adapter; `idle→loading→success/error` transitions; read dedupe; mutation-driven refresh; `storage`-event cross-tab refresh (last-write-wins documented).
- [ ] T7 (LS-09) `data_mutate`: catalog declaration + registry action; input validation; affected-query refresh; error → mirrored status with preserved code/message.
- [ ] T8 (LS-08) Bindings verified: `$state`/`repeat`/`visible`/`watch` read off `/queries/**` (integration tests; unknown refs already rejected by T2 — no renderer changes expected).
- [ ] T9 (LS-10) State ownership: `/queries` reserved-namespace documented; regression test — after mutations + entry save, persisted `entry.spec` and exported JSON contain no query results and no `/queries` state.
- [ ] T10 (LS-12 + LS-13) Todo fixture `TODO_UI_LINES`: list from `/queries/todoList/data`, add form (bound input → `data_mutate create`), complete (`update`), delete (`delete`), loading/empty/error branches via `visible`.
- [ ] T11 (LS-14) Unit tests: adapter CRUD + id/schema validation, `validateDataSources` diagnostics, query-state transitions, manager dedupe/refresh, `classifySpec` queries→stateful, json-io round-trip with new blocks.
- [ ] T12 (LS-15) E2e journeys (MSW fixture, browser UI only): generate todo → create/complete/delete → **reload persists**; two components on one query update together; preview route honors data; **published page journey** (authed publish → fresh visitor creates a todo → reload → it persists in the visitor's own storage). Empty + error branches visible. *(Loading-branch journey descoped 2026-10-17 — see status log; covered by the unit integration test instead. Cross-tab `storage`-event freshness journey added in its place.)*
- [ ] T13 (LS-16) `docs/data-sources.md`: provider contract, config reference, limitations (cross-tab, per-document singleton, client-only), how to implement another adapter.
- [ ] T14 Model guidance: styling-rules bullet + test, catalog prompt description, spot-check real generation.
- [ ] T15 Full gate (format, lint, tsc, unit, build, e2e) → `Status: implemented`; commit after user's go-ahead.

## Acceptance criteria (M1)

- Generated todo list loads todos from localStorage; create/update/delete persist; **data survives reload** (playground and a published page for a fresh visitor).
- Every component on the same query updates together after a mutation.
- Invalid data-source config fails validation with actionable diagnostics; no credentials possible in specs.
- Loading, empty, and error states are distinguishable in the UI (fixture branches + e2e assertions).
- Specs without `dataSources` behave exactly as today (regression suite green); `/queries` never appears in saved/exported/published specs.
- Model-generated specs (MSW fixture + one real-generation spot check) pass validation and render the todo flow.

## Verification

- [x] Unit: 491 pass / 0 fail (adapter CRUD, validation diagnostics, state transitions + supersession/dedupe/stale-write, classify, round-trip, bindings integration, stream-block recovery).
- [x] E2e: 99 pass — the four new journeys (CRUD+reload, count/list pair, corrupt-storage error, cross-tab storage event; authed publish + per-visitor isolation) plus the pre-existing suite (95 → 99).
- [x] MCP spot-check (real generation, repo MCP pass): **gemini-3.8-flash follows the recipe end-to-end** — all three blocks (`dataSources.local`, `resources.todos` with schema, `queries.allTodos`), `data_mutate` ×4, `/queries` correctly left unseeded, count + empty branches render, create → count 0→1 → reload → task survives. The streamed block lines came from the real model and the stream recovery carried them into the committed entry (validates the rev 1.3 fix beyond MSW). **Adherence caveat:** the default `gemini-3.1-flash-lite` ignores the recipe entirely (falls back to a pure state-based todo with pushState/removeState; guidance confirmed present in the system prompt) — same lite-class weakness as the known generate-mode JSONL repair follow-up. The recipe is in the request path; stronger models follow it.
- [x] Full gate green: format, lint (0), `tsc --noEmit`, unit 491, build, full e2e 99.

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-17 | program document drafted (root `data sources.md`): 3 milestones + cross-provider requirements |
| 2026-10-17 | user decisions: formalize **M0+M1 only**; **model guidance included in M1**; audit first |
| 2026-10-17 | LS-01 audit completed (empirical: validateSpec/patch-compiler/json-io all tolerate new top-level keys; runtime store isolated from persisted specs; `classifySpec` + key namespacing + model guidance identified as gaps) — rev 1 drafted, **awaiting approval** |
| 2026-10-17 | user: root `data sources.md` stays until the feature is done, then deleted |
| 2026-10-17 | rev 1 **approved** ("ok"); implementation starts — T1 onward. Rev 1.1 design notes recorded same turn: D1 mirror gains `count` (empty/counter reads without a new `$computed`), D2 `$item` params resolve to state paths → `data_mutate` dereferences them against `state` (verified against the installed json-render runtime) |
| 2026-10-17 | rev 1.2: D2 **mechanism** correction recorded same turn as implementation — registry `actions` are inert in this app (verified: `ActionProvider` consults surface `handlers` + built-ins + runtime `registerHandler`; the registry's `handlers` factory is never called). `data_mutate` wires via `registerHandler` from `<QueryLoader>` (auth-actions precedent) |
| 2026-10-17 | rev 1.3: T12 **loading-branch e2e descope** recorded same turn — traced empirically: with the synchronous localStorage store the loading→success mirror writes land in one task (the busy-wait instrumentation blocks before React's scheduled render), so the loading frame cannot paint. The loading branch stays in the fixture + is covered by the unit integration test (`query-bindings.test.tsx`); a cross-tab `storage`-event freshness journey (D6) replaces the planned loading journey e2e. Async adapters (M2/M3) will make loading paintable |
| 2026-10-17 | rev 1.3 (T12/T15 discoveries, both fixed same turn): (1) **`useUIStream` drops the data blocks** — its internal `setSpecValue` only understands `/root`, `/state`, `/elements/*` and silently discards other root members (verified against 0.21.0 **and** 0.21.1; the LS-01 audit covered the *core* SpecStream compiler, a different path). Fix: the playground's completion commit is deferred to an effect after the stream state settles, and `lib/data-sources/stream-blocks.ts` re-folds the raw JSONL lines with the core compiler, merging the three blocks back (steer-safe: base blocks ride the shallow spread). (2) **StrictMode remount race**: detach disposed the adapter (`storage = null`) under an in-flight load, whose dedupe slot blocked the replacement load and whose `unavailable` error then won by timing. Fix: per-(namespace, query) generation counter — detach supersedes in-flight reads (their writes are dropped) and frees their dedupe slot |
| 2026-10-18 | T1–T15 **implemented** — M0+M1 shipped per rev 1.3: schema + validate + adapter contract + localStorage adapter + manager (mirrors, dedupe, supersession, storage events) + QueryLoader (`data_mutate` via `registerHandler`) + mounts in playground/preview/published/spec-page + json-io/go-live validation + en/es copy + model guidance (catalog `data_mutate` declaration + styling-rules recipe) + docs + fixtures. Verification green: format, lint 0, `tsc --noEmit`, 491 unit, build, **99 e2e** (95 pre-existing + 3 anonymous data-source journeys + 1 authed publish/per-visitor journey), MCP real-generation spot-check (3.8 Flash follows the recipe end-to-end incl. reload persistence; default 3.1 Flash Lite ignores it — adherence caveat recorded above). Root `data sources.md` stays untracked until the user deletes it |
