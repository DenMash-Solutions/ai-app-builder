-- Data sources M2 (docs/plan/database-provider): the single approved table
-- generated UIs may touch. Resources map to (app_id, resource) row scopes
-- over a `data jsonb` column — never to named author tables — and every
-- row is owned by the visitor session whose context created it
-- (user_id, enforced by RLS below). DB-03/DB-07.

create table if not exists public.genui_records (
  app_id text not null,
  resource text not null,
  id text not null,
  user_id uuid not null default auth.uid(),
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (app_id, resource, id)
);

-- List reads order by created_at; every request filters on (app_id, resource).
create index if not exists genui_records_scope_idx
  on public.genui_records (app_id, resource, created_at);

alter table public.genui_records enable row level security;

-- Authorization boundary (DB-07): visitors see only their own rows. The
-- adapter ensures a session before any query — signed-in users use their
-- account, fresh visitors are anonymously signed in once and the session
-- persists in the browser. Sessions carry the `authenticated` role
-- (Supabase anonymous users included), so policies target that role; a
-- spec-less request with no session (role `anon`) gets nothing.
create policy "genui_records_select_own" on public.genui_records
  for select to authenticated
  using (user_id = auth.uid());

create policy "genui_records_insert_own" on public.genui_records
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "genui_records_update_own" on public.genui_records
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "genui_records_delete_own" on public.genui_records
  for delete to authenticated
  using (user_id = auth.uid());

-- Public API programs keep updated_at honest for multi-surface consumers.
create or replace function public.genui_records_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists genui_records_touch on public.genui_records;
create trigger genui_records_touch
  before update on public.genui_records
  for each row
  execute function public.genui_records_touch_updated_at();

-- Anonymous sign-in must be enabled on the project (auth-provider setting):
-- the adapter's initialize() signs fresh visitors in transparently. The
-- Supabase MCP config step records whether that was already on.
