# E2E Hardening — DB Fixture Seed & Authenticated Suites — Implementation Plan

**Status:** implemented
**Date:** 2026-10-12 · architecture locked 2026-10-14 · implemented 2026-10-14

## Goal

Remove the two portability gaps in the test suite. First: the root tests assert the featured landing, which only holds because *this* database happens to have it featured — a fresh or reset DB breaks the suite deep in assertions. Second: the authenticated half of the product (sync, publish, admin) is verified only by hand; bring it into Playwright with a stored login state.

## Context

- 78 anonymous e2e tests; `e2e/global-setup.ts` is the natural extension point.
- Sign-out UI landed in `app-shell` — its e2e test lands here (dependency resolved).
- Credentials never live in the repo: env-driven, suites skip cleanly when absent.
- **Node 22+ required** *(2026-10-14)* — the seeded suite's service client runs `@supabase/supabase-js` in Node, which needs the native `WebSocket` (Node 22+); on Node 20 the setup fails fast with the library's upgrade message. nvm default set to 24 on the dev machine; CI must run Node 22+.
- **Dedicated e2e identities provisioned 2026-10-14** — never a personal session:

  | Account | Role | Purpose |
  | ------- | ---- | ------- |
  | `admin@e2e.com` | admin | authed-suite storage state (promoted to `admin` on 2026-10-14) |
  | `user@e2e.com` | user | non-admin `/admin` denial — **un-deferred** (second identity now exists) |
  | `anon@e2e.com` | user | fixture data owner — owns the seeded landing rows only |

## Scope

### In scope

1. **Fixture seed in global-setup** — service role; idempotently ensure the fixture rows exist (`uis` + `published_pages` owned by the fixture identity) and **fill an absent** featured pointer. State matrix below. Optional `SUPABASE_SERVICE_ROLE_KEY`: absent → loud warning + skip (suite runs against the DB as-is); present but failing → **fail fast** with a clear message instead of mid-suite assertion noise.
2. **Featured-pointer safeguards** (the highest-risk mutation): capture the original before the admin test touches it → restore in `finally` → global teardown as second line → persisted recovery record in `e2e/.state/` (survives crashes, consumed by the next setup) → run lock refuses concurrent mutating runs.
3. **Authenticated storage states** — one-time **real UI login** in global-setup from `E2E_ADMIN_*` / `E2E_USER_*` (optional), saved to gitignored `e2e/.state/{admin,user}.json` (not `test-results/` — Playwright cleans its output dir between runs). Unset creds → suite skips with message; set-but-invalid → fail fast.
4. **`authed.spec.ts` + `signout.spec.ts`** — sync roundtrip (push dot + fresh-context pull), publish journey (unique slug → availability → Live badge → live URL renders → offline), admin feature/unfeature + root switch, non-admin `/admin` denial; sign-out lives in its own chained project (decision 13).
5. **Leftover sweep** — setup deletes `uis` rows owned by the e2e admin whose `prompt` carries the `E2E ` marker prefix (crash leftovers). Identity + marker scoped; the personal account is never touched.
6. **Docs** — `.env.example` entries (names, no values); `.gitignore` gains `e2e/.state/`.

### Out of scope

- CI pipeline wiring (secrets provisioning on a runner) — the suite must *work* in CI; provisioning is a deploy-plan concern (2026-10-12)
- Dedicated Supabase branch / disposable project — **Phase 2 trigger** (decided 2026-10-14): tests run in CI, a second contributor arrives, or the shared DB holds data whose accidental modification would be costly (2026-10-14)
- Seeding other fixtures (clinic page etc.) — only what tests assert (2026-10-12)

## Design decisions

