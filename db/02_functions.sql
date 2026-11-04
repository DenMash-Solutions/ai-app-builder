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
declare
  v_username text;
begin
  -- Plan 068 decision 1: a new account claims its handle at signup, so the
  -- profile row lands already named. The app validates shape and reserved
  -- segments first; this only normalizes, and a taken handle fails the
  -- signup itself (unique index) rather than leaving a half-claimed account.
  v_username := nullif(lower(btrim(new.raw_user_meta_data ->> 'username')), '');
  insert into public.profiles (id, email, username)
  values (new.id, new.email, v_username)
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

-- Plan 066 decision 4: fork-on-edit runs as ONE transaction server-side —
-- read version → create copy → initial revision → swap reference — so a
-- partial migration is impossible (the rejected client-side multi-step).
-- SECURITY INVOKER (the default) on purpose: every statement runs under the
-- caller's RLS, so the asset/version reads are own-or-public, the copy is
-- stamped with auth.uid(), and the reference swap re-checks ownership via
-- the catalog_installs / project_screens policies. Concurrency: the install
-- row is locked FOR UPDATE, so two forks of the same install serialize and
-- the loser swaps the winner's target instead of stranding it. Returns the
-- created uis row (to_jsonb) so the client can adopt it without a second
-- round trip; `membership_swapped` tells it whether anything is left to add.
-- Decision 10 refinements: the swap clears `target_key` (it belonged to the
-- old target), the membership swap runs only for screen installs (a
-- component install's target is its HOST — swapping would hijack the host's
-- drawer row), and a project with no install gets one created (asset →
-- working-copy link, so it syncs cross-device).
create or replace function public.fork_catalog_asset(
  p_asset_id uuid,
  p_version_id uuid default null,
  p_project_id uuid default null
)
returns jsonb
language plpgsql
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_asset public.catalog_assets%rowtype;
  v_version public.catalog_asset_versions%rowtype;
  v_install_id uuid;
  v_old_target uuid;
  v_old_target_key text;
  v_check uuid;
  v_membership_swapped boolean := false;
  v_ui_id uuid := gen_random_uuid();
  v_base text;
  v_slug text;
  v_revisions jsonb;
  v_row public.uis%rowtype;
begin
  if v_uid is null then
    raise exception 'plan 066 decision 4: fork requires a signed-in user'
      using errcode = 'check_violation';
  end if;
  if p_asset_id is null then
    raise exception 'plan 066 decision 4: asset id is required'
      using errcode = 'check_violation';
  end if;

  -- RLS-scoped reads: another user's private asset is invisible here and
  -- reads as not-found — identical to a missing row, no information leak.
  select * into v_asset from public.catalog_assets where id = p_asset_id;
  if not found then
    raise exception 'plan 066 decision 4: asset % not found', p_asset_id
      using errcode = 'check_violation';
  end if;

  if p_version_id is not null then
    select * into v_version
      from public.catalog_asset_versions
     where id = p_version_id
       and asset_id = p_asset_id;
  else
    select * into v_version
      from public.catalog_asset_versions
     where id = v_asset.latest_version_id
       and asset_id = p_asset_id;
  end if;
  if not found then
    raise exception
      'plan 066 decision 4: version not found for asset %', p_asset_id
      using errcode = 'check_violation';
  end if;

  -- Create copy: slug mirrors the client's uniqueSlugFrom (slugified name
  -- capped at 40 + hyphen + first 8 id chars — the id tail makes collisions
  -- impossible in practice, same argument as the local generator).
  v_base := regexp_replace(
    lower(
      regexp_replace(
        normalize(v_asset.name, NFD),
        U&'[\0300-\036f]',
        '',
        'g')),
    '[^a-z0-9]+', '-', 'g');
  v_base := trim(both '-' from v_base);
  v_base := left(regexp_replace(v_base, '-+$', ''), 40);
  if v_base = '' then
    v_base := 'ui'; -- RESERVED_SLUGS.ui — the client's empty-name fallback
  end if;
  v_slug := v_base || '-' || left(replace(v_ui_id::text, '-', ''), 8);

  -- Initial revision: the version's spec as revision 0 (head 0), labeled
  -- like every client-generated first revision (REVISION_LABELS.generate).
  v_revisions := jsonb_build_array(jsonb_build_object(
    'spec', v_version.spec,
    'label', 'generate',
    'createdAt', (extract(epoch from now()) * 1000)::bigint
  ));

  insert into public.uis (id, owner_id, name, slug, prompt, revisions, head)
  values (v_ui_id, v_uid, v_asset.name, v_slug, v_asset.name, v_revisions, 0);

  -- Swap reference: the active project's install (when one exists) points
  -- at the fork now — install target and its membership row together, so
  -- the project's drawer and its pin can never disagree mid-migration.
  if p_project_id is not null then
    select i.id, i.target_ui_id, i.target_key
      into v_install_id, v_old_target, v_old_target_key
      from public.catalog_installs i
     where i.owner_id = v_uid
       and i.project_id = p_project_id
       and i.asset_id = p_asset_id
     for update;

    if found then
      -- Decision 10a: the swap clears target_key — the old key belonged to
      -- the old target (a stale key would name an element in a spec the
      -- install no longer points at).
      update public.catalog_installs
         set target_ui_id = v_ui_id,
             target_key = null,
             updated_at = now()
       where id = v_install_id;

      -- Decision 10b: only a SCREEN install swaps the membership row. A
      -- component install's target is its HOST ui — repointing the host's
      -- drawer row at the fork would hijack it.
      if v_old_target_key is null then
        update public.project_screens
           set screen_id = v_ui_id,
               updated_at = now()
         where owner_id = v_uid
           and project_id = p_project_id
           and screen_id = v_old_target;
        v_membership_swapped := found;
      end if;
    else
      -- Decision 10c: no install for this asset in the project — create
      -- one so the asset → working-copy link syncs cross-device. Guard on
      -- project ownership first: without it a foreign project id would
      -- trip the installs WITH CHECK mid-fork and abort the whole
      -- transaction (the copy would never be created).
      select id into v_check
        from public.projects
       where id = p_project_id
         and owner_id = v_uid;
      if found then
        insert into public.catalog_installs
          (id, owner_id, project_id, asset_id, version_id, target_ui_id,
           target_key)
        values (gen_random_uuid(), v_uid, p_project_id, p_asset_id,
                v_version.id, v_ui_id, null)
        returning id into v_install_id;
      end if;
    end if;
  end if;

  select * into v_row from public.uis where id = v_ui_id;

  return jsonb_build_object(
    'uis_id', v_ui_id,
    'version_id', v_version.id,
    'install_id', v_install_id,
    'membership_swapped', v_membership_swapped,
    'uis_row', to_jsonb(v_row)
  );
