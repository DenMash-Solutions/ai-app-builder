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

-- Plan 066 decision 4: fork-on-edit. SECURITY INVOKER — RLS authorizes
-- every statement — so only session-holding roles may execute; anon never
-- forks (auth.uid() refuses before any write). Function signature pins the
-- three parameters (uuid, uuid, uuid) so the grant targets exactly this
-- overload.
revoke execute on function public.fork_catalog_asset(uuid, uuid, uuid)
  from public, anon;
grant  execute on function public.fork_catalog_asset(uuid, uuid, uuid)
  to authenticated, service_role;

-- Plan 068: the username RPCs. claim_username writes, so only a session may
-- call it (anon is revoked explicitly — the function also refuses without
-- auth.uid(), but the ACL is the outer gate). The two read helpers are
-- anonymous by design: signup checks availability before an account exists,
-- and the public profile route resolves a handle to an owner id.
revoke execute on function public.claim_username(text) from public, anon;
grant  execute on function public.claim_username(text)
  to authenticated, service_role;

revoke execute on function public.username_available(text) from public;
grant  execute on function public.username_available(text)
  to anon, authenticated, service_role;

revoke execute on function public.public_profile(text) from public;
grant  execute on function public.public_profile(text)
  to anon, authenticated, service_role;

-- Plan 069: route claims. The trigger functions are invisible to API callers
-- (only the DB invokes them), and `route_available` is the anonymous probe the
-- publish dialog uses before the first write.
revoke execute on function public.claim_screen_route() from public, anon, authenticated;
grant  execute on function public.claim_screen_route() to postgres, service_role;

revoke execute on function public.claim_project_handle() from public, anon, authenticated;
grant  execute on function public.claim_project_handle() to postgres, service_role;

-- The one-arg overload was dropped in 02 (decision 11) — no revoke target
-- remains for it; the two-arg probe below is the only signature. PUBLIC is
-- revoked first (new functions default to PUBLIC EXECUTE, which the security
-- advisor flags on a SECURITY DEFINER), then the three API roles get it.
drop function if exists public.route_available(text);
revoke execute on function public.route_available(text, text) from public;
grant  execute on function public.route_available(text, text)
  to anon, authenticated, service_role;

revoke execute on function public.project_is_published(uuid) from public, anon;
grant  execute on function public.project_is_published(uuid)
  to anon, authenticated, service_role;

-- Plan 069 task 4: the live handle lookup the [slug] page, the proxy's
-- bare-segment decision and the redirect hop all call. PUBLIC is revoked
-- first (new functions default to PUBLIC EXECUTE, which the security
-- advisor flags on a SECURITY DEFINER), then the three API roles get it —
-- the same shape as the availability probe above.
revoke execute on function public.live_project(text) from public;
grant  execute on function public.live_project(text)
  to anon, authenticated, service_role;
