-- Schema: 6 public tables, constraints, defaults.
-- Depends on: Supabase-managed `auth` schema (auth.users) — exists on any project.
-- Re-runnable: CREATE TABLE IF NOT EXISTS; constraints are added only when missing.
-- gen_random_uuid() is core since PostgreSQL 13 — no extension needed.

-- ── profiles ────────────────────────────────────────────────────────────────
-- One row per auth user, created by the on_auth_user_created trigger (05).
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  role       text not null default 'user',
  created_at timestamptz not null default now(),
  email      text,
  constraint profiles_role_check check (role in ('user', 'admin'))
);

-- ── uis ─────────────────────────────────────────────────────────────────────
-- The user's playground drafts; revisions jsonb is the version stack.
create table if not exists public.uis (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users (id) on delete cascade,
  name       text not null default 'Untitled',
  slug       text not null,
  prompt     text,
  revisions  jsonb not null default '[]'::jsonb,
  head       integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uis_slug_check check (char_length(slug) between 1 and 64),
  constraint uis_owner_id_slug_key unique (owner_id, slug)
);

-- ── page_versions ───────────────────────────────────────────────────────────
-- Immutable snapshots appended on each save; (ui_id, version) is the squash slot.
create table if not exists public.page_versions (
  id           uuid primary key default gen_random_uuid(),
  ui_id        uuid not null references public.uis (id) on delete cascade,
  owner_id     uuid not null references auth.users (id) on delete cascade,
  version      integer not null,
  spec         jsonb not null,
  label        text,
  published_at timestamptz not null default now(),
  constraint page_versions_version_check check (version >= 1),
  constraint page_versions_ui_id_version_key unique (ui_id, version)
);

-- ── published_pages ─────────────────────────────────────────────────────────
-- Public projection: one row per published ui (PK ui_id), global-unique slug.
create table if not exists public.published_pages (
  ui_id        uuid primary key references public.uis (id) on delete cascade,
  owner_id     uuid not null references auth.users (id) on delete cascade,
  slug         text not null,
  name         text not null,
  version      integer not null,
  spec         jsonb not null,
  published_at timestamptz not null default now(),
  artifacts    jsonb,
  constraint published_pages_slug_check check (char_length(slug) between 1 and 64),
  constraint published_pages_version_check check (version >= 1),
  constraint published_pages_slug_key unique (slug)
);

-- ── site_settings ───────────────────────────────────────────────────────────
-- Singleton row (id = true); featured_ui_id points the landing page at a
-- published_pages row (ON DELETE SET NULL).
create table if not exists public.site_settings (
  id             boolean primary key default true constraint site_settings_id_check check (id),
  featured_ui_id uuid references public.published_pages (ui_id) on delete set null,
  updated_at     timestamptz not null default now()
);

-- ── projects ────────────────────────────────────────────────────────────────
-- Plan 064: the application boundary (a grouping of screens). Local-first:
-- the PK deliberately has NO default — ids are client-generated uuids so an
-- anonymous local project adopts without ever remapping HistoryEntry.projectId.
-- `updated_at` is stamped app-side by the sync writer (same as uis) and is
-- the LWW tie-break. Reserved segments are checked in code at create and
-- rename (lib/slug.ts isReservedSlug) — the reserved list lives in
-- lib/slug.ts and a DB copy would drift. home_screen_id membership is
-- validated APP-SIDE (plan 065 decision 10; supersedes the original plan to
-- add a DB check): the projects and project_screens sync loops are
-- independent, and a cross-loop FK/trigger would fail whole-project pushes
-- transiently while the membership row is still in flight. ON DELETE SET
-- NULL leaves the project without a root entry point rather than dangling.
create table if not exists public.projects (
  id             uuid primary key,
  owner_id       uuid not null references auth.users (id) on delete cascade,
  name           text not null,
  slug           text not null,
  home_screen_id uuid references public.uis (id) on delete set null,
  status         text not null default 'draft',
  state          jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint projects_slug_check check (char_length(slug) between 1 and 64),
  constraint projects_status_check check (status in ('draft', 'published', 'archived')),
  constraint projects_owner_id_slug_key unique (owner_id, slug)
);

-- ── project_screens ─────────────────────────────────────────────────────────
-- Plan 065: project membership — which screens belong to a project, with an
-- optional configured route and a stable position. Local-first like uis and
-- projects: the PK deliberately has NO default — ids are client-generated
-- uuids. `owner_id` is denormalized from the project (065 decision 8): the
-- generic sync loop's slim read and F7 ownership guard read it off every
-- row, and RLS policies filter on it directly. `route` is the `{param}`
-- pattern (null = the screen matches by exact slug only); unique per
-- project so a duplicate route is rejected at authoring time (decision 7) —
-- Postgres treats NULLs as distinct, so many route-less members coexist.
-- `position` orders members for deterministic matching ties (decision 6).
-- Single-owner invariant (decision 4): the WITH CHECK policies verify the
-- membership's owner owns BOTH the project and the screen (F2/F3 shape).
create table if not exists public.project_screens (
  id         uuid primary key,
  owner_id   uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  screen_id  uuid not null references public.uis (id) on delete cascade,
  route      text,
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_screens_route_check check (route is null or char_length(route) between 1 and 128),
  constraint project_screens_project_id_screen_id_key unique (project_id, screen_id),
  constraint project_screens_project_id_route_key unique (project_id, route)
);
