# Dev-Server Cache Poisoning & E2E Failure Triage

Three hard-won diagnostics from the M3 verification run (2026-10-19): a build
run corrupted the dev server's cache, and the resulting e2e failures pointed
at the database — where nothing was wrong.

## 1. Never `next build` while `next dev` serves the same `.next`

**Symptom:** after running `bun run build` with a dev server still up, three
authed e2e tests started failing (`Could to publish` 42501, a status dot stuck
at "Syncing"), and the dev log replayed `Unknown regular expression flags`
parse errors — **for a file that was valid on disk** (tsc green, `grep` showed
the correct bytes). Restarting the server did NOT clear it: Turbopack's
**persistent cache in `.next/cache` survives restarts** and keeps replaying the
bad compile (including mangled source variants like `ahpst` that exist nowhere
in the file).

**Rule:**

- A production build and a dev server must not share `.next` — stop the dev
  server first, or accept wiping the cache after.
- **Disk bytes are ground truth.** Before editing a file a parser blames, run
  `grep`/`tsc --noEmit` on it — a stale cache replays history, it doesn't
  describe the present.
- Recovery: `pkill` the dev server → `rm -rf .next` → restart → probe one
  route (an empty `POST` returning `400` = compiled clean; a `500` with a
  parse error in the log = still broken).

## 2. 42501 / write failures: probe REST before doubting policy or code

**Symptom:** publish failed with RLS `42501` while the client reported
healthy auth. Suspicions ran through tokens → DB → policies before the data
said otherwise.

**Probe matrix (one script, service role + the actual token):**

| Probe                          | Expected if policy healthy |
| ------------------------------ | -------------------------- |
| old token + owned row insert   | `201`                      |
| fresh password-grant + owned   | `201` (identical)          |
| any token + **orphan** `ui_id` | `42501` (F2 `WITH CHECK`)  |

Old and new tokens identical ⇒ tokens/policy/DB exonerated; the only
remaining variable is **what the app sent and when** — here: the `uis` row
didn't exist yet because sync hadn't finished. `42501` on a child insert with
healthy probes almost always means a **race with the parent row**, not a
misconfigured policy.

## 3. Gate async work on the database, not on UI status text

The client's sync dot runs through a debounced engine whose cost **scales with
data volume**: every `pull()`/`push()` does `uis?select=*`, an admin's SELECT
sees *every* row (F7), and test rows accumulate each run (92 rows → a ~7s
cycle) — past the test's 5s assertion budget. The dot said "Syncing" at
assertion time while every request was succeeding (trace: all `201/200`).

- Status dots/labels are **racy gates** — assert the durable fact instead:
  a service-role poll (`waitForRemoteRow`) before anything that writes
  `page_versions`.
- Timeout budgets for engine-driven UI states must scale with the work's
  inputs (row count, payload size), not just "the happy path once".

## 4. Trace timestamps are milliseconds (system monotonic)

A computed "6867s span" inside a 70-second run is not a hang — it's a unit
error. Playwright trace `_monotonicTime` is in **ms**; sanity-check any
derived span against the run's wall-clock before theorizing.

## Memory triggers

- e2e failures started right after a build/restart → suspect `.next` cache
  first (`rm -rf .next`), not DB or app code
- Parser error in the log but `tsc`/`grep` green → stale cache replay; verify
  disk bytes before editing
- `42501` with healthy-token probes → race with the parent row; gate on the DB
- Status-dot assertion flaky or timing out → debounce + data-volume slowness;
  poll the database, budget generously
- Trace span looks impossible → timestamps are ms
