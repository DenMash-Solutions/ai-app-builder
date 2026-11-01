# Database-backed Projects (closes F17)

**Status:** implemented
**Date:** 2026-10-31

## Goal

Persist projects in the database with RLS and account sync so project
grouping follows the user across devices — extending the existing sync
infrastructure instead of adding a parallel persistence system.

## Scope

### In scope

- `projects` migration: id (client-generated uuid PK), owner_id, name, slug,
  home_screen_id, status, state jsonb default `{}`, created_at, updated_at;
  unique (owner_id, slug); reserved-segment validation
- RLS: owner-only select/insert/update/delete (`db/01_schema.sql` style)
- Second LWW loop reusing `lib/history/sync.ts` machinery: debounced push,
  `updatedAt` tie-break, shared sync status dot and flush path
- Local adoption: local UUID rows upload as-is; remote rows merge on first
  sign-in with **no id remapping**, so `HistoryEntry.projectId` stays valid
- Reserved-slug fix in `createProject` / `renameProject` / `uniqueSlug`
  (today slug `admin` is shadowed by the admin route)

### Out of scope

- Realtime channels — debounce + LWW only, like `uis`
- Global handle claims (069) and membership sync (065)
- Renaming/reordering semantics beyond what the store already does
- Cross-device delete propagation — a project deleted on device A can be
  re-upserted by device B's next push; this is the pre-existing `uis`
  semantic (pull never deletes) that 064 inherits rather than diverging from
  (noted 2026-10-31; a tombstone/delete-transfer design would be its own
  plan touching both loops)

## Design decisions

1. Reuse the sync module's client/status/flush machinery for a second loop —
   rejected: a standalone sync service, because two status dots and two
   flush paths are a UX and correctness hazard.
2. Project `state` syncs under plain LWW (a shared cart survives devices);
   the session stamp clock stays realm-local and is documented as
   last-write-wins across devices — rejected: device-local state, because it
   breaks the shared-application promise; rejected: realtime merge, because
   stamp semantics do not cross realms.
3. Client-generated UUID as primary key — rejected: server-issued ids,
   because anonymous local projects would need every
   `HistoryEntry.projectId` remapped on adoption.
4. Reserved segments enforced at create and rename as part of this plan —
   rejected: deferring to 065, because the shadowing bug exists today.
5. Conflict policy for an adoption-time slug collision under the same owner:
   bump via the existing unique-slug helper, keep both projects — rejected:
   dropping either side, because both hold local work.
6. SQL home is the canonical `db/0*.sql` set only — rejected: mirroring the
   DDL into `supabase/migrations/0002`, because the CLI is not initialized
   (no `config.toml`, no npm script) and a second copy would drift from
   `db/README.md`'s "matches live state" promise; `0001_genui_records.sql`
   stays a historical artifact. The migration is applied to the live project
   additively (table + RLS + grants in one batch, SQL reviewed before
   execution) because no local stack exists and e2e runs against live.
7. Accepted session-state writes bump the project's `updatedAt` (recorded
   2026-10-31 while implementing decision 2): `/session` syncs under plain
   LWW and the merge compares timestamps, so a state change that didn't move
   the stamp would be invisible to the other device's pull. This supersedes
   061's "updatedAt stays rename-owned" comment — rejected: a separate state
   version column, because decision 2 explicitly keeps plain LWW and stamp
   semantics don't cross realms. The identical-content seed echo still
   returns early (no bump, no push churn).

## Migration

New table only — no backfill into `uis` and no change to existing rows.
Local projects adopt on first authenticated sync; the merge order is local
store first, then remote pull through the same LWW rule the entries use.

## Files

`db/01_schema.sql`, `db/03_rls.sql`, `db/04_grants.sql`,
`lib/history/sync.ts`, `lib/projects/projects.ts`, sync status UI,
en/es keys, `lib/projects/projects.test.ts`, `lib/history/sync.test.ts`.

## Tasks

### 1. Schema, RLS and grants (db/)

- [x] `db/01_schema.sql` — `projects` table: client-generated uuid PK,
      owner_id, name, slug, home_screen_id, status, `state jsonb` default
      `{}`, timestamps, unique (owner_id, slug)
- [x] `db/03_rls.sql` — owner-only select/insert/update/delete, RLS enabled
      (F7-shaped update check; inventory row in `docs/security/rls-audit.md`)
- [x] `db/04_grants.sql` — no edit needed: it grants DML `on all tables in
      schema public`, so re-running it covers `projects` (revoke set already
      in the file pattern)
- [x] SQL shown to the user, then applied to the live project in one batch
      as migration `20261031235914_add_projects_table_rls_grants` (decision 6);
      post-apply probe: table + 9 columns correct, `relrowsecurity=true`,
      4 policies (r/a/w/d), advisors show only pre-existing documented WARNs

### 2. Second sync loop (lib/history/sync.ts)

