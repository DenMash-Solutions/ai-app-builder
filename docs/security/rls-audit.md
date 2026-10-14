# RLS Audit — Findings & Fixes

**Date:** 2026-10-13
**Project:** `rfgmupbktannfedkqypq`
**Method:** adversarial review per `docs/plan/rls-audit/plan.md` — policy introspection, live battery executed as real roles (`anon` / `authenticated` user A vs user B / admin) through the Supabase MCP, end-to-end HTTP checks with the real anon key, security advisors and 24 h log review.
**Fix migration:** `rls_audit_hardening` (applied 2026-10-13). App-layer fix: `lib/history/sync.ts` (finding F7).
**Recreation scripts:** `db/` — ordered, re-runnable SQL reproducing the audited schema end-to-end (tables, functions, policies, grants, triggers, seed). Each file validated against the live project inside a rolled-back transaction.

## Verdict

All row-level isolation held (cross-user reads/writes, role escalation, anon writes, draft leakage). Four data-layer findings and one app-layer finding were confirmed, fixed, and re-verified; one advisory is accepted as intentional; one auth-setting advisory is a manual dashboard action.

| # | Finding | Severity | Status |
| - | ------- | -------- | ------ |
| F1 | `TRUNCATE` not gated by RLS — default grants let `anon`/`authenticated` truncate any public table | MEDIUM | fixed + verified |
| F2 | `page_versions` INSERT `WITH CHECK` didn't validate `ui_id` ownership → `(ui_id, version)` squat (save DoS) | MEDIUM | fixed + verified |
| F3 | `published_pages` INSERT/UPDATE allowed occupying another user's `ui_id` + global slug (publish DoS) | MEDIUM | fixed + verified |
| F4 | Admin couldn't edit another user's published page (owner-only `WITH CHECK`) — functional bug | LOW | fixed + verified |
| F5 | `SECURITY DEFINER` functions executable by `anon` via RPC | LOW | fixed; one WARN accepted (below) |
| F6 | Leaked-password protection disabled (auth config) | WARN | manual action (auth scope, out of plan) |
| F7 | Admin session's sync silently transfers ownership of all visible `uis` rows | HIGH | fixed + verified |

## Policy inventory (post-fix)

All five tables have RLS enabled; no views exist in `public`; no `public.*` table is in any realtime publication; the app does not use storage.

| Table | Policy | Cmd | Roles | USING | WITH CHECK |
| ----- | ------ | --- | ----- | ----- | ---------- |
| `profiles` | `profiles_select_own_or_admin` | SELECT | authenticated | `id = auth.uid() or is_admin()` | — |
| `profiles` | *(no write policies — row created by the `on_auth_user_created` SECURITY DEFINER trigger)* | — | — | — | — |
| `uis` | `uis_select_owner_or_admin` | SELECT | authenticated | `owner_id = auth.uid() or is_admin()` | — |
| `uis` | `uis_insert_own` | INSERT | authenticated | — | `owner_id = auth.uid()` |
| `uis` | `uis_update_owner_or_admin` | UPDATE | authenticated | `owner_id = auth.uid() or is_admin()` | `owner_id = auth.uid()` |
| `uis` | `uis_delete_owner_or_admin` | DELETE | authenticated | `owner_id = auth.uid() or is_admin()` | — |
| `page_versions` | `page_versions_select_owner_or_admin` | SELECT | authenticated | `owner_id = auth.uid() or is_admin()` | — |
| `page_versions` | `page_versions_insert_own` | INSERT | authenticated | — | `owner_id = auth.uid()` **and** `exists (uis where id = ui_id and owner_id = auth.uid())` ← F2 |
| `page_versions` | `page_versions_delete_owner_or_admin` | DELETE | authenticated | `owner_id = auth.uid() or is_admin()` | — |
| `page_versions` | *(no UPDATE policy — snapshots immutable by design)* | — | — | — | — |
| `published_pages` | `published_pages_select_everyone` | SELECT | **public** | `true` (intended public projection) | — |
| `published_pages` | `published_pages_write_owner` | INSERT | authenticated | — | `owner_id = auth.uid()` **and** ui-ownership `exists (...)` (`or is_admin()`) ← F3 |
| `published_pages` | `published_pages_update_owner` | UPDATE | authenticated | `owner_id = auth.uid() or is_admin()` | `(owner_id = auth.uid() or is_admin())` ← F4 **and** ui-ownership `exists (...)` ← F3 |
| `published_pages` | `published_pages_delete_owner_or_admin` | DELETE | authenticated | `owner_id = auth.uid() or is_admin()` | — |
| `site_settings` | `site_settings_select_everyone` | SELECT | **public** | `true` (featured pointer is public by design) | — |
| `site_settings` | `site_settings_write_admin` | ALL | authenticated | `is_admin()` | `is_admin()` |

