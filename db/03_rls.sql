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
alter table public.projects       enable row level security;
-- project_screens was previously left to the rls_auto_enable event trigger,
-- which does not exist yet on a fresh run (05 runs after 01) — enable it
-- explicitly like the rest (plan 066).
alter table public.project_screens enable row level security;
alter table public.catalog_assets          enable row level security;
alter table public.catalog_asset_versions  enable row level security;
alter table public.catalog_installs        enable row level security;
alter table public.route_claims            enable row level security;
alter table public.route_redirects         enable row level security;
alter table public.published_entry_points  enable row level security;

-- ── profiles ────────────────────────────────────────────────────────────────
-- No write policies at all: rows are created by the signup trigger, and an
-- authenticated user must never be able to UPDATE their own role to 'admin'.
-- Plan 068 keeps that rule: the username is claimed through the SECURITY
-- DEFINER function claim_username (02), never through a profiles UPDATE
-- policy, and public reads go through public_profile (id + username only).
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

-- ── projects ────────────────────────────────────────────────────────────────
-- Owner-only (plan 064): no public read — projects stay private until their
-- entry points publish (plan 069). UPDATE mirrors the uis F7 hardening: the
-- WITH CHECK forbids re-stamping owner_id (sync ownership takeover).
drop policy if exists projects_select_owner_or_admin on public.projects;
create policy projects_select_owner_or_admin
  on public.projects for select
  to authenticated
  using ((owner_id = auth.uid()) or is_admin());

drop policy if exists projects_insert_own on public.projects;
create policy projects_insert_own
  on public.projects for insert
  to authenticated
  with check (owner_id = auth.uid());

drop policy if exists projects_update_owner_or_admin on public.projects;
create policy projects_update_owner_or_admin
  on public.projects for update
  to authenticated
  using ((owner_id = auth.uid()) or is_admin())
  with check (owner_id = auth.uid());

drop policy if exists projects_delete_owner_or_admin on public.projects;
create policy projects_delete_owner_or_admin
  on public.projects for delete
  to authenticated
  using ((owner_id = auth.uid()) or is_admin());

-- ── project_screens (plan 065) ─────────────────────────────────────────────
-- Owner-only like projects; the single-owner invariant (decision 4) is
-- enforced in the WITH CHECK clauses with the F2/F3 existence shape: a write
-- only lands when the row's owner owns BOTH the project and the screen —
-- membership across owners is impossible even via crafted REST calls.

drop policy if exists project_screens_select_owner_or_admin on public.project_screens;
create policy project_screens_select_owner_or_admin
  on public.project_screens for select
  to authenticated
  using ((owner_id = auth.uid()) or is_admin());

drop policy if exists project_screens_insert_own on public.project_screens;
create policy project_screens_insert_own
  on public.project_screens for insert
  to authenticated
  with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_id = auth.uid()
    )
    and exists (
      select 1 from public.uis u
      where u.id = screen_id and u.owner_id = auth.uid()
    )
  );

drop policy if exists project_screens_update_owner on public.project_screens;
create policy project_screens_update_owner
  on public.project_screens for update
  to authenticated
  using (owner_id = auth.uid())
  with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_id = auth.uid()
    )
    and exists (
      select 1 from public.uis u
      where u.id = screen_id and u.owner_id = auth.uid()
    )
  );

drop policy if exists project_screens_delete_owner on public.project_screens;
create policy project_screens_delete_owner
  on public.project_screens for delete
  to authenticated
  using (owner_id = auth.uid());

-- ── catalog_assets (plan 066) ───────────────────────────────────────────────
-- Browse scope (decision 6): everyone sees their own and every PUBLIC asset;
-- writes are owner-only in practice — the WITH CHECK is the published_pages
-- F4/F7 shape, which lets an admin edit but never re-stamps owner_id onto
-- someone else's row (audit F7), while a non-admin can only ever keep their
-- own ownership (no stealing).
drop policy if exists catalog_assets_select_public_or_owner on public.catalog_assets;
create policy catalog_assets_select_public_or_owner
  on public.catalog_assets for select
  to authenticated
  using ((owner_id = auth.uid()) or (visibility = 'public') or is_admin());

