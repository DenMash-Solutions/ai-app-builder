-- Schema: 5 public tables, constraints, defaults.
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
