# Dev-Server Cache Poisoning & E2E Failure Triage

Hard-won diagnostics from the M3 verification run (2026-10-19) and plan 065
Task 5 (2026-11-02): a build run corrupted the dev server's cache, e2e
failures pointed at an innocent database, and three more failures turned out
to be Next.js navigation/metadata behavior, not app code.

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

## 5. Server-side I/O ground truth = Supabase `query_logs`

Server-side fetches (the Next server client) never appear in the browser's
network log — to prove a query shape or a cache actually worked, query the
unified logs (`query_logs` on the project) and count rows after a marker
timestamp:

- **ClickHouse literals**: `timestamp >= '…T…Z'` fails with `TYPE_MISMATCH`
  (DateTime64) — use `toDateTime64('YYYY-MM-DD HH:MM:SS', 3)`; the
  `iso_timestamp_start` parameter scopes the window, the SQL scopes the filter.
- **Schema**: there is no `message` column; request details live in the
  `log_attributes` map — `log_attributes['request.path']`,
  `log_attributes['request.url']`, `log_attributes['response.status_code']`.
  Useful `source` values: `edge_logs` (PostgREST/Auth HTTP), `postgres_logs`,
  `pgbouncer_logs`.
- **Cache proof pattern**: take a wall-clock marker → load the page twice →
  `count()` rows for the table's path after the marker → **1 row for 2 loads**
  = the fetch-tag cache held. Re-query after a short delay before believing a
  count of 0/1 (ingestion lag).
- This is how "slim select" claims get verified too: read the actual
  `request.url` (`select=id,owner_id,updated_at` vs `select=*`) instead of
  trusting the code you wrote.

## 6. Opening a Radix portal during a PENDING Next navigation → it never mounts (plan 065)

**Symptom:** dialog state `open=true` flips and stays true, the whole fiber
path commits (`DialogRoot → DialogContent → DialogPortal →
Presence(present:true)`), but ZERO host DOM enters the document
(`[data-slot="dialog-content"]` absent, `[data-radix-portal]` count 0). No
`pageerror`, no console errors, and it **never self-heals** (polled 10s,
dead the whole time). Sibling symptom: a trigger resolves visible then goes
0×0 mid-click (the History-button flake).

**Root cause (proven):** generate triggers a route navigation
(`/en/ui` → `/en/ui/{uuid}`). Opening the drawer/dialog while that App
Router transition is still in flight **defers the new subtree's layout
effects** — Radix Presence's layout effect (which dispatches `MOUNT`) never
runs, so its reducer stays `"unmounted"` and it renders `null`. The instant
the URL settles the portal mounts (~500ms).

**Diagnosis signature (fiber dump):** Presence fiber `present:true` but
`hasChild:false`, hook linked list `[null, obj, obj, obj, obj, "unmounted", …]`
(hooks[5] = the `useReducer` state), `prevPresentRef.current === false`,
`lanes: 0`. Reading it: `present:true` + ref `false` = the layout effect
never ran for the flip (this lesson); ref `true` = effect ran and the
dispatch was lost (a different, worse bug — don't assume which without the
dump).

**Fix (test-side):** wait for the navigation before touching any portal —
`await expect(page).toHaveURL(/\/ui\/[0-9a-f-]{36}$/)` after generate. The
History-button 0×0 flake was the **same** root cause: the URL wait alone
made it green; no retry helper was needed.

## 7. Next's streaming-metadata `<div hidden>` cascades `display:none` onto open portals

