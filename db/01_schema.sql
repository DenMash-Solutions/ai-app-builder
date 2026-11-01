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
-- lib/slug.ts and a DB copy would drift. home_screen_id gains a membership
-- check when project_screens lands (plan 065); ON DELETE SET NULL leaves the
-- project without a root entry point rather than dangling.
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
