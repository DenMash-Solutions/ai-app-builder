# External Writers Must Honor the Tag-Invalidation Contract

> **Lesson source**: plan 056 flake campaign (2026-10-26) — ~40% of full e2e runs failed
> the same 4 `/en` tests with a valid URL serving playground content. Root cause: the test
> harness restored the featured pointer by writing straight to REST **without invalidating**
> the `site_settings` cache tag, so the next run hit the plan-055-C share-cache's stale
> `{"featured_ui_id":null}` for up to the 60s TTL.

## Problem Description

- The app's caching layers (share-cache / `unstable_cache` / `revalidateTag`) assume **every
  writer invalidates its tag** — app code does this (`/api/revalidate` poke or `revalidateTag`)
- Any writer that bypasses the app path (test harness, migration script, one-off admin script,
  direct Supabase/REST/DB write) silently leaves stale reads behind:
  - A failed/absent read is indistinguishable from "value is null" — stale `null` reads like
    "nothing is featured"
  - The symptom appears **in the next run**, detached from the write that caused it, so it
    looks like random flakiness rather than a caching bug
- The error was previously **swallowed** (`featured.ts` ignored read errors), which made the
  stale read masquerade as a legitimate "not featured" state

## Solution Steps

1. **Contract**: every writer to a share-cached table must invalidate its tags after writing
   — in `e2e/db.ts` that is a `POST /api/revalidate {"tags":["…"]}` poke after each write
2. **Error visibility**: cached reads must log failures (`console.error`) instead of
   swallowing them — but keep the *legitimate* null case (nothing featured) silent, or the
   log drowns in noise
3. **Evidence pattern that proves a stale hit**: temporary read instrumentation showing
   `settingsErr=none, featured_ui_id:null` **with zero underlying REST calls** = cache served
   the value, no fetch happened

## Prevention Strategies

- When adding a new cached read, grep for *all* writers of that table — including harnesses
  and scripts outside `app/`
- New harness write helper? → poke the matching tag in the same helper, next to the write
- Intermittent e2e failure at a valid URL → suspect the share-cache before the renderer

## Memory Triggers

- E2E fails at a URL that usually works → did a *harness* write bypass tag invalidation?
- "Not X" state appearing intermittently → is a swallowed read error hiding a stale cache hit?
- Adding a write in `e2e/` or `scripts/` to a cached table → invalidate the tag in the same function