**Symptom:** a Radix popper/drawer wrapper reads `data-state="open"` with a
normal rect, then ~400ms later gets inline `display: none !important`
appended **by React itself** → 0×0 for the rest of the test ("element is
not visible" forever). Stack:
`CSSStyleDeclaration.setProperty ← hideInstance ←
hideOrUnhideAllChildrenOnFiber ← hideOrUnhideNearestPortals`.

**Root cause:** Next's streaming metadata renders `MetadataWrapper` as a
bare `<div hidden>`; when it mounts, React's hidden-attr cascade
recursively hides its subtree **and the nearest portals inside it** —
including open Radix portals that were portaled into `<body>`.

**Fix (e2e-only, shipped with plan 065):** `next.config.ts` sets
`htmlLimitedBots: /.*/` gated on `process.env.PLAYWRIGHT_TEST === "true"`
(it REPLACES Next's default bot list → no streaming metadata → no wrapper);
`playwright.config.ts` webServer sets `PLAYWRIGHT_TEST=true`. Production
keeps the default bot list + streaming metadata.

**Gotchas:**
- A `next.config.ts` change needs a **server restart** — Playwright's
  `reuseExistingServer: true` happily reuses a server started BEFORE the
  fix. Kill port 3000 first, or you'll "verify" against the old config.
- Never `bun run build` while `next dev` serves the same `.next` (section 1).

## 8. Element ABSENT while its siblings render → walk the root pointer, distrust helpers with side effects

**Symptom (plan 065 fixture):** the heading renders, the sibling "Go to B"
button does not exist anywhere in the DOM — count 0, not hidden — while the
spec line that adds it applied without error.

**Root cause:** the fixture spread `headingLines("a-heading", …)` — a helper
whose FIRST line re-points `PATCH_PATH.root` at its key. Root ended as
`"a-heading"`, so the stack (the real root) and everything reachable only
through it (the nav button) were **orphans**: rendering follows root, and
orphans simply don't exist.

**Rule:**
- Missing element, siblings fine → verify the ancestor chain from root
  before suspecting the renderer; helpers that WRITE shared pointers
  (root, active project, current id) are dangerous when spread into a
  sequence that already set the same pointer.
- Triage order: `querySelector` count 0 = orphaned/unrendered (spec/root
  problem) vs count > 0 + 0×0 = visibility/timing problem (sections 6 and 7).

## 9. A multi-row push is ONE statement: one refused row strands the whole batch (plan 066)

Symptom: a data-heavy suite green serially, **3/10 failing in parallel**; the
expected row never reached the DB, and the sync engine's retries (5 tries,
~31s backoff) never helped. The row was being pushed, not skipped.

Capture `request().postData()` on every 4xx — that is what identified it:

```
403 catalog_installs   rows=6  ids=c9e83b95,c6ebec44,41d26db2,...
403 project_screens    rows=12 ids=c1d3c32d,917e43d7,35314bc7,...
```

- A multi-row `upsert` is **one SQL statement**. With a shared account, each
  context's local store accumulates rows written by every concurrent test, so
  a push carries other sessions' rows too.
- One row whose parent is not remote yet is refused — `42501` from a
  `WITH CHECK` that requires the parent to exist (`exists (select 1 from uis
  ...)`), or `23503` on the FK — and the refusal aborts the **entire**
  statement. Every healthy row in that batch is stranded, including the row
  the test is waiting for.
- Retrying is useless: the retry re-sends the same poisoned batch. Per-test
  fixes (longer waits, serial workers) only hide it.

Fix shape (`lib/history/sync.ts`): on a refused batch, retry **row by row** so
a doomed row can only strand itself, keep the "still refused" answer so the
offline/retry state survives, and never let a rejected task poison the task
chain (`chain.then(task).catch(...)` — an unhandled rejection silently skips
every later push while the UI still looks alive). Postgres gives no indication
*which* row failed, so the row-by-row probe is what localizes it.

Related triggers: rows "missing after Ns" in one suite only under parallel
workers; a batch payload carrying ids from several tests; `42501`/`23503`
that survive every retry.

## Memory triggers

- e2e failures started right after a build/restart → suspect `.next` cache
  first (`rm -rf .next`), not DB or app code
- Parser error in the log but `tsc`/`grep` green → stale cache replay; verify
  disk bytes before editing
- `42501` with healthy-token probes → race with the parent row; gate on the DB
- Status-dot assertion flaky or timing out → debounce + data-volume slowness;
  poll the database, budget generously
- Trace span looks impossible → timestamps are ms
- Need to prove a server-side query/cache behavior → Supabase `query_logs`
  (`toDateTime64` literals, `log_attributes['request.path']`), not the
  browser network panel
- Log count looks wrong → wait and re-query (ingestion lag) before theorizing
- Dialog/popover `open=true` but DOM never mounts (or a trigger goes 0×0
  mid-click) → pending App Router transition defers layout effects → await
  the destination URL first (section 6)
- Portal resolves visible, then React itself stamps `display:none !important`
  → `MetadataWrapper` hidden-div cascade → `htmlLimitedBots` under
  `PLAYWRIGHT_TEST` (section 7)
- Element absent (count 0) while siblings render → root pointer / helper
  side effect (section 8)
- A row "missing after Ns" in ONE suite, green serially, failing with parallel
  workers → the push batch is atomic and another row poisons it (section 9)
- `42501`/`23503` on writes that survive EVERY retry → per-row retry localizes
  the doomed row; do not just raise timeouts (section 9)
- Changing `next.config.ts` but behavior unchanged → is the running server
  older than the config? (`reuseExistingServer` reuses stale servers)