`profiles` has no INSERT/UPDATE/DELETE policy at all → **privilege escalation via `UPDATE profiles SET role='admin'` is impossible** (battery: 0 rows). Signups get their row from the `handle_new_user` trigger.

### Functions (post-fix ACL)

| Function | Kind | EXECUTE |
| -------- | ---- | ------- |
| `is_admin()` | SECURITY DEFINER, reads own profile role for `auth.uid()` | `postgres`, `service_role`, **`authenticated`** (required by policies — see F5) |
| `handle_new_user()` | trigger function on `auth.users` | `postgres`, `service_role` |
| `rls_auto_enable()` | event-trigger function (`ensure_rls`: new tables auto-get RLS) | `postgres`, `service_role` |

### Grants (post-fix)

`anon` / `authenticated` keep `SELECT, INSERT, UPDATE, DELETE` on the five tables (RLS filters rows). `TRUNCATE, TRIGGER, REFERENCES` revoked from both (F1). `auth.users` has no grant to `anon` (battery: `permission denied for table users`).

## Findings

### F1 — TRUNCATE bypasses RLS (MEDIUM)

PostgreSQL doesn't row-filter `TRUNCATE`; only table grants gate it, and Supabase's defaults grant `TRUNCATE` to `anon` and `authenticated`.

Proof (rolled back):

```sql
begin; set role anon; truncate public.site_settings; rollback;
select 'TRUNCATE_ALLOWED';   -- returned TRUNCATE_ALLOWED
```

Fix: `revoke truncate, trigger, references on all tables in schema public from anon, authenticated;`

Verification: `set role anon; truncate public.site_settings;` → `42501 permission denied for table site_settings` (same for `set role authenticated`). No HTTP path exists (PostgREST has no TRUNCATE verb) — defense in depth.

### F2 — page_versions version squat (MEDIUM)

`WITH CHECK (owner_id = auth.uid())` validated the row's owner but not that `ui_id` belongs to them. `ui_id` is public for published pages (it's the PK of `published_pages`), and `(ui_id, version)` is UNIQUE — an attacker could occupy a victim's version numbers and break their saves.

Proof (pre-fix, allowed):

```sql
-- as authenticated attacker (sub = A), ui = victim's published ui
insert into public.page_versions (id, ui_id, owner_id, version, spec)
values (gen_random_uuid(), '<victim ui>', A, 9999, '{}');   -- inserted: 1
```

Fix: extended `page_versions_insert_own` WITH CHECK with `exists (select 1 from uis u where u.id = ui_id and u.owner_id = auth.uid())`.

Verification: same insert → `42501 new row violates row-level security policy for table "page_versions"`; own-ui insert still returns 1.

### F3 — published_pages ui_id/slug squat (MEDIUM)

