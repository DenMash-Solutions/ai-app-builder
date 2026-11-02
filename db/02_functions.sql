-- Functions: signup trigger fn, admin check, RLS auto-enable event fn.
-- Depends on: 01_schema.sql (public.profiles), Supabase auth schema (auth.uid()).
-- Re-runnable: CREATE OR REPLACE throughout.

-- Signup: auth trigger inserts the profile row (role defaults to 'user').
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Am I admin? SECURITY DEFINER so RLS policies (which run as the querying
-- role) can read profiles without the profiles SELECT policy recursing.
-- EXECUTE stays granted to `authenticated` — revoking it breaks every policy
-- that calls it; see docs/security/rls-audit.md F5 for the full analysis.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- Event trigger fn: new public tables get RLS enabled automatically so a
-- forgotten `alter table ... enable row level security` can't ship open.
create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
DECLARE
  cmd record;
  tbl name;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table', 'partitioned table')
  LOOP
    IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public')
       AND cmd.schema_name NOT IN ('pg_catalog', 'information_schema')
       AND cmd.schema_name NOT LIKE 'pg_toast%'
       AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        SELECT c.relname INTO tbl
        FROM pg_catalog.pg_class c WHERE c.oid = cmd.objid;
        EXECUTE format(
          'alter table if exists %I.%I enable row level security',
          cmd.schema_name, tbl
        );
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION WHEN OTHERS THEN
        RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
    ELSE
      RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)',
        cmd.object_identity, cmd.schema_name;
    END IF;
  END LOOP;
END;
$$;

-- Plan 066 decision 3: catalog versions are immutable at the DB layer.
-- UPDATE is always refused. DELETE is refused while the owning asset still
-- exists — the only legitimate delete path is the asset's own ON DELETE
-- CASCADE, and RI actions run AFTER the parent row is gone, so the
-- parent-exists check passes exactly for cascades and refuses every direct
-- delete. (Truncating the table is separately denied: TRUNCATE is never
-- granted to anon/authenticated — audit F1.)
create or replace function public.reject_catalog_version_mutation()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception
      'catalog_asset_versions is immutable (plan 066 decision 3): UPDATE refused for asset % version %',
      old.asset_id, old.version
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.catalog_assets where id = old.asset_id) then
    raise exception
      'catalog_asset_versions is immutable (plan 066 decision 3): DELETE refused for asset % version % — delete the asset instead',
      old.asset_id, old.version
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;