end;
$$;

-- ── usernames (plan 068) ────────────────────────────────────────────────────
-- profiles has NO write policy on purpose (a self-update policy would let a
-- user set role = 'admin'), and table-level grants rule out narrowing it by
-- column. The claim therefore goes through this SECURITY DEFINER function,
-- which can only ever write `username` for the calling session's own row.
create or replace function public.claim_username(p_username text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid      uuid := auth.uid();
  v_username text := lower(btrim(coalesce(p_username, '')));
  v_current  text;
begin
  if v_uid is null then
    raise exception 'claim_username requires a session'
      using errcode = '42501';
  end if;

  select p.username into v_current from public.profiles p where p.id = v_uid;
  if not found then
    raise exception 'no profile row for the current user'
      using errcode = '42501';
  end if;

  -- Re-claiming the current handle is a no-op success (change flows retry).
  if v_current is not distinct from v_username then
    return v_current;
  end if;

  update public.profiles set username = v_username where id = v_uid;
  return v_username;
end;
$$;

-- Advisory only (decision 3): the unique index is the truth, so a race between
-- two claims still ends with exactly one winner. Shape is not re-validated as
-- a claim concern — the caller does that, and the CHECK rejects junk anyway.
create or replace function public.username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    char_length(btrim(coalesce(p_username, ''))) > 0
    and not exists (
      select 1
      from public.profiles p
      where p.username = lower(btrim(coalesce(p_username, '')))
    );
$$;

-- Public read of a profile by handle (decision 6). Returns id + username and
-- nothing else: making profiles publicly selectable instead would expose
-- `email` to every visitor, because grants are table-level.
create or replace function public.public_profile(p_username text)
returns table (id uuid, username text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select p.id, p.username
  from public.profiles p
  where p.username = lower(btrim(coalesce(p_username, '')));
$$;

-- ── route claims (plan 069) ─────────────────────────────────────────────────

-- Is this project's projection servable? SECURITY DEFINER for the same reason
-- is_admin() is: an RLS policy on published_entry_points needs to read
-- projects, whose own policy is owner-only, and running the subquery as the
-- caller would filter the project out and hide every live route.
create or replace function public.project_is_published(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.projects p
    where p.id = p_project_id and p.status = 'published'
  );
$$;

-- Advisory availability probe for the publish dialog (the claim itself is the
-- authority). Anon by design: the dialog runs before the first write, and the
-- value space (URLs) is public anyway — the owner column never leaves here.
--
-- `p_kind` is the claim the caller is ABOUT to make ('screen' | 'handle'):
-- a value is available when nothing claims it, when the caller's own claim
-- already IS that kind (republish / unchanged handle), or — nothing else.
-- Their own OTHER kind blocks them (decision 10: the collision the trigger
-- refuses), and so does anyone else's claim of any kind. An unknown kind
-- answers false rather than loosening the check.
drop function if exists public.route_available(text);
create or replace function public.route_available(p_value text, p_kind text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    p_kind in ('screen', 'handle')
    and char_length(btrim(coalesce(p_value, ''))) > 0
    and not exists (
      select 1 from public.route_claims c
      where c.value = lower(btrim(coalesce(p_value, '')))
        and (c.kind is distinct from p_kind
             or c.owner_id is distinct from auth.uid())
    );
$$;

-- Live lookup for the public handle surface (plan 069 task 4). ONE value
-- answers three questions: a published project currently holding it
-- (`handle = value` → serve that project), a published project that USED to
-- hold it (`route_redirects.from_value = value` → the caller redirects,
-- because `handle <> value`), or nothing at all (unknown value — or the
-- holder is a draft: the site is dark, so a redirect would only trade one
-- 404 for another). The two branches can never both fire for one value:
-- decision 4 keeps a redirected value reserved for its owner, so a live
-- handle and a redirect row never share a value.
--
-- SECURITY DEFINER for the same reason route_available() is: `projects` is
-- owner-only and `route_claims` has no policies, so an invoker read would
-- answer NULL for every visitor. Only `project_id` + `handle` of a PUBLISHED
-- project leave here — no owner, no state, no name.
create or replace function public.live_project(p_value text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with v as (select lower(btrim(coalesce(p_value, ''))) as value)
  select coalesce(
    (select jsonb_build_object('project_id', p.id, 'handle', p.handle)
       from public.projects p
      where p.handle = v.value and p.status = 'published'),
    (select jsonb_build_object('project_id', p.id, 'handle', p.handle)
       from public.route_redirects r
       join public.projects p on p.id = r.project_id
      where r.from_value = v.value
        and p.status = 'published'
        and p.handle <> v.value)
  ) from v;
$$;

-- Publishing a screen claims its slug in the shared namespace (F2). Runs as
-- the definer so the writer needs no grant on route_claims; any failure here
-- aborts the publish itself, which is the point — a published slug that is
-- not reserved could be taken by a project handle a moment later.
create or replace function public.claim_screen_route()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_owner uuid;
  v_kind  text;
begin
  select c.owner_id, c.kind into v_owner, v_kind
    from public.route_claims c where c.value = new.slug;

  if found then
    if v_owner <> new.owner_id then
      raise exception 'route % is already claimed', new.slug
        using errcode = '23505';
    end if;
    -- Decision 10: the value is the owner's LIVE project handle. Publishing
    -- the screen anyway would give a URL that precedence (handle > screen)
    -- can never serve, so refuse loudly instead of publishing a dead link.
    if v_kind = 'handle' then
      raise exception 'route % is held by a project handle', new.slug
        using errcode = '23505';
    end if;
    if v_kind = 'redirect' then
      -- Decision 4: the owner reclaims their own redirect — the live screen
      -- wins, so both the claim kind and the redirect row move.
      update public.route_claims
         set kind = 'screen', project_id = null
       where value = new.slug;
      delete from public.route_redirects where from_value = new.slug;
    end if;
    -- kind = 'screen': the owner re-publishing their own slug — idempotent.
  else
    insert into public.route_claims (value, owner_id, kind)
    values (new.slug, new.owner_id, 'screen');
  end if;

  return new;
end;
$$;

-- A handle change claims the new value and turns the old one into a permanent
-- redirect (decisions 4/6). It runs AFTER the row write, inside the SAME
-- statement: a taken handle raises, which rolls the whole statement back — so
-- the project row and its claim land together or not at all (and the FK on
-- route_claims.project_id is satisfied, which a BEFORE trigger could not do:
-- the row does not exist yet).
create or replace function public.claim_project_handle()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_owner uuid;
  v_kind  text;
begin
  if new.handle is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.handle is not distinct from old.handle then
    return new;
  end if;

  select c.owner_id, c.kind into v_owner, v_kind
    from public.route_claims c where c.value = new.handle;

  if found then
    -- Reclaiming your own former handle is allowed; anyone else's is not.
    if v_owner <> new.owner_id then
      raise exception 'handle % is already claimed', new.handle
        using errcode = '23505';
    end if;
    -- Decision 10: the value is a published screen slug of this same owner.
    -- Flipping it to a handle would shadow that screen (handle > screen) and
    -- leave `route_claims` disagreeing with `published_pages` — refuse; the
    -- owner releases the screen first if they really want the value.
    if v_kind = 'screen' then
      raise exception 'handle % is held by a published screen', new.handle
        using errcode = '23505';
    end if;
    -- kind = 'redirect' → decision 4 reclaim; kind = 'handle' → idempotent.
    update public.route_claims
       set kind = 'handle', project_id = new.id
     where value = new.handle;
    delete from public.route_redirects where from_value = new.handle;
  else
    insert into public.route_claims (value, owner_id, kind, project_id)
    values (new.handle, new.owner_id, 'handle', new.id);
  end if;

  if tg_op = 'UPDATE' and old.handle is not null
     and old.handle <> new.handle then
    insert into public.route_redirects (from_value, owner_id, project_id)
    values (old.handle, new.owner_id, new.id)
    on conflict (from_value) do update
      set owner_id = excluded.owner_id,
          project_id = excluded.project_id;

    update public.route_claims
       set kind = 'redirect', project_id = new.id
     where value = old.handle
       and owner_id = new.owner_id
       and kind = 'handle';
  end if;

  return new;
end;
$$;
