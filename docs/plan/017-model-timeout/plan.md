# Model Timeout (Hang Handling) — Implementation Plan

**Status:** implemented
**Date:** 2026-10-08

## Goal

When the upstream model never responds (request hangs with no bytes and no error), the playground currently spins forever: the prompt input stays disabled, no dialog or toast ever appears, and the only escape is a page reload (observed live 2026-10-08: `POST /api/generate` pending 7+ minutes on `gemini-3.8-flash` under `next dev`). The existing `unavailable-service-handling` feature classified error-bearing failures (empty completion, upstream 5xx, fetch failure) but a hang reaches none of those seams; `maxDuration = 60` is a Vercel-only limit and does nothing in local dev. Add a server-side deadline so a dead upstream surfaces within ~30 seconds as the existing classified `503 service_unavailable` response — reusing the existing failure dialog and switch-and-retry flow with zero client changes.

## Scope

### In scope

- **New helper** `lib/playground/deadline.ts` (kept in `lib/` so `bun test lib` picks up its tests; beside route-helper precedent `patch-text.ts`):
  - `withDeadline(promise, ms, onTimeout)` — races a promise against a timer; always attaches handlers to the source promise (no unhandled rejection after timeout wins); `onTimeout` aborts the upstream `AbortController` and returns the error
  - `StreamTimeoutError` — message `Service unavailable: {model} timed out waiting for a response — switch model and retry.` (matches `SERVICE_UNAVAILABLE_PATTERN`)
  - constants `FIRST_CHUNK_TIMEOUT_MS = 30_000`, `IDLE_TIMEOUT_MS = 30_000`
- **Route wiring** (`app/api/generate/route.ts`):
  - pass `abortSignal` from one `AbortController` per request to both `streamText` calls (initial + edit-retry) so timeouts free the upstream connection
  - first-chunk wait (edit collect + generate) raced against `FIRST_CHUNK_TIMEOUT_MS` → `503 { error, code: "service_unavailable" }`
  - per-chunk idle deadline (`IDLE_TIMEOUT_MS`, reset on every chunk) in the edit drain loop and the generate `ReadableStream` loop
  - generate mid-stream stall (200 already committed): `controller.error(timeout)` — client read fails → existing network-error patterns classify → dialog (residual: generic toast if the browser's error text misses the pattern; never a hang)
- **Unit tests** `lib/playground/deadline.test.ts`: resolves when the promise wins; rejects with the source error when the source loses the race; rejects with the timeout error when the timer wins; late settlement after timeout never becomes an unhandled rejection; `StreamTimeoutError.message` matches `SERVICE_UNAVAILABLE_PATTERN`

### Out of scope

- Client-side watchdog inside `useUIStream` — descoped 2026-10-06 (external `@json-render/react` hook); server deadline covers every path (descoped 2026-10-08)
- Re-classification of mid-stream 200-committed failures beyond the existing pattern match (toast fallback acceptable) (descoped 2026-10-08)
- i18n of server error strings — server messages are English-only by existing precedent (`route.ts` 503s) (descoped 2026-10-08)
- Changing the failure-dialog copy for the no-op steer guard (`service.noChanges` unused) — separate Option B, not requested (descoped 2026-10-08)

## Design decisions

1. Server-side deadline as the single mechanism — rejected: client-side watchdog (fetch abort from `page.tsx`), because the upstream hook owns the request (descoped) and a server deadline also frees server/upstream resources and produces the classified 503 the client already understands.
2. Message `Service unavailable: … timed out …` so `SERVICE_UNAVAILABLE_PATTERN` routes it to the existing dialog with zero client changes — rejected: new error `code` + client mapping, because message-pattern classification is the established precedent (quota + atomic-patch-stream).
3. Per-chunk idle timeout (progress-based) instead of a total-stream cap — rejected: fixed 60s total, because healthy slow generations keep making progress and must not be killed; the first-chunk wait gets its own 30s deadline since zero bytes is the pathological case.
4. `onTimeout` aborts via `AbortController` passed as `streamText({ abortSignal })` — rejected: abandoning the promise without aborting, because the upstream request would keep consuming quota/connections with nobody reading it.
5. Timeout values 30s first-chunk / 30s idle (user-approved 2026-10-08) — rejected: 60s/60s (sluggish recovery), 15s/30s (cold-start risk).

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build && bun run test:e2e` green — **171 unit / 540 assertions** (baseline 166 + 5 new), build, **33 e2e**
- [x] New unit tests pass (deadline fires / promise wins / source error wins / late settlement unhandled-safe / message classifies via `SERVICE_UNAVAILABLE_PATTERN`)
- [x] Client path already covered live + e2e: classified 503 → dialog (`errors.spec.ts` 503/empty/no-op tests); induced live hang not reproducible on demand — helper timing proven by unit tests

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-08 | plan drafted (root cause: no deadline anywhere in the await chain; live repro 7+ min pending request) |
| 2026-10-08 | approved — server-side deadline, 30s/30s, reload the hung request |
| 2026-10-08 | implemented — chain green (171 unit / 33 e2e); helper lives in `lib/playground/deadline.ts` (kept inside `bun test lib` scope, beside route-helper precedent `patch-text.ts`) |
