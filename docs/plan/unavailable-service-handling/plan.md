# Unavailable Service Handling — Implementation Plan

**Status:** implemented
**Date:** 2026-10-06

## Goal

When the model service returns no response, the playground currently "succeeds": the route commits a 200 with an empty body, `useUIStream` fires `onComplete` with an empty spec, a junk history entry is created, and the user sees a dead canvas with no error (observed live 2026-10-06: default `gemini-3.8-flash` and `gemini-2.5-flash` stream 0 bytes, `gemini-3.1-flash-lite` works). Unavailable-service failures must surface with the same dialog-based recovery UX as the quota case: explain, offer model switch + replay the failed request, or dismiss to a toast — never silent success.

## Scope

### In scope

- **Server** (`app/api/generate/route.ts`): empty first-chunk completion (`first.done` with no value) → `503 { error, code: "service_unavailable" }` instead of 200-empty; upstream errors with `statusCode` 5xx → same 503 (rate-limit → 429 unchanged; other errors → 500 internal unchanged).
- **Client** (`app/[locale]/page.tsx`): classify failure messages with a new `SERVICE_UNAVAILABLE_PATTERN` → open the failure dialog in `service` flavor (mirrors quota flow: `lastRequestRef` replay on confirm, dismiss → toast with server message).
- Network fetch failures (`Failed to fetch` / `NetworkError` / `Load failed`) classified as service-unavailable (dialog), not bare toast.
- **Empty-completion guard**: a fresh generation whose `onComplete` spec has no `root` takes the service-failure path and creates **no history entry** (also covers non-JSONL/plain-text model output, which parses to an empty spec without any HTTP error).
- **Dialog**: generalize `components/quota-dialog.tsx` → `components/failure-dialog.tsx` (`kind: "quota" | "service"`), same interaction: `ModelOptions` + `Switch & retry` (disabled until model changes) + `Not now` → toast. Quota e2e keeps passing with identical copy.
- **i18n**: new `service` block (title/description/switchAndRetry/dismiss) in `en.json` + `es.json`.
- **Tests**: unit tests for `SERVICE_UNAVAILABLE_PATTERN`; three new e2e tests in `errors.spec.ts` (503 dialog + switch-retry; dismiss → toast; `lines: []` empty stream → dialog + zero history entries).
- **Cleanup**: delete the junk empty-spec history entry created by today's failed run (in-app via History drawer).
- **Default model**: switch `DEFAULT_MODEL_ID` from `gemini-3.8-flash` (proven to return empty responses) to `gemini-3.1-flash-lite` (approved 2026-10-06).

### Out of scope

- Mid-stream failures after the first chunk (already committed HTTP status can't change; stays toast) (descoped 2026-10-06)
- Patching the upstream `@json-render/react` `useUIStream` hook (descoped 2026-10-06 — handled at the app layer)

## Design decisions

1. Server classifies the empty completion **before committing to the 200 stream** (same "wait for first chunk" seam the quota design already uses) — rejected: client-only detection, because a 200-empty is indistinguishable from success at the transport layer and wastes a round trip.
2. Service flavor reuses the quota interaction (model options + switch & retry) — rejected: plain retry-only dialog, because the failure is model-specific (3.8/2.5 empty, 3.1-lite streams), so switching model is the proven fix; rejected: a separate near-duplicate dialog component, because DRY.
3. Client-side empty-completion guard in `onComplete` — rejected: trusting the server alone, because non-JSONL output yields an empty spec with no HTTP error.
4. Message-pattern classification (`SERVICE_UNAVAILABLE_PATTERN` beside `RATE_LIMIT_PATTERN` in `lib/playground/models.ts`) — rejected: plumbing `code` through `useUIStream`, because the upstream hook throws `Error(message)` only (quota precedent).
5. Default model moves to `gemini-3.1-flash-lite` in the same change — rejected: keeping 3.8 Flash as default, because every fresh user's first generate deterministically fails empty until they discover the dialog.

## Verification

- [x] Chain: `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build && bun run test:e2e` — green (format/lint/tsc, **103 unit**, build, **25 e2e**)
- [x] Unit: `SERVICE_UNAVAILABLE_PATTERN` matches service-unavailable/no-response/503/fetch-failure messages; rate-limit still classifies as quota first; config errors stay non-matching
- [x] e2e: three new `errors.spec.ts` tests pass (503 dialog + switch-retry, dismiss → toast, `lines: []` → dialog + 0 history); existing quota tests unchanged
- [x] Live MCP: real 503 from `3.8 Flash` → service dialog (title/copy, failing model pre-selected, retry disabled until change); switch to 3.1 Flash Lite + retry → 200 stream → history entry committed; junk empty-spec entry deleted; default pill shows `3.1 Lite`

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-06 | plan drafted (root cause reproduced: curl → HTTP 200, 0 bytes) |
| 2026-10-06 | approved — quota-mirror dialog + default model switch to 3.1 Flash Lite |
| 2026-10-06 | implemented — chain green (103 unit / 25 e2e) + live 503 → dialog → switch-retry verified over MCP |
