# Database setup scripts

Complete, ordered SQL to recreate the Supabase schema from scratch — tables,
functions, RLS policies, grants, triggers, and seed rows. Matches the live
project state after the RLS audit (`docs/security/rls-audit.md`).

## Run order

| # | File | What it does |
| - | ---- | ------------ |
| 1 | `01_schema.sql` | 13 public tables (`profiles`, `uis`, `page_versions`, `published_pages`, `site_settings`, `projects`, `project_screens`, `catalog_assets`, `catalog_asset_versions`, `catalog_installs` + 069's `route_claims`, `route_redirects`, `published_entry_points`), constraints, defaults — plus `genui_records` from `supabase/migrations/0001_genui_records.sql` (applied separately, RLS + 4 policies) |
| 2 | `02_functions.sql` | `handle_new_user()` (signup trigger fn), `is_admin()` (RLS helper), `rls_auto_enable()` (event trigger fn), `reject_catalog_version_mutation()` (066 immutability fn), `fork_catalog_asset()` (066 fork-on-edit RPC), `claim_username()` / `username_available()` / `public_profile()` (068 username RPCs), `project_is_published()` / `route_available()` / `claim_screen_route()` / `claim_project_handle()` (069 route claims) |
| 3 | `03_rls.sql` | Enable RLS on all tables + the full policy set (post-audit) |
| 4 | `04_grants.sql` | Table DML grants, TRUNCATE/TRIGGER/REFERENCES revokes, function EXECUTE ACLs |
| 5 | `05_triggers.sql` | `on_auth_user_created` (auth signup → profile row), `ensure_rls` event trigger, `catalog_asset_versions_immutable` (066), `published_pages_claim_route` + `projects_claim_handle` (069 route claims) |
| 6 | `06_seed.sql` | `site_settings` singleton row + admin-promotion snippet |

Every file is re-runnable (`if not exists` / `create or replace` /
`drop ... if exists` before creates, `on conflict do nothing`).

## How to run

**Supabase SQL editor** (dashboard → SQL, runs as `postgres`): paste each file
in order, or paste them concatenated in one go.

**psql**:

```sh
for f in db/0*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done
```

**MCP / scripted**: `apply_migration` (or `execute_sql`) with each file's
contents in order.

## Prerequisites

- A Supabase project (the managed `auth` schema and `anon` / `authenticated` /
  `service_role` roles must exist — they do on every Supabase project).
- `postgres` role for step 5 (trigger on `auth.users` + event trigger). The
  SQL editor and `apply_migration` both run as postgres.
- No extensions required: `gen_random_uuid()` is core since PostgreSQL 13.

## Not included (by design)

- **User data** — `auth.users` and row data are runtime state, not schema.
- **Auth config** — leaked-password protection etc. are dashboard settings
  (see the audit's follow-ups).
- **Admin promotion** — scripted as a comment in `06_seed.sql`; it needs a
  real signed-up user.

## Verify after running

```sql
-- db/ files alone: 13 tables, 39 policies; + genui_records (separate
-- migration) → live project totals: 14 tables, 43 policies.
select count(*) from pg_class
 where relnamespace = 'public'::regnamespace and relkind = 'r';        -- 14
select count(*) from pg_policies where schemaname = 'public';           -- 43
select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public';                                            -- 13
-- (12 from db/02 — including the 066 fork RPC, the 068 username RPCs and
-- the 069 route-claim functions — plus genui_records_touch_updated_at from
-- the separate genui migration)
select relname from pg_class
 where relnamespace = 'public'::regnamespace and relkind = 'r'
   and not relrowsecurity;                                              -- 0 rows
```

## Maintenance

Policy or grant changes must update **both** `db/03_rls.sql` /
`db/04_grants.sql` **and** the inventory in `docs/security/rls-audit.md`.

`profiles` still has **no write policy** after 068: a handle is claimed through
`claim_username()` (SECURITY DEFINER, writes only the caller's own `username`),
and visitors read `public_profile()` instead of the table, so `email` never
becomes publicly selectable. Keep the reserved-segment list in `lib/slug.ts` —
it is deliberately not duplicated in SQL.

**Plan 069 note:** `route_claims` is RLS-enabled **with zero policies on
purpose** — rows are written only by the `claim_screen_route()` /
`claim_project_handle()` definer triggers and read only through
`route_available()`. An empty policy set is what makes the namespace arbiter
unforgeable; do not "repair" it by adding a client write policy.
