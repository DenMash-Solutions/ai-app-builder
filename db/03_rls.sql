-- RLS: enable on all tables + the full (post-audit) policy set.
-- Depends on: 01_schema.sql, 02_functions.sql (is_admin used in policies).
-- Re-runnable: DROP POLICY IF EXISTS before every CREATE POLICY.
-- Policy inventory is maintained in docs/security/rls-audit.md — update both
-- together.

alter table public.profiles       enable row level security;
alter table public.uis            enable row level security;
alter table public.page_versions  enable row level security;
alter table public.published_pages enable row level security;
alter table public.site_settings  enable row level security;

-- ── profiles ────────────────────────────────────────────────────────────────
-- No write policies at all: rows are created by the signup trigger, and an
-- authenticated user must never be able to UPDATE their own role to 'admin'.
drop policy if exists profiles_select_own_or_admin on public.profiles;
create policy profiles_select_own_or_admin
  on public.profiles for select
  to authenticated
  using ((id = auth.uid()) or is_admin());

-- ── uis ─────────────────────────────────────────────────────────────────────
drop policy if exists uis_select_owner_or_admin on public.uis;
create policy uis_select_owner_or_admin
  on public.uis for select
  to authenticated
  using ((owner_id = auth.uid()) or is_admin());

drop policy if exists uis_insert_own on public.uis;
create policy uis_insert_own
  on public.uis for insert
  to authenticated
  with check (owner_id = auth.uid());

-- Owner-only WITH CHECK: an admin may edit another user's row but must not
-- re-stamp owner_id onto themselves (sync ownership takeover — audit F7).
drop policy if exists uis_update_owner_or_admin on public.uis;
create policy uis_update_owner_or_admin
  on public.uis for update
  to authenticated
  using ((owner_id = auth.uid()) or is_admin())
  with check (owner_id = auth.uid());

drop policy if exists uis_delete_owner_or_admin on public.uis;
create policy uis_delete_owner_or_admin
  on public.uis for delete
  to authenticated
  using ((owner_id = auth.uid()) or is_admin());

-- ── page_versions ───────────────────────────────────────────────────────────
-- INSERT requires ui ownership (audit F2: version squat on a victim's ui).
drop policy if exists page_versions_select_owner_or_admin on public.page_versions;
create policy page_versions_select_owner_or_admin
  on public.page_versions for select
  to authenticated
  using ((owner_id = auth.uid()) or is_admin());

drop policy if exists page_versions_insert_own on public.page_versions;
create policy page_versions_insert_own
  on public.page_versions for insert
  to authenticated
  with check (
    (owner_id = auth.uid())
    and exists (
      select 1 from public.uis u
      where u.id = ui_id and u.owner_id = auth.uid()
    )
  );

drop policy if exists page_versions_delete_owner_or_admin on public.page_versions;
create policy page_versions_delete_owner_or_admin
  on public.page_versions for delete
  to authenticated
  using ((owner_id = auth.uid()) or is_admin());

-- No UPDATE policy: snapshots are immutable by design.

-- ── published_pages ─────────────────────────────────────────────────────────
-- Public projection (audit: intended). ui_id/slug squat is blocked by the
-- ui-ownership WITH CHECK (audit F3); admins may publish for anyone.
drop policy if exists published_pages_select_everyone on public.published_pages;
create policy published_pages_select_everyone
  on public.published_pages for select
  to public
  using (true);

drop policy if exists published_pages_write_owner on public.published_pages;
create policy published_pages_write_owner
  on public.published_pages for insert
  to authenticated
  with check (
    (owner_id = auth.uid())
    and exists (
      select 1 from public.uis u
      where u.id = ui_id and (u.owner_id = auth.uid() or is_admin())
    )
  );

drop policy if exists published_pages_update_owner on public.published_pages;
create policy published_pages_update_owner
  on public.published_pages for update
  to authenticated
  using ((owner_id = auth.uid()) or is_admin())
  with check (
    ((owner_id = auth.uid()) or is_admin())
    and exists (
      select 1 from public.uis u
      where u.id = ui_id and (u.owner_id = auth.uid() or is_admin())
    )
  );

drop policy if exists published_pages_delete_owner_or_admin on public.published_pages;
create policy published_pages_delete_owner_or_admin
  on public.published_pages for delete
  to authenticated
  using ((owner_id = auth.uid()) or is_admin());

-- ── site_settings ───────────────────────────────────────────────────────────
-- Featured pointer is public; writes are admin-only (ALL covers
-- insert/update/delete — no row exists until seeded in 06).
drop policy if exists site_settings_select_everyone on public.site_settings;
create policy site_settings_select_everyone
  on public.site_settings for select
  to public
  using (true);

drop policy if exists site_settings_write_admin on public.site_settings;
create policy site_settings_write_admin
  on public.site_settings for all
  to authenticated
  using (is_admin())
  with check (is_admin());
