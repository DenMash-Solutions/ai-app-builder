# Usernames and Public UI Profiles

**Status:** implemented
**Date:** 2026-10-31

## Goal

Give every user a unique username and a public profile route that lists only
their published UIs.

## Scope

### In scope

- `profiles.username`: lowercase, matches `SLUG_PATTERN`, unique index,
  never a reserved segment, required at signup for new users
- Existing-user claim flow: prompt until claimed, no silent auto-claim
- Availability check (usability only — the DB constraint is the truth)
- Route `app/[locale]/user/[username]/ui` listing only that owner's
  `published_pages` rows (drafts and local entries never appear)
- `user` added to **both** `RESERVED_SLUGS` (`lib/slug.ts`) and
  `APP_SEGMENTS` (`lib/i18n/routing.ts`) — see the scope guard for why the
  route 404s without the second one
- Read of profiles through a narrow definer RPC (id + username only); the
  `email`/`role` columns stay private
- en/es copy for the signup field, claim UI and profile page

### Out of scope

- Project handles (069), avatars/bios, social features, following, admin
  username management

## Design decisions

1. Claim at signup for new users; existing users are prompted until they
   claim — rejected: auto-generated usernames, because collisions with
   human-desired names and the source requirement both say the user chooses.
2. Username changes are allowed and the old value is released — rejected:
   permanent redirects here, because redirect policy belongs to project
   handles (069) and would conflict with reclaim rules.
3. Uniqueness enforced by the database; the availability check in the UI is
   advisory only — rejected: UI-only uniqueness, because a race must not
   create duplicates.
4. A username can never equal a reserved segment or an active project
   handle — rejected: separate namespaces, because there is one URL space
   (062 decision 1).
5. **Writes go through a `security definer` RPC, not an RLS update policy**
   (scope guard F2). `db/03_rls.sql` gives `profiles` no write policy *on
   purpose* — the comment there says a self-update policy would let a user
   set their own `role` to `admin`, and `db/04_grants.sql` grants DML at
   table level, so a column-level grant cannot narrow it. `claim_username`
   is the only path, and it only ever writes `username` for `auth.uid()`.
6. **Public reads go through a definer RPC too** (scope guard F1): the
   `profiles` SELECT policy is own-or-admin, and making it public would
   expose `email` to every visitor. `public_profile(username)` returns
   `(id, username)` and nothing else.

## Code reality (scope guard, 2026-11-04)

Verified against the current tree before approving:

- **F1 — profiles is not publicly readable, and cannot be made so safely.**
  `db/03_rls.sql:24` is `profiles_select_own_or_admin`; `db/04_grants.sql:12`
  grants SELECT on all tables to `anon`, so column privacy is impossible at
  the grant level. The draft's "minimal public read of profiles (id +
  username columns only)" therefore needs a `security definer` RPC
  (decision 6), not a policy.
- **F2 — there is no write path on profiles at all.** No UPDATE policy
  exists by design (role escalation), so the claim needs the definer RPC
  (decision 5).
- **F3 — the reserved-segment list must NOT be duplicated in SQL.**
  `db/01_schema.sql:76` (plan 064) records that decision explicitly: "the
  reserved list lives in lib/slug.ts and a DB copy would drift", and
  projects validate reserved segments app-side. Usernames follow the same
  rule: DB enforces pattern + length + uniqueness, code enforces reserved.
- **F4 — `user` in `APP_SEGMENTS` is load-bearing, not cosmetic.** In
  `proxy.ts:60` a path whose first segment is not a locale and not in
  `APP_SEGMENTS` is a *content path*; with a second segment present, a
  non-canonical tag (any username) is rewritten to `/_not-found` at line 82.
  So `/en/user/alice/ui` 404s unless `user` is an app segment. Confirmed the
  draft's warning, with the exact mechanism.
- **F5 — signup is a committed spec + a handler, not a React form.**
  `app/[locale]/(app)/signup/page.tsx` mounts `lib/specs/signup.spec.json`
  with `AuthActions` doing `supabase.auth.signUp`. A required username is a
  spec field + `options.data.username` + trigger support, not a form edit.
