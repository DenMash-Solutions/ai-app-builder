# Data Sources M2 — Database Provider (Supabase) — Implementation Plan

**Status:** implemented
**Date:** 2026-10-18
**Milestone:** DB-01…DB-12 of root `data sources.md` (program doc, untracked)

## Goal

Add a database-backed provider behind the same resource/query/binding/mutation model shipped in M0+M1 (`docs/plan/data-sources/plan.md`). A generated UI declares `{ "provider": "supabase", "config": {} }` and its resources become Postgres rows with per-visitor authorization enforced by RLS — the provider-agnostic adapter contract, spec validation, mirror, and `data_mutate` semantics stay untouched. Async adapters finally make the loading branch paintable, which M1's synchronous localStorage could not show.

## Scope

### In scope

- Supabase adapter implementing the existing `DataAdapter` contract (list/get/create/update/delete, DataError normalization).
- One **approved generic records table** (`public.genui_records`) — namespace-scoped (app_id, resource), RLS-secured — instead of per-resource real tables.
- Per-visitor scoping via Supabase sessions: signed-in user, or transparent anonymous sign-in for fresh visitors (session persists in the browser).
- QueryLoader/manager compatibility: async initialize/load, the same dedupe/supersession mirror semantics; loading branch becomes visible (recipe/validation/guidance unchanged beyond the provider line).
- Schema validation: data-block `config` must stay empty for Supabase (no credentials in specs), resource names map into the allowlisted table.
- Async loading branch e2e journey (the descope of M1 — paintable at last), corrupt/unavailable-stored-data normalization, reload persistence, per-visitor isolation.
- Migration (single SQL file) applied via Supabase MCP or dashboard, with user approval.
- Docs appendix + patch for the model-guidance recipe (provider names now include `supabase` alongside `localStorage`; supabase recipes note the signed-in scoping).

### Out of scope

- Realtime cross-tab synchronization — deferred: the manager's refresh-after-mutation already keeps one browser coherent; cross-tab/cross-device live sync is a follow-up on Supabase Realtime channels. Recorded as a documented limitation.
- Filtering, sorting, pagination on queries — deferred to M3 (validated declarative options come with the API provider milestone); M2 queries are list/get exactly like M1.
- Shared-public (message-board) scoping mode — deployment-policy decision, later milestone.
- The configuration UI (program doc: separate plan).
- Automatic schema migrations (program doc out-of-scope) — we ship exactly one provisioning script.

## Design decisions

1. **Provider = Supabase Postgres via the existing `@supabase/ssr` browser client** — rejected: a Next.js API proxy with the service-role key, because the app's architecture is already client-auth + RLS (auth, publish, admin all use the browser client); RLS is the real enforcement either way, and a proxy adds a server filter layer with zero security gain. The adapter reuses `lib/supabase/client.ts`.
2. **One generic records table, not per-resource tables** — rejected: mapping resources to arbitrary named Postgres tables, because a generated spec could then name any table in the project (auth.users, publish/live internals) and each new app would need schema provisioning (migrations are out of scope, and "approved database tables", DB-03, must be enforceable). `genui_records(app_id, resource, id)` with `data jsonb` resources generalize: resource name → column filter, schema → client-side validation of the jsonb record.
3. **Per-visitor authorization = Supabase session + RLS (`user_id = auth.uid()`)** — rejected: cookie/localStorage visitor IDs, because unauthenticated row ownership under RLS needs a signed identity anyway; anonymous sign-in gives a real `auth.uid()` per browser with zero exotic policy machinery. The adapter's `initialize()` awaits an ensured session (existing user, else `signInAnonymously`); anonymous sign-in must be enabled on the project (check/configure with user approval).
4. **Record ids are client-generated** (same `crypto.randomUUID` strategy as the localStorage adapter) — rejected: `default gen_random_uuid()` server ids, because create-then-refetch round-trips and id reconciliation complicate the contract for no benefit.
5. **No new guidance surface** — the existing recipe bullet gains one sentence: on Supabase builds, the visitor must be (or be made) signed in; per-visitor persistence is the only supported mode in M2. Rejected: separate supabase recipe section for now — the declarative shape is identical, only the provider line differs.
6. **Capability mapping:** list/get/create/update/delete only; constraint failures (duplicate key in data, jsonb shape) normalize to existing DataError codes (`unavailable` → network/RLS denial with friendly code, `malformed` → shape, `unknown` → rest). Network timeouts → `unavailable`; Supabase 401/403 → a new `forbidden`-checked mapping into `unavailable` with human message (no new codes unless a normalization gap demands one — check during implementation).

