-- Seed: minimal rows the app expects to exist.
-- Depends on: 01_schema.sql.
-- Re-runnable: ON CONFLICT DO NOTHING.

-- The app reads site_settings as a singleton row (id = true).
insert into public.site_settings (id) values (true)
on conflict (id) do nothing;

-- Admin promotion is intentionally NOT scripted: it targets a real auth user
-- that only exists after signup. Promote manually after creating the account:
--
--   update public.profiles
--      set role = 'admin'
--    where id = (select id from auth.users where email = 'you@example.com');
