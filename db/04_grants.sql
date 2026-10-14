-- Grants: table DML + function EXECUTE (post-audit state).
-- Depends on: 01_schema.sql, 02_functions.sql.
-- Re-runnable: grants/revokes are idempotent.
-- Supabase's default privileges may already grant broader rights (incl.
-- TRUNCATE/TRIGGER/REFERENCES); the revokes below pin the final state.

-- Table DML: anon/authenticated get row-filtered DML only — RLS does the
-- row filtering; TRUNCATE is not row-filtered, so it must never be granted
-- (audit F1: anon TRUNCATE bypassed RLS via the default grant).
grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete
  on all tables in schema public
  to anon, authenticated, service_role;

revoke truncate, trigger, references
  on all tables in schema public
  from anon, authenticated;

-- Function EXECUTE (audit F5): no PUBLIC/anon execution of SECURITY DEFINER
-- functions.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant  execute on function public.handle_new_user() to postgres, service_role;

-- is_admin must stay executable by `authenticated`: RLS policy expressions
-- run as the querying role, so revoking it breaks every policy that calls it
-- (proven: "permission denied for function is_admin" during policy
-- evaluation). SECURITY INVOKER would recurse through the profiles policy.
-- See docs/security/rls-audit.md F5 — accepted advisory.
revoke execute on function public.is_admin() from public, anon;
grant  execute on function public.is_admin() to postgres, service_role, authenticated;

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
grant  execute on function public.rls_auto_enable() to postgres, service_role;
