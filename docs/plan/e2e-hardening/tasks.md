# E2E Hardening — Tasks

Plan: `docs/plan/e2e-hardening/plan.md` (Status: draft — awaiting approval)

Legend: `[ ]` pending · `[~]` in progress · `[x]` done

Dependency: sign-out test (5.4) waits for `app-shell`; everything else independent.

## Phase 1 — Fixture seed

- [ ] 1.1 `e2e/fixtures/landing-fixture.json` (minimal published landing) + seed helper using `SUPABASE_SERVICE_ROLE_KEY` (optional env)
- [ ] 1.2 Wire into `global-setup.ts`: idempotent ensure (fixture published + featured); absent key → warn + skip; unreachable/malformed → fail fast with clear message
- [ ] 1.3 Verify: suite green on current DB and on a DB with `featured_ui_id = null`

## Phase 2 — Authenticated state

- [ ] 2.1 Global-setup login flow (real UI) from `E2E_ADMIN_EMAIL/PASSWORD`; storageState → gitignored `test-results/.auth/`; skip-with-message when unset
- [ ] 2.2 `.env.example` documents optional `E2E_ADMIN_*` + `SUPABASE_SERVICE_ROLE_KEY` (no values)

## Phase 3 — Authenticated tests (`e2e/authed.spec.ts`)

- [ ] 3.1 Sync roundtrip: generate → reload → entry persisted, dot reads "Saved to account"
- [ ] 3.2 Publish journey: Go live → slug available → Live badge → live URL renders
- [ ] 3.3 Admin: feature/unfeature + root reflects the featured page
- [ ] 3.4 Sign-out (after `app-shell`): session gone, dot reverts, local history intact, `/admin` bounces

## Phase 4 — Close

- [ ] 4.1 Full gate incl. `test:e2e`; plan → implemented