drop policy if exists catalog_assets_insert_own on public.catalog_assets;
create policy catalog_assets_insert_own
  on public.catalog_assets for insert
  to authenticated
  with check (owner_id = auth.uid());

drop policy if exists catalog_assets_update_owner_or_admin on public.catalog_assets;
create policy catalog_assets_update_owner_or_admin
  on public.catalog_assets for update
  to authenticated
  using ((owner_id = auth.uid()) or is_admin())
  with check ((owner_id = auth.uid()) or is_admin());

drop policy if exists catalog_assets_delete_owner_or_admin on public.catalog_assets;
create policy catalog_assets_delete_owner_or_admin
  on public.catalog_assets for delete
  to authenticated
  using ((owner_id = auth.uid()) or is_admin());

-- ── catalog_asset_versions (plan 066) ───────────────────────────────────────
-- Read: own versions, versions of every public asset (browse), admin.
-- INSERT is the F2 shape: you may only publish a version onto an asset you
-- own — publishing onto someone else's public asset is never possible
-- (decision 6). DELETE exists so the asset cascade has a policy on every
-- path; direct deletes are refused by the immutability trigger (05) because
-- the owning asset still exists. No UPDATE policy at all (snapshots are
-- immutable by design — same as page_versions).
drop policy if exists catalog_asset_versions_select_public_or_owner on public.catalog_asset_versions;
create policy catalog_asset_versions_select_public_or_owner
  on public.catalog_asset_versions for select
  to authenticated
  using (
    (owner_id = auth.uid())
    or is_admin()
    or exists (
      select 1 from public.catalog_assets a
      where a.id = asset_id and a.visibility = 'public'
    )
  );

drop policy if exists catalog_asset_versions_insert_own on public.catalog_asset_versions;
create policy catalog_asset_versions_insert_own
  on public.catalog_asset_versions for insert
  to authenticated
  with check (
    (owner_id = auth.uid())
    and exists (
      select 1 from public.catalog_assets a
      where a.id = asset_id and a.owner_id = auth.uid()
    )
  );

drop policy if exists catalog_asset_versions_delete_owner_or_admin on public.catalog_asset_versions;
create policy catalog_asset_versions_delete_owner_or_admin
  on public.catalog_asset_versions for delete
  to authenticated
  using ((owner_id = auth.uid()) or is_admin());

-- ── catalog_installs (plan 066) ─────────────────────────────────────────────
-- Owner-only like project_screens, with the same single-owner WITH CHECK
-- shape: a write only lands when the row's owner owns the project AND the
-- asset is theirs or PUBLIC AND the pinned version belongs to that asset —
-- installing someone else's PRIVATE asset is denied at this layer (066
-- task 5's RLS assertion). UPDATE keeps owner_id pinned (F7 shape); it is
-- the explicit update/rollback flow re-pointing version_id — installs never
-- change on their own.
drop policy if exists catalog_installs_select_owner_or_admin on public.catalog_installs;
create policy catalog_installs_select_owner_or_admin
  on public.catalog_installs for select
  to authenticated
  using ((owner_id = auth.uid()) or is_admin());

drop policy if exists catalog_installs_insert_own on public.catalog_installs;
create policy catalog_installs_insert_own
  on public.catalog_installs for insert
  to authenticated
  with check (
    (owner_id = auth.uid())
    and exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_id = auth.uid()
    )
    and exists (
      select 1 from public.catalog_assets a
      where a.id = asset_id and (a.owner_id = auth.uid() or a.visibility = 'public')
    )
    and exists (
      select 1 from public.catalog_asset_versions v
      where v.id = version_id and v.asset_id = asset_id
    )
  );

