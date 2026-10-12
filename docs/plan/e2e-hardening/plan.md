# E2E Hardening — DB Fixture Seed & Authenticated Suites — Implementation Plan

**Status:** draft
**Date:** 2026-10-12

## Goal

Remove the two portability gaps in the test suite. First: the root tests assert the featured landing, which only holds because *this* database happens to have it featured — a fresh or reset DB breaks the suite deep in assertions. Second: the authenticated half of the product (sync, publish, admin) is verified only by hand via MCP; bring it into Playwright with a stored login state.

## Context

- 70 e2e tests, all anonymous; `e2e/global-setup.ts` exists and is the natural extension point.
- `spec-languages` (in progress) adds `?`-free per-language artifacts and more root-content assertions — seeding becomes more valuable.
- Sign-out UI lands in the `app-shell` plan; its e2e test lands here (dependency noted).
- Credentials never live in the repo: env-driven, suite skips cleanly when absent.

## Scope

### In scope

1. **Fixture seed in global-setup** — ensure `site_settings.featured_ui_id` points at a minimal seeded landing (`uis` + `published_pages` fixture + featured pointer). Idempotent; requires `SUPABASE_SERVICE_ROLE_KEY` (optional env); **absent → loud warning + skip seeding** (suite still passes on a DB that already has the state), malformed/unreachable → fail fast with a clear message instead of mid-suite assertion noise.
2. **Authenticated storageState** — one-time UI login in global-setup from `E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD` (optional env), saved to gitignored `test-results/.auth/admin.json`; unset creds → authed tests skip with a message.
3. **`authed.spec.ts`** — sync roundtrip (generate → reload → entry present, "Saved to account" dot), publish journey (go live → availability → Live badge → live URL renders), admin feature/unfeature (+ root switch verified), sign-out (needs `app-shell`: session gone, dot reverts, history intact), `/admin` denial for non-admin (deferred: needs a second test user — see out of scope).
4. **Docs** — `.env.example` gains the optional `E2E_*` / `SUPABASE_SERVICE_ROLE_KEY` entries (documented, no values).

### Out of scope

- Non-admin (second-user) authed state — one admin state in v1; revisit when a user-management story exists (2026-10-12)
- CI pipeline wiring (secrets provisioning on a runner) — the suite must *work* in CI; provisioning itself is a deploy-plan concern (2026-10-12)
- Seeding other fixtures (clinic page etc.) — only what tests assert (2026-10-12)

## Design decisions

1. **Seed via service-role key, optional** — rejected: seeding through the app's anon/authenticated clients (RLS correctly forbids it; tests shouldn't need a backdoor user), hard-requiring the key (would break contributors without it).
2. **Login through the real UI, not the Admin API** — rejected: creating sessions via API (tests the wrong surface; the login form is the product).
3. **Skip-with-warning over hard failure for absent env** — rejected: unconditional authed suites (the anonymous 70 must stay runnable anywhere with zero secrets).
4. **Fixture is a committed JSON in `e2e/fixtures/`** — rejected: inline strings (keeps the seed reviewable and reusable for local debugging).

## Verification

- [ ] `bun run test:e2e` on the **current** DB (featured set): unchanged green
- [ ] `bun run test:e2e` against a DB with `featured_ui_id = null`: seed kicks in, suite green
- [ ] Unset `E2E_ADMIN_*`: authed tests skip with message; anonymous suite unaffected
- [ ] With creds: `authed.spec.ts` green; sign-out test green once `app-shell` has landed
- [ ] No secrets in repo: `git status` clean of `.env*`, `.auth/` gitignored

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-12 | plan drafted |
