# E2E Hardening — Tasks

Plan: `docs/plan/e2e-hardening/plan.md` (Status: implemented)

Legend: `[ ]` pending · `[~]` in progress · `[x]` done

Dependency: sign-out test (3.4) waits for `app-shell`; everything else independent.

## Phase 1 — Fixture seed

- [x] 1.1 `e2e/fixtures/landing-fixture.json` (minimal published landing) + seed helper using `SUPABASE_SERVICE_ROLE_KEY` (optional env)
- [x] 1.2 Wire into `global-setup.ts`: idempotent ensure (fixture published + featured per the state matrix); absent key → warn + skip; present-but-failing → fail fast with clear message
- [x] 1.3 Verify: suite green on current DB (denmash untouched) and on a DB with `featured_ui_id = null` (seed fills it)

## Phase 2 — Authenticated state

- [x] 2.1 Global-setup login flow (real UI) from `E2E_ADMIN_*` (+ optional `E2E_USER_*`); storageState → gitignored `e2e/.state/` (not `test-results/` — Playwright cleans its output dir); skip-with-message when unset, fail-fast when invalid
- [x] 2.2 `.env.example` documents optional `E2E_ADMIN_*` / `E2E_USER_*` / `E2E_FIXTURE_EMAIL` + `SUPABASE_SERVICE_ROLE_KEY` (no values)

## Phase 3 — Authenticated tests

- [x] 3.1 Sync roundtrip (`e2e/authed.spec.ts`): generate → dot reads "Saved to account" → fresh context pulls the entry
- [x] 3.2 Publish journey: Go live → slug available → Live badge → live URL renders → taken offline
- [x] 3.3 Admin: feature/unfeature + root reflects the featured page (requires service key; capture → finally → teardown → recovery record)
- [x] 3.4 Sign-out (`e2e/signout.spec.ts`, own chained project — global `signOut()` revokes the shared session): post-sign-out routing asserted, then session gone + local history intact (plan decision 13); non-admin `/admin` denial via `user@e2e.com` (un-deferred)

## Phase 4 — Close

- [x] 4.1 Full gate incl. `test:e2e` (84 passed / 0 skipped on the seeded DB); plan → implemented