drop policy if exists catalog_installs_update_owner on public.catalog_installs;
create policy catalog_installs_update_owner
  on public.catalog_installs for update
  to authenticated
  using (owner_id = auth.uid())
  with check (
    (owner_id = auth.uid())
    and exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_id = auth.uid()
    )
    and exists (
      select 1 from public.catalog_assets a
      where a.id = asset_id and (a.owner_id = auth.uid() or a.visibility = 'public')
    )
    and exists (
      select 1 from public.catalog_asset_versions v
      where v.id = version_id and v.asset_id = asset_id
    )
  );

drop policy if exists catalog_installs_delete_owner on public.catalog_installs;
create policy catalog_installs_delete_owner
  on public.catalog_installs for delete
  to authenticated
  using (owner_id = auth.uid());

-- ── route_claims (plan 069) ─────────────────────────────────────────────────
-- RLS on, deliberately NO policies: the table is written only by the definer
-- triggers in 02 (screen publish, handle change) and read only through
-- `route_available()`. Every client statement is filtered to zero rows, which
-- is what keeps the arbiter unforgeable — there is no "insert my claim direct"
-- path that could skip the reserved/ownership checks in the trigger.
comment on table public.route_claims is
  'Plan 069: single arbiter of the /{locale}/{value} namespace. Definer-trigger writes only; no policies.';

-- ── route_redirects (plan 069) ──────────────────────────────────────────────
-- Public read: a renamed project must answer its old URL for anonymous
-- visitors. INSERT stays trigger-only — rows are minted by
-- `claim_project_handle` alone, so a crafted REST call can never create a
-- redirect. DELETE is the owner's (task 3): unpublish clears the project's
-- redirects BEFORE the status flip, and cascade-on-delete only ever covered
-- deleting the project itself.
drop policy if exists route_redirects_select_everyone on public.route_redirects;
create policy route_redirects_select_everyone
  on public.route_redirects for select
  to public
  using (true);

drop policy if exists route_redirects_delete_own on public.route_redirects;
create policy route_redirects_delete_own
  on public.route_redirects for delete
  to authenticated
  using (owner_id = auth.uid());

-- ── published_entry_points (plan 069) ───────────────────────────────────────
-- Public read only while the owning project is published — plus the OWNER
-- always (decision 25): the publish writes the snapshot BEFORE the status
-- flip (decision 15), so the owner's upsert forms (`on_conflict … do
-- update/nothing`) need row SELECT visibility mid-publish, and Postgres
-- consults the SELECT policy on every conflict-target form even when the
-- resolution would have taken a plain-insert path (`return=minimal`
-- included). Without the owner rung a draft project can never be
-- (re)published — the first UI-driven publish surfaced this as a 42501.
-- `project_is_published` stays a definer helper for the same reason
-- `is_admin()` is: the projects policy is owner-only, so an inline EXISTS
-- would be filtered by RLS for every visitor and the live routes would read
-- as empty (silent 404s).
drop policy if exists published_entry_points_select_when_published
  on public.published_entry_points;
create policy published_entry_points_select_when_published
  on public.published_entry_points for select
  to public
  using (project_is_published(project_id) or owner_id = auth.uid());

-- Owner writes, mirroring the projects F7 shape: the WITH CHECK forbids
-- re-stamping owner_id and refuses a membership in someone else's project.
drop policy if exists published_entry_points_insert_own
  on public.published_entry_points;
create policy published_entry_points_insert_own
  on public.published_entry_points for insert
  to authenticated
  with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_id = auth.uid()
    )
  );

drop policy if exists published_entry_points_update_own
  on public.published_entry_points;
create policy published_entry_points_update_own
  on public.published_entry_points for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists published_entry_points_delete_own
  on public.published_entry_points;
create policy published_entry_points_delete_own
  on public.published_entry_points for delete
  to authenticated
  using (owner_id = auth.uid());
