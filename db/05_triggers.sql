-- Triggers: signup → profile row; new tables → auto-RLS.
-- Depends on: 02_functions.sql (handle_new_user, rls_auto_enable).
-- Re-runnable: DROP ... IF EXISTS before CREATE.
-- Requires superuser (postgres) — both the auth schema trigger and the event
-- trigger are owned by postgres; the Supabase SQL editor runs as postgres.

-- Signup: inserting into auth.users creates the matching profiles row.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Auto-enable RLS on newly created public tables.
drop event trigger if exists ensure_rls;
create event trigger ensure_rls
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function public.rls_auto_enable();

-- Plan 066 decision 3: catalog versions are immutable at the DB layer.
-- The function (02) refuses every UPDATE and any DELETE issued while the
-- owning asset still exists; the asset's ON DELETE CASCADE passes because RI
-- actions run after the parent row is gone.
drop trigger if exists catalog_asset_versions_immutable on public.catalog_asset_versions;
create trigger catalog_asset_versions_immutable
  before update or delete on public.catalog_asset_versions
  for each row execute function public.reject_catalog_version_mutation();

-- Plan 069: the shared route namespace is enforced in the same statement that
-- publishes, so a claim can never be lost or half-written. The handle trigger
-- is AFTER, not BEFORE: route_claims.project_id has an FK on projects, and a
-- BEFORE INSERT trigger would insert a claim pointing at a row that does not
-- exist yet (23503 — caught by the live decision-10 DO-block). An exception
-- from an AFTER trigger still rolls the whole statement back, so atomicity is
-- unchanged.
drop trigger if exists published_pages_claim_route on public.published_pages;
create trigger published_pages_claim_route
  after insert or update of slug on public.published_pages
  for each row execute function public.claim_screen_route();

drop trigger if exists projects_claim_handle on public.projects;
create trigger projects_claim_handle
  after insert or update of handle on public.projects
  for each row execute function public.claim_project_handle();