- [x] Row ↔ `Project` mappers beside `rowToEntry` / `entryToRow`
      (`rowToProject` sanitizes through `sanitizeProjects`; `projectToRow`
      omits `status`/`home_screen_id` so PostgREST never clobbers them)
- [x] `startSync` parameterized over table + mapper so both loops share one
      status dot and one `flushSync` path (decision 1) — generic
      `startTableSync` + `entriesSyncSpec`/`projectsSyncSpec`; status
      aggregates per-loop states, `flushSync` runs every registered flush;
      `SyncEngine` starts and stops both
- [x] Debounced push with `updatedAt` LWW tie-break; the newer row wins
      (remote-newer / local-newer unit tests both directions)
- [x] Sync status UI covers both loops with a single indicator — no UI edit
      needed: the dot and nudge consume the shared module status, which now
      aggregates both loops

### 3. Local adoption (lib/projects/projects.ts)

- [x] First sign-in merge: local uuid rows upload as-is, remote rows pull
      through the same LWW rule — no id remapping, so
      `HistoryEntry.projectId` stays valid (adoption test pins id/slug/stamps)
- [x] Adoption-time slug collision under the same owner bumps via
      `uniqueSlug`; both projects kept (decision 5) — `applyRemoteProject`
      bumps the LOCAL holder at adoption, `reconcileProjectSlugs` runs
      before every push payload (own-id rows never bump; foreign-owner rows
      filtered out — uniqueness is per-owner)
- [x] Corrupt/partial remote rows sanitized on read (mirror the
      `normalizeEntry` discipline) — junk timestamp/empty name → dropped,
      non-object state → `{}` (decision 7 records the `updatedAt` bump that
      makes state LWW observable)
- [x] Signed-out behavior stays byte-identical (061 contract) — proven by
      `e2e/project-session.spec.ts` in workstream 5 (passes unchanged)

### 4. Reserved-slug fix

- [x] `createProject` and `renameProject` reject reserved segments with an
      i18n error (en/es keys) — exported `projectNameError` predicate
      (callers toast `projects.reserved` and keep the input open), store
      rejects as defense in depth; reserved validation stays app-side (no DB
      copy of the reserved list)
- [x] `uniqueSlug` consults `isReservedSlug` — slug `admin` can never be
      claimed (fixes the shadowed-route bug that exists today); the suffix
      loop skips reserved candidates too, so stored/adopted legacy `admin`
      rows heal to `admin-2` through sanitize/adoption/reconcile

### 5. Tests and probes

- [x] Unit (`lib/projects/projects.test.ts`, `lib/history/sync.test.ts`):
      adoption merge, LWW tie-break, reserved rejection at create and
      rename, corrupt-row sanitization — 17 new tests across workstreams
      2–4 (859 total, all green)
- [x] e2e two contexts: create in A, same account in B sees the same id and
      grouping — context B reuses the dedicated storage state, never a fresh
      anon signup (lesson `e2e-auth-quota`); `waitForRemoteProject` /
      `waitForRemoteRow` gate on the account rows (authoritative, not the
      dot), cleanup via `deleteTestProject` + the extended name-scoped
      leftover sweep in `db.ts`
- [x] RLS probe: user A saw only `probe-a`, user B only `probe-b`
      (cross-owner invisible), anon 0 rows; probe rows deleted, table left
      with 0 rows
- [x] `e2e/project-session.spec.ts` stays green; full gate — shared
      switcher-create/storage helpers moved to `e2e/helpers.ts`;
      130/130 e2e (chromium + authed + signout), 859 unit, lint/tsc/Prettier
      clean

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test`
      — all green (859 unit tests, 0 fail)
- [x] Unit: adoption merge, LWW tie-break, reserved-slug rejection at create
      and rename, corrupt-row sanitization — covered by the workstream 2–4
      tests named above
- [x] e2e: two browser contexts — create in A, sign in as the same account
      in B, project appears with the same id and grouping
      (`authed.spec.ts` "same id" test, 130/130 suite green)
- [x] RLS probe: cross-owner reads return nothing for a signed-in client
      (probe users A/B, each saw only their own row); signed-out read
      returns nothing — service role bypasses RLS by design, so the probe
      used user-scoped tokens with the anon key
- [x] Existing 061 e2e (`project-session.spec.ts`) stays green — behavior
      when signed out must be byte-identical (test passes unchanged)

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-31 | plan drafted (F17 claimed here) |
| 2026-10-31 | approved — decisions confirmed by the user: SQL home = `db/0*.sql` canonical only (design decision 6), migration applied to the live Supabase project (additive, RLS + grants in one batch, SQL shown before execution); plan 062 closed as implemented in the same turn |
| 2026-10-31 | implemented — migration `20261031235914` applied live (RLS probes clean); second sync loop + adoption + reserved-slug fix landed (decisions 5–7 recorded during implementation); full gate green: 859 unit, 130 e2e incl. the new cross-device project test, lint/tsc/Prettier clean |
