# Database setup scripts

Complete, ordered SQL to recreate the Supabase schema from scratch — tables,
functions, RLS policies, grants, triggers, and seed rows. Matches the live
project state after the RLS audit (`docs/security/rls-audit.md`).

## Run order

| # | File | What it does |
| - | ---- | ------------ |
| 1 | `01_schema.sql` | 5 public tables (`profiles`, `uis`, `page_versions`, `published_pages`, `site_settings`), constraints, defaults |
| 2 | `02_functions.sql` | `handle_new_user()` (signup trigger fn), `is_admin()` (RLS helper), `rls_auto_enable()` (event trigger fn) |
| 3 | `03_rls.sql` | Enable RLS on all tables + the full policy set (post-audit) |
| 4 | `04_grants.sql` | Table DML grants, TRUNCATE/TRIGGER/REFERENCES revokes, function EXECUTE ACLs |
| 5 | `05_triggers.sql` | `on_auth_user_created` (auth signup → profile row), `ensure_rls` event trigger |
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
select count(*) from pg_class
 where relnamespace = 'public'::regnamespace and relkind = 'r';        -- 5
select count(*) from pg_policies where schemaname = 'public';           -- 14
select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public';                                            -- 3
select relname from pg_class
 where relnamespace = 'public'::regnamespace and relkind = 'r'
   and not relrowsecurity;                                              -- 0 rows
```

## Maintenance

Policy or grant changes must update **both** `db/03_rls.sql` /
`db/04_grants.sql` **and** the inventory in `docs/security/rls-audit.md`.
