# Database-backed Projects (closes F17)

**Status:** approved
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

- [ ] `db/01_schema.sql` — `projects` table: client-generated uuid PK,
      owner_id, name, slug, home_screen_id, status, `state jsonb` default
      `{}`, timestamps, unique (owner_id, slug)
- [ ] `db/03_rls.sql` — owner-only select/insert/update/delete, RLS enabled
- [ ] `db/04_grants.sql` — `authenticated` DML only, revoke set as in the
      file pattern
- [ ] SQL shown to the user, then applied to the live project in one batch
      (decision 6); service-client spot-check after apply

### 2. Second sync loop (lib/history/sync.ts)

- [ ] Row ↔ `Project` mappers beside `rowToEntry` / `entryToRow`
- [ ] `startSync` parameterized over table + mapper so both loops share one
      status dot and one `flushSync` path (decision 1)
- [ ] Debounced push with `updatedAt` LWW tie-break; the newer row wins
- [ ] Sync status UI covers both loops with a single indicator

### 3. Local adoption (lib/projects/projects.ts)

- [ ] First sign-in merge: local uuid rows upload as-is, remote rows pull
      through the same LWW rule — no id remapping, so
      `HistoryEntry.projectId` stays valid
- [ ] Adoption-time slug collision under the same owner bumps via
      `uniqueSlug`; both projects kept (decision 5)
- [ ] Corrupt/partial remote rows sanitized on read (mirror the
      `normalizeEntry` discipline)
- [ ] Signed-out behavior stays byte-identical (061 contract)

### 4. Reserved-slug fix

- [ ] `createProject` and `renameProject` reject reserved segments with an
      i18n error (en/es keys)
- [ ] `uniqueSlug` consults `isReservedSlug` — slug `admin` can never be
      claimed (fixes the shadowed-route bug that exists today)

### 5. Tests and probes

- [ ] Unit (`lib/projects/projects.test.ts`, `lib/history/sync.test.ts`):
      adoption merge, LWW tie-break, reserved rejection at create and
      rename, corrupt-row sanitization
- [ ] e2e two contexts: create in A, same account in B sees the same id and
      grouping — context B reuses the dedicated storage state, never a fresh
      anon signup (lesson `e2e-auth-quota`)
- [ ] RLS probe: cross-owner reads return nothing for a signed-in client;
      signed-out reads nothing
- [ ] `e2e/project-session.spec.ts` stays green; full gate

## Verification

- [ ] `bun run format && bun run lint && bunx tsc --noEmit && bun run test`
- [ ] Unit: adoption merge, LWW tie-break, reserved-slug rejection at create
      and rename, corrupt-row sanitization
- [ ] e2e: two browser contexts — create in A, sign in as the same account
      in B, project appears with the same id and grouping
- [ ] RLS probe: a service client cannot read another owner's `projects`
      rows; signed-out read returns nothing
- [ ] Existing 061 e2e (`project-session.spec.ts`) stays green — behavior
      when signed out must be byte-identical

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-31 | plan drafted (F17 claimed here) |
| 2026-10-31 | approved — decisions confirmed by the user: SQL home = `db/0*.sql` canonical only (design decision 6), migration applied to the live Supabase project (additive, RLS + grants in one batch, SQL shown before execution); plan 062 closed as implemented in the same turn |
