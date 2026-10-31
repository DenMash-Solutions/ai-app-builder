# Usernames and Public UI Profiles

**Status:** draft
**Date:** 2026-10-31

## Goal

Give every user a unique username and a public profile route that lists only
their published UIs.

## Scope

### In scope

- `profiles.username`: lowercase, matches `SLUG_PATTERN`, unique index,
  never a reserved segment, required at signup for new users
- Existing-user claim flow: prompt until claimed, no silent auto-claim
- Availability endpoint (usability only — the DB constraint is the truth)
- Route `app/[locale]/user/[username]/ui` listing only that owner's
  `published_pages` rows (drafts and local entries never appear)
- `user` added to **both** `RESERVED_SLUGS` (`lib/slug.ts`) and
  `APP_SEGMENTS` (`lib/i18n/routing.ts`) — `proxy.ts` uses `APP_SEGMENTS`
  for content-path pass-through and the app-locale 404 guard, so updating
  one without the other misroutes
- Minimal public read of profiles (id + username columns only); other
  profile columns stay private
- en/es copy for the claim UI and profile page

### Out of scope

- Project handles (069), avatars/bios, social features, following

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

## Files

`db/` migration (unique index + check), `db/03_rls.sql`, signup/login
components, new `app/[locale]/user/[username]/ui/`, `lib/slug.ts`,
`lib/i18n/routing.ts`, `proxy.ts` (verify, change only if required),
availability endpoint, en/es keys.

## Tasks

### 1. Schema and reserved segments (db/)

- [ ] Migration: `profiles.username` lowercase, unique index, check against
      `SLUG_PATTERN`, never a reserved segment; existing-user backfill
      strategy = prompt until claimed, no silent auto-claim (decision 1)
- [ ] `user` added to BOTH `RESERVED_SLUGS` (`lib/slug.ts`) and
      `APP_SEGMENTS` (`lib/i18n/routing.ts`) — updating one without the
      other misroutes `proxy.ts`
- [ ] RLS: minimal public read of profiles (id + username columns only)

### 2. Claim flow

- [ ] Signup requires a username for new users (signup component)
- [ ] Existing users are prompted until they claim (login/app surface)
- [ ] Availability endpoint — advisory only, the DB constraint is the truth
      (decision 3)
- [ ] en/es copy for the claim UI and the profile page

### 3. Public profile route

- [ ] `app/[locale]/user/[username]/ui/` lists only that owner's
      `published_pages` rows — drafts and local entries never render
- [ ] Unknown username 404s; no editor-only data in the payload

### 4. Tests

- [ ] Unit: normalization, reserved rejection, pattern enforcement
- [ ] e2e: duplicate claim rejected server-side; profile lists only
      published UIs and 404s on drafts; deep-link regressions for existing
      app segments plus the new `/user/...` cases
- [ ] Proxy spot-check: bare, two-segment and three-segment paths still
      resolve; full gate

## Verification

- [ ] `bun run format && bun run lint && bunx tsc --noEmit && bun run test`
- [ ] Unit: normalization, reserved rejection, pattern enforcement
- [ ] e2e: duplicate claim rejected server-side; public profile lists only
      published UIs and 404s on drafts; deep-link regression for existing
      app segments plus new `/user/...` cases
- [ ] Proxy spot-check: bare, two-segment and three-segment paths still
      resolve (content path, app path, profile route); full gate

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-31 | plan drafted |