Same missing ui-ownership check on `published_pages_write_owner` (INSERT) and `published_pages_update_owner` (UPDATE re-point of one's own row). `ui_id` is the PRIMARY KEY and `slug` is globally unique — an attacker could occupy a victim's `ui_id` before they publish (their publish then fails on PK conflict) and squat slugs, publishing arbitrary content under a victim's `ui_id`.

Proof (pre-fix, allowed): INSERT with `ui_id = victim's unpublished ui` → inserted: 1; UPDATE own row `set ui_id = victim's ui` → repointed: 1.

Fix: both clauses now require `exists (select 1 from uis u where u.id = ui_id and (u.owner_id = auth.uid() or is_admin()))`.

Verification: both probes → `42501 new row violates row-level security policy for table "published_pages"`; legitimate own-ui publish still returns 1.

### F4 — Admin blocked from editing others' published pages (LOW, functional)

`USING` admitted admins via `is_admin()` but `WITH CHECK (owner_id = auth.uid())` rejected the resulting row → admin edit of another user's row errored instead of succeeding.

Proof (pre-fix): admin `update published_pages ... where ui_id = <other>` → `42501 new row violates row-level security policy`.
Verification (post-fix): same update → 1 row.

### F5 — SECURITY DEFINER functions RPC-callable (LOW; one WARN accepted)

All three functions had `=X` (PUBLIC EXECUTE) → callable via `/rest/v1/rpc/*` by `anon`.

- `is_admin()` returned `false` for anon/authenticated non-admins (no data beyond the caller's own admin status, which `profiles` SELECT already reveals) — benign but unnecessary surface.
- `handle_new_user()` → `0A000 trigger functions can only be called as triggers` (no-op).
- `rls_auto_enable()` → event-trigger function (errors outside event context).

Fix: revoked from `PUBLIC` and `anon` (plus `authenticated` for the two trigger/event functions).

**Accepted WARN** — `authenticated_security_definer_function_executable` on `is_admin()`: revoking `authenticated` breaks every policy that calls it (`42501 permission denied for function is_admin` observed while evaluating `published_pages_update_owner`) — policies execute the expression as the querying role, so the grant is required. Switching to `SECURITY INVOKER` was tested against and rejected: `is_admin` → `profiles` SELECT policy → `is_admin` recurses. `rpc/is_admin` only answers "am I admin?" for the caller → accepted.

### F6 — Leaked-password protection disabled (WARN, manual)

Auth setting; no MCP tool exposes it. Enable in Dashboard → Authentication → Settings → Password (see [remediation](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)). Email/auth flow hardening is out of scope per plan.

### F7 — Sync silently transfers row ownership (HIGH, app layer)

`lib/history/sync.ts` `pull()` selected `uis` with no owner filter. RLS lets admins see **every** row (`is_admin()`), so an admin session's sync:

1. `pull()` adopted other users' rows into local history (`applyRemoteEntry`),
2. `push()` re-upserted them via `entryToRow(entry, ownerId)` — stamping `owner_id = admin` — and `entryToRow` preserves `created_at`/`updated_at`, so the takeover is invisible in timestamps.

RLS cannot express it: an admin writing `owner_id = self` passes both `USING` and `WITH CHECK`. Non-admins are unaffected (RLS already scopes their `select` to own rows). Observed live during this audit: two test rows created with `owner_id = <test user>` were found re-owned by the admin account minutes later, with pristine timestamps.

Fix (app layer — the only layer that knows the row's origin):

- `pull()`: skip rows where `row.owner_id !== ownerId` (never adopt a foreign row),
- `push()`: never upsert an entry whose remote row is owned by someone else,
- `delete` path: never delete a remote row owned by someone else (stale local copy).

Regression tests in `lib/history/sync.test.ts` (`pull never adopts rows owned by another account`, `push never overwrites or re-owns a row another account owns`) — both fail with the fix reverted.

## Battery matrix (post-fix re-run)

| Check | Role | Result |
| ----- | ---- | ------ |
| `uis` / `page_versions` / `profiles` reads | anon | 0 rows ✅ |
| `published_pages` / `site_settings` reads | anon | public projection ✅ |
| `auth.users` read | anon | `permission denied` ✅ |
| INSERT `uis` / `published_pages` | anon | RLS denied ✅ |
| UPDATE `published_pages` / `site_settings` / `profiles.role` | anon | 0 rows ✅ |
| `TRUNCATE site_settings` | anon, authenticated | `permission denied` ✅ (F1) |
| `rpc is_admin` (SQL + HTTP) | anon | `permission denied` / HTTP 401 ✅ (F5) |
| cross-user UPDATE/DELETE `uis`, others' `published_pages`, others' `page_versions` | user A | 0 rows ✅ |
| `UPDATE profiles SET role='admin'` (own row) | user A | 0 rows ✅ (no policy) |
| version squat / publish squat / re-point | user A | RLS denied ✅ (F2, F3) |
| own-ui insert, own version, own publish | user A | allowed ✅ (no regression) |
| `site_settings` write | user A (non-admin) | 0 rows ✅ |
| `is_admin()` | user A / admin | false / true ✅ |
| `site_settings` write (same value) | admin | allowed ✅ |
| edit another user's published page | admin | allowed ✅ (F4) |
| see all `uis`/`page_versions` | admin | allowed ✅ (intended) |
| `rpc/is_admin` over HTTP | anon | HTTP 401 ✅ |

Test fixtures (2 users, 2 uis, versions, published row) were removed afterwards; final state restored: 1 user, 1 profile (admin), 24 `uis`, 2 `page_versions`, 2 published pages (`denmash`, `todo`), `site_settings.featured` unchanged.

## Advisories & logs

- Advisories after fixes: 2 WARN — F5 accepted (above) and F6 (manual). The three original `*_security_definer_function_executable`/anon findings are cleared except the accepted one.
- 24 h logs: no failed logins, no 4xx/5xx auth responses, audit trail shows only the owner's own `login`/`token_refreshed`/`token_revoked` events from a single IP. `postgres_logs` anomalies are only this audit's own denial probes (`row-level security policy` / `permission denied for table site_settings`) plus checkpoints — nothing else.

## Residual notes

- The public `published_pages` projection intentionally exposes `ui_id` and `slug` (fixed by F2/F3 — they are now safe to expose).
- `uis_update_owner_or_admin` has owner-only `WITH CHECK` (admin edits that would change `owner_id` fail). No admin flow does this today; noted, not changed.
- F7's stale local copies: if another browser session already adopted foreign rows before the fix, its next sync won't push or delete them, but the local entries linger until removed from that browser's history sidebar.