- **F6 — `handle_new_user()` inserts `(id, email)` only** (`db/02_functions.sql:13`);
  it must also copy the signup metadata's username so a new account is
  claimed atomically, with a duplicate failing the signup itself.
- **F7 — `published_pages` is already public-read** (`db/03_rls.sql:90`,
  policy to `public` using `true`), one row per published UI with
  `owner_id` + globally unique `slug`. The profile listing needs no new
  grant; `publishedSlugExistsFrom`/`getPublishedPageBySlugFrom`
  (`lib/publish/featured.ts`) show the server-read pattern to mirror.
- **F8 — two e2e identities exist** (`E2E_ADMIN_*`, `E2E_USER_*`,
  `e2e/.state/{admin,user}.json`), both real accounts with no username, so
  the claim-taken path is testable server-side without inventing users.

## Files

- `db/01_schema.sql` — `profiles.username` column, pattern/length checks,
  unique index
- `db/02_functions.sql` — `handle_new_user()` username copy,
  `claim_username()`, `username_available()`, `public_profile()`
- `db/04_grants.sql` — EXECUTE ACLs for the three new functions
- `lib/slug.ts` — `user` in `RESERVED_SLUGS`; `lib/usernames.ts` (new) —
  normalize + validate, shared by signup, claim UI and tests
- `lib/i18n/routing.ts` — `user` in `APP_SEGMENTS`
- `lib/specs/signup.spec.json` + `components/auth/auth-actions.tsx` +
  `components/auth/auth-provider.tsx` (username in context, refresh after
  claim)
- claim UI (surface per Q1) + en/es keys
- `app/[locale]/user/[username]/ui/page.tsx` (new) + its list rendering

## Tasks

### 1. Schema and RPCs (db/)

- [x] `profiles.username text` + `profiles_username_check`
      (`username is null or username ~ '^[a-z0-9]+(-[a-z0-9]+)*$'` and
      length ≤ 48, matching `SLUG_PATTERN` / `SLUG_MAX_LENGTH`), and a
      unique index that leaves NULLs distinct so unclaimed users coexist
- [x] `handle_new_user()` copies the normalized
      `raw_user_meta_data->>'username'`, so signup claims atomically and a
      duplicate fails the signup (F6)
- [x] `claim_username(p_username text)` — security definer, normalizes,
      rejects NULL/pattern/length violations, writes only `username` for
      `auth.uid()`, lets `unique_violation` surface (decision 5)
- [x] `username_available(p_username text)` — security definer, advisory
      (decision 3)
- [x] `public_profile(p_username text)` returns `(id, username)` only
      (decision 6)
- [x] Grants: EXECUTE on `claim_username` to `authenticated` only (revoke
      PUBLIC/anon); `username_available` + `public_profile` to `anon`,
      `authenticated`, `service_role` (audit F5 pattern)
- [x] Reserved segments: `user` in `lib/slug.ts` **and** `lib/i18n/routing.ts`
      (F3, F4) — no SQL copy, matching projects
- [x] Update `db/README.md` run-order notes for the new functions

### 2. Signup + claim flow

- [x] `lib/usernames.ts`: `normalizeUsername`, `usernameIssue` (pattern,
      length, reserved) as object constants, unit-tested
- [x] Signup spec gains a username field with required/pattern checks, and
      `auth.signup` sends `options.data.username` (F5)
- [x] Claim UI for existing users (surface per Q1), calling
      `claim_username`, surfacing "taken" separately from "invalid"
- [x] `AuthProvider` exposes the current username and refreshes after a
      claim; the claim prompt disappears without a reload
- [x] Duplicate signup surfaces the taken-username error, not a generic
      auth failure
- [x] en/es copy for the field, the dialog, the errors and the profile page

### 3. Public profile route

