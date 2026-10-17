# Data Sources M0+M1 (localStorage) — Implementation Plan

**Status:** draft (rev 1, awaiting approval)
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

1. **D1 — Mirror, don't invent binding grammar.** The query manager mirrors results into runtime state under the reserved namespace **`/queries/<name>` = `{ data, status: "idle"|"loading"|"success"|"error", error: {code,message}|null }`**. Components use the existing machinery unchanged: `{ "$state": "/queries/todoList/data" }`, `repeat: { statePath: "/queries/todoList/data" }`, `visible: { "$state": "/queries/todoList/status", eq: "loading" }`, `$template`, `watch`. The program's `{ "binding": "queries.todoList.data" }` syntax is dropped — it violated its own "follow existing runtime conventions". `spec.state.queries` (seed) is ignored/overwritten by the manager for declared queries; documented as reserved.
2. **D2 — Mutations = declared catalog action `data_mutate`, implemented in the REGISTRY.** Params `{ op: "create"|"update"|"delete", resource: string, input?: expr, id?: expr }` (zod in the catalog actions block next to `switch_language`/`switch_theme`; `$state` expressions for input). Registry actions receive `(params, setState, state)` → adapter call + affected-query refresh + mirror write in one provider-generic place, so playground, preview, and live get it for free. (Contrast `switch_language`: surface handlers because they needed playground closures.) Static `content` bakes never carry queries (D4), so `handlers={{}}` stays consistent.
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
- [ ] T12 (LS-15) E2e journeys (MSW fixture, browser UI only): generate todo → create/complete/delete → **reload persists**; two components on one query update together; preview route honors data; **published page journey** (authed publish → fresh visitor creates a todo → reload → it persists in the visitor's own storage). Empty + error branches visible.
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

- [ ] Unit: adapter CRUD, validation diagnostics, state transitions, classify, round-trip.
- [ ] E2e: todo journeys (T12), existing 95-green suite untouched.
- [ ] MCP spot-check: real generation with the new rules bullet (repo MCP pass).
- [ ] Full gate green.

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-17 | program document drafted (root `data sources.md`): 3 milestones + cross-provider requirements |
| 2026-10-17 | user decisions: formalize **M0+M1 only**; **model guidance included in M1**; audit first |
| 2026-10-17 | LS-01 audit completed (empirical: validateSpec/patch-compiler/json-io all tolerate new top-level keys; runtime store isolated from persisted specs; `classifySpec` + key namespacing + model guidance identified as gaps) — rev 1 drafted, **awaiting approval** |
| 2026-10-17 | user: root `data sources.md` stays until the feature is done, then deleted |