## Verification

- [ ] Unit: Supabase adapter CRUD through a mocked `supabase-js` fetch client; error normalization; empty config constraint; session-ensure behavior (signed-in reused, anonymous created once).
- [ ] Manager/adapter integration: async load paints loading (unit integration now has a real desire to await).
- [ ] E2e: anonymous visitor journey against the real project — todo create → reload persists (per-visitor RLS), plus isolation between two contexts; corrupt-spec → friendly error; supabase unavailable → error branch.
- [ ] Full gate: format, lint, tsc, unit, build, full e2e; MCP spot-check of a real 3.8-Flash generation declaring `provider: "supabase"` running live (where the default lite model already ignores the recipe — same caveat as M1).
- [ ] RLS proven negative: one context cannot read another visitor's rows (isolation journey) and row access without a session is denied.

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-18 | plan drafted from DB-01…DB-12 + existing Supabase infra audit (client + server clients, env keys, no local migrations dir) |
| 2026-10-18 | user decisions (all three recommendations confirmed): **per-visitor rows** (RLS `user_id = auth.uid()`, transparent anonymous sign-in for fresh visitors), **migration via Supabase MCP with approval** (table + RLS + anonymous sign-in, SQL shown first), **Realtime deferred** to a follow-up. Program doc tracker updated (LocalStorage → Done). Root `data sources.md` stays untracked until the feature ships |
| 2026-10-18 | rev 1 — plan approved, implementation starts below |

## Tasks (program-doc IDs inline; T-numbers source of truth)

- [x] **T1** (DB-02): capability + types wiring — `DATA_SOURCE_PROVIDERS.supabase` constant; error-normalization review against existing DataError codes; empty-config constraint declared in validate.
- [x] **T2** (DB-03, DB-04, DB-06): `lib/data-sources/supabase-adapter.ts` — session ensure (reuse signed-in user, else `signInAnonymously` once persistently), CRUD over `genui_records` filtered by `(app_id, resource, user_id)`, client-generated ids, DataError normalization (HTTP/network/RLS-denial → codes).
- [x] **T3** (DB-05): list/get through the same postgrest call shape; records validated client-side against `resource.schema` before return (malformed → `malformed`).
- [x] **T4** (DB-07): RLS is the authorization boundary; adapter never carries tokens; `config` must stay `{}` — `validateDataSources` rejects any supabase config fields (explicit per-provider form of the credential-shape rule).
- [x] **T5** (DB-01, DB-12): SQL migration `supabase/migrations/0001_genui_records.sql` (table + PK + indexes + RLS policies + anonymous sign-in note) — applied via MCP 2026-10-18 after in-chat approval.
- [x] **T6**: adapter-registry wiring; QueryLoader/manager stay untouched unless async-load integration testing reveals a race (candidate: `initialize()` now awaits a network round-trip — supersession already handles it).
- [x] **T7**: unit tests — MSW-intercept Supabase REST (`/rest/v1/genui_records`), covering CRUD, error normalization, session-ensure (reuse vs create), empty-config validation, async loading-branch mirror paint in the bindings integration test.
- [x] **T8**: recipe/guidance patch — provider line gains `supabase`, one sentence on signed-in/per-visitor semantics; validation-test + catalog-test cases updated.
- [x] **T9**: e2e — authed publish journey with `provider: "supabase"` (CRUD + reload + per-visitor isolation between two contexts + unauthorized read denied), anonymous fresh-visitor light journey; teardown sweep deletes test rows (existing `deleteTestRow` pattern).
- [x] **T10**: docs appendix in `docs/data-sources.md` (provider section: config, scoping, limitations, RLS expectations, adapter notes).
- [ ] **T11**: full gate + MCP real-generation spot-check with `provider: "supabase"` (3.8 Flash; lite caveat carried) + plan status → implemented + commit (ask first).