- [x] `app/[locale]/user/[username]/ui/page.tsx`: resolve the username via
      `public_profile`, 404 on unknown, list `published_pages` for that
      `owner_id` with explicit columns (names + links to the published
      page's URL); drafts and local entries never reach the payload (F7)
- [x] Profile metadata (title/description) localized; list empty state
- [x] Confirm `proxy.ts` needs no change once `user` is an app segment (F4):
      no code change was needed, but the spot-check found the shallow shapes
      `/en/user` and `/en/user/<handle>` falling into the `/{locale}/{slug}`
      catch-all (200 + client not-found, a soft 404) because the proxy no
      longer rewrites content paths that lead with an app segment. Two guard
      routes that call `notFound()` (`app/[locale]/user/page.tsx`,
      `app/[locale]/user/[username]/page.tsx`, both `instant = false`) restore
      the real 404 — an e2e assertion pins it.

### 4. Tests

- [x] Unit: normalization, reserved rejection, pattern/length enforcement
- [x] Unit: availability + claim error mapping (taken vs invalid)
- [x] e2e: the two identities claim their usernames; a second claim of a
      taken name is rejected server-side and shown inline (F8)
- [x] e2e: profile lists only that owner's published UIs, hides a draft,
      404s on an unknown username
- [x] e2e deep-link regressions: bare, two-segment and three-segment paths
      still resolve (content path, app path, `/user/...`)

## Verification

- [x] `bun run lint && bunx tsc --noEmit && bun run test`
- [x] `bun run test:e2e` full suite green
- [x] Proxy spot-check: bare, two-segment and three-segment paths still
      resolve (content path, app path, profile route)
- [x] Canary profile refused: an anonymous visitor can read a profile page
      but cannot read `email`/`role` through the same client

## Decisions taken (approved 2026-11-04)

1. Q1 — an item in the existing account menu
   (`components/shell/public-account-cluster.tsx`) plus a dismissible shell
   banner pointing at it until the username is claimed. Nothing blocks the
   app; the profile route simply does not exist for an unclaimed account.
2. Q2 — the profile lists published *screens* (`published_pages`) only;
   plan 069 adds project rows as a second section.
3. Q3 — debounced `username_available` while typing, with submit still
   authoritative (the DB constraint decides).

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-31 | plan drafted |
| 2026-11-04 | approved (Q1 account menu + banner, Q2 screens only, Q3 debounced check) |
| 2026-11-04 | scope guard run: F1–F8 recorded, tasks rewritten against the current tree (definer RPCs for claim/public read, reserved list stays app-side, `user` in both segment lists, signup spec + trigger), decisions 5–6 added, Q1–Q3 opened |
| 2026-11-04 | implemented (Tasks 1–4, `bun run lint` 0 / `tsc` clean / 981 unit / 144 e2e; live DB migrated as `plan_068_usernames`) |

## Implementation notes (what actually shipped)

- **Claim and public read are RPCs, not policies** (F1/F2): `claim_username`
  (definer, `authenticated` + `service_role` only), `username_available` and
  `public_profile` (`anon` + `authenticated` + `service_role`). `profiles`
  keeps **zero** write policies and no public SELECT policy.
- **Canary evidence (2026-11-04, live project, anon key):**
  `profiles?select=email,role` → `200`, **0 rows**; `public_profile`
  → `200` with exactly `{id, username}`; `claim_username` → `401`
  `42501 permission denied for function claim_username`.
- Reserved rejection is app-side only (F3). `usernameIssue` checks reserved
  **before** length so `ui` reports "reserved" rather than "too short";
  `USERNAME_MIN_LENGTH = 3` is mirrored by the DB CHECK (3–48).
- Signup availability rides the spec's `Input` `on.change` event (this
  `@json-render` version has no `watch`), handled by `auth.checkUsername`
  with a 350 ms latest-wins debounce. A duplicate signup surfaces as
  Supabase's "database error saving new user", which `auth.signup` re-labels
  by re-checking availability.
- Claim surfaces: `AccountBlock` (shell) **and** `PublicAccountCluster` (the
  landing, per Q1) each render `UsernameClaimDialog`; the dismissible banner
  (`genui-username-banner-dismissed`) sits at the top of `SidebarInset`.
  Both menu items live under their own namespace translator — `t` in the
  shell is scoped to `shell`, and reusing it threw `MISSING_MESSAGE`
  (`shell.username.claim.menu`), which also raised the dev error overlay and
  broke the sign-out e2e until fixed.
- Profile read lives in `lib/profile/public-profile.ts` (unit-tested):
  RPC lookup → explicit-column `published_pages` read by `owner_id`, 404 on
  unknown handle, `null` on read failure (never an empty profile).
