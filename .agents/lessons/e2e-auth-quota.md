# Marathon E2E Runs Burn the Supabase Anon-Signup Quota (429)

> **Lesson source**: plan 056 verification (2026-10-26) — runs 12–18 of a full-suite marathon
> went red with "Todos are unavailable" in the data-sources tests; Supabase `auth_logs` showed
> **35 × HTTP 429 on `/signup`** exactly overlapping the red window (21:47–21:53 UTC), with 200s
> resuming afterwards as the budget recovered.

## Problem Description

- The app establishes a visitor session via `supabase.auth.signInAnonymously()`
  (`lib/data-sources/supabase-adapter.ts`) — **every fresh browser context = one anonymous signup**
- Full-suite Playwright runs × many repetitions burn Supabase's anonymous-signup rate-limit
  budget → `/signup` returns **429** → the adapter's error branch throws
  `DataError(unavailable, "Could not establish a visitor session…")` → rendered as
  **"Todos are unavailable"**
- The failure looks like an app/data bug (RLS, schema, adapter logic) but is **external
  infrastructure rate limiting** — it self-recovers when the window passes
- Reproduced nondeterministically: the same test passes in isolation moments later, which is
  the signature of a quota/state issue rather than a code defect

## Solution Steps

1. **Check the quota first**: query Supabase `logs` (`source = 'auth_logs'`) for status 429
   on `/signup` in the red run's time window — via MCP `query_logs` or the dashboard
2. **Confirm the window alignment**: 429 timestamps overlapping the failing runs + 200s
   resuming after = quota burn, not app code
3. **Verify the code path**: 429 → `signInAnonymously` error → `DataError(unavailable)` →
   the exact test message you're seeing
4. **Recovery**: wait out the window, then re-run the specific test in isolation to confirm
   green before touching any code

## Prevention Strategies

- Marathon loops of `npx playwright test` (many full runs back-to-back) are the main quota
  burner — budget repetitions or space them out
- When data-sources e2e tests fail with "unavailable" errors: **`auth_logs` 429 probe before
  any debugging** of the adapter, RLS, or schema
- Don't record a "fix" for a failure you never proved was code-caused

## Memory Triggers

- Data-source tests fail with "…are unavailable" → grep `auth_logs` for 429 first
- Failures started mid-marathon run loop (not after a code change) → suspect external quota
- Same test red in a batch, green in isolation → state/quota/race, not logic