1. **Seed via service-role key, optional** — rejected: seeding through the app's anon/authenticated clients (RLS correctly forbids it; tests shouldn't need a backdoor user), hard-requiring the key (breaks contributors without it).
2. **Login through the real UI, not the Admin API** — rejected: creating sessions via API (tests the wrong surface; the login form is the product).
3. **Skip-with-warning over hard failure for absent env** — rejected: unconditional authed suites (the anonymous suite must stay runnable anywhere with zero secrets).
4. **Fixture is a committed JSON in `e2e/fixtures/`** — rejected: inline strings (keeps the seed reviewable and reusable for local debugging).
5. **Real dev DB accepted, with safeguards** *(2026-10-14)* — rejected for now: disposable branch/project (Phase 2, trigger above). Safeguards: capture → `finally` → teardown → persisted recovery record → preflight lock.
6. **Fixture owner = dedicated identity, separate from login accounts** *(2026-10-14)* — `anon@e2e.com` owns seed rows; `admin`/`user` only authenticate; the service role provisions and cleans up outside the browser. Application roles live in `public.profiles` and were set explicitly (admin promoted by hand).
7. **Deterministic fixture contract + independent literal** *(2026-10-14)* — the fixture headline ("Describe it. See it. Perfect it.") and the assertion `UI.landingTitle` are written independently: copy drift then fails loudly instead of setup and assertion passing in lockstep. A separate product smoke asserts the real DenMash live page's copy.
8. **Project dependencies order the suites** *(2026-10-14)* — `chromium` (anonymous, read-only, featured-dependent) fully completes before `authed` (state-mutating). Iteration shortcut: `bun run test:e2e -- --project=authed --no-deps`.
9. **Dedicated identities, records by marker — never by count** *(2026-10-14)* — unique per-test prompts located by text (never list position or totals); cleanup touches only test-created records, UI first with a service-role safety net.
10. **Centralized env loading** *(2026-10-14)* — `e2e/env.ts` parses `.env.local` once without overriding explicitly provided env vars; each suite validates its own prerequisites: absent → skip, set-but-invalid → fail fast. Secrets stay server-side (Node only, never the browser bundle).
11. **Seed state matrix** *(2026-10-14)* — never treat a dangling pointer as evidence the fixture is needed; validate the actual referenced record and distinguish absent fixture / dangling pointer / unrelated featured page (below).
12. **Admin feature test requires the service key** *(2026-10-14)* — skipped with a message otherwise: restore capability is mandatory before mutating the singleton.
13. **Sign-out test follows the product's post-sign-out routing** *(2026-10-14)* — `handleSignOut` ends the session and `router.push("/")`, where a featured root renders chrome-less (no shell to assert against). The test waits for the root navigation (also documenting it as contract), then `goto`s the playground to assert session-gone + local-history-intact deterministically. The original in-place assertion only passed by racing the navigation. A "mystery" `alert:` in a failure snapshot turned out to be Next's route announcer echoing the featured page title — no app bug.

## Seed state matrix

| `site_settings` state | Action |
| --------------------- | ------ |
| no row, or `featured_ui_id = null` | ensure fixture rows → point the pointer at the fixture |
| points at the fixture | nothing — already seeded |
| points at an unrelated page (e.g. denmash) | **leave untouched** — root tests assert the landing contract against whatever is legitimately featured |
| points at a missing row (dangling) | warn loudly, no write (`on delete set null` makes this unreachable under FK integrity) |

## Files

`e2e/env.ts` · `e2e/db.ts` · `e2e/fixtures/landing-fixture.json` · `e2e/global-setup.ts` · `e2e/global-teardown.ts` · `e2e/authed.spec.ts` · `e2e/signout.spec.ts` · `e2e/authed-helpers.ts` · `e2e/constants.ts` · `e2e/live-pages.spec.ts` (DenMash smoke) · `playwright.config.ts` · `.env.example` · `.gitignore`

## Verification

- [x] `bun run test:e2e` on the **current** DB (featured = denmash): green, pointer untouched afterwards
- [x] `bun run test:e2e` against a DB with `featured_ui_id = null`: seed fills it, suite green
- [x] Unset `E2E_*`: authed suites skip with message; anonymous suite unaffected
- [x] Unset `SUPABASE_SERVICE_ROLE_KEY`: seed skipped with warning; admin feature test skipped
- [x] Set-but-invalid `E2E_ADMIN_*`: setup fails fast with a clear message
- [x] With everything set: `authed.spec.ts` green; featured pointer restored after the run (recovery record consumed, lock released)
- [x] No secrets in repo: `git status` clean of `.env*`, `e2e/.state/` gitignored
- [x] Full gate green: format, lint, tsc, unit, build, e2e

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-12 | plan drafted |
| 2026-10-14 | architecture locked: real-DB safeguards, dedicated identities, project ordering, seed matrix; three e2e accounts provisioned (`admin@e2e.com` promoted to role `admin`); non-admin `/admin` denial un-deferred |
| 2026-10-14 | implemented: seed + storage states + `authed.spec.ts` (roundtrip, publish journey, admin feature/unfeature, non-admin denial) + `signout.spec.ts` + DenMash product smoke; full run 84 passed / 0 skipped on the seeded DB. Verified: null pointer → seed fills, denmash untouched, creds-unset skips, invalid creds fail fast, recovery record consumed, lock released. Post-implementation fixes: teardown sweep (parallel tests share one account, so a sibling context's full-state push can re-upload a just-deleted row — swept after all contexts close), recovery record consumed only after a successful restore write, sign-out test rewritten per decision 13, Node 22+ required (nvm default → 24) |
