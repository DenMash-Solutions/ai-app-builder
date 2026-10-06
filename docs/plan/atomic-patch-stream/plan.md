# Atomic Patch Stream — Implementation Plan

**Status:** approved
**Date:** 2026-10-06

## Goal

Edit-mode (`steer`) responses currently stream raw model text straight to the client while it applies ops **line by line**. When the model stops mid-JSONL (observed repeatedly with `gemini-3.1-flash-lite`: streams died at 62/177/262 bytes with `finishReason=stop` mid-`"value":{`), the client silently drops the truncated final line — but keeps every *complete* line it already applied. That commits a **partial patch** as if it succeeded (the 177-byte case would apply `photo-card` props and lose the rest), and no error is ever raised. This feature makes edit responses atomic: buffer server-side, validate JSONL completeness, retry once, and only then respond — failures arrive as a classified 503 that the existing service dialog already understands (zero client changes).

## Scope

### In scope

- `lib/playground/patch-text.ts`: `validatePatchText(text): { ok: true; patchCount: number } | { ok: false; reason: string }`
  - split on newlines; skip empty/whitespace and `//` comment lines (mirrors `parseLine` in `@json-render/react`)
  - every remaining line must `JSON.parse`; `__meta: "usage"` lines pass through; otherwise the value must be an object with a string `op` ∈ `add|replace|remove|move|copy|test` and a non-empty string `path`
  - require ≥1 patch line overall
- `app/api/generate/route.ts`: for `isEdit` (spec present) — keep the existing first-chunk wait (quota/503/empty classification unchanged), but **drain** the remaining stream into a full string instead of enqueueing; validate; on failure run **one** retry attempt (same wait+drain+validate); if still invalid → `Response.json({ error: "Service unavailable: {model} returned an incomplete patch — switch model and retry.", code: "service_unavailable" }, { status: 503 })` (message matches `SERVICE_UNAVAILABLE_PATTERN`, so `page.tsx` opens the existing service dialog with switch-and-retry)
- success path: respond `200 text/plain` with the complete buffered text (client contract unchanged — `useUIStream` reads it as a stream, one chunk)
- generate mode (`spec === null`): unchanged true-streaming behavior
- unit tests `lib/playground/patch-text.test.ts`: truncated JSON, empty text, comment-only, usage line, single valid op, multi-op, unknown op, missing path, valid + trailing truncated line

### Out of scope

- Client-side retry / re-request logic — the switch-and-retry dialog already owns recovery (descoped 2026-10-06)
- Buffering or validating fresh **generations** — large payloads where streaming matters; completeness rules + empty-spec guard already cover the observed failure modes (descoped 2026-10-06)
- Streaming trailers / chunked error protocol — complex client changes for a problem buffering solves outright (descoped 2026-10-06)
- e2e coverage of the buffering path — MSW intercepts `/api/generate` in the browser before the route runs; verified by unit tests + live curl instead (descoped 2026-10-06)

## Design decisions

1. Buffer only edit-mode responses — rejected: buffer both modes (perceived-latency cost for large generations) and client-side atomicity (impossible: ops already applied), because patches are ~1KB and complete in one shot
2. One server-side retry — rejected: N retries (risk blowing `maxDuration = 60` at ~10-20s/attempt) and no retry (wastes the observed ~1-in-4 success rate), because one retry fits the budget and cuts flake meaningfully
3. Failure as `503 service_unavailable` with the existing message pattern — rejected: new error code + client mapping (touches dialog classification), because `SERVICE_UNAVAILABLE_PATTERN` already routes it to the dialog with zero client changes
4. Validation mirrors `parseLine` grammar exactly — rejected: stricter schema validation (zod per line), because the client's own tolerance defines what "usable" means; stricter would false-fail valid streams

## Verification

- [ ] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build && bun run test:e2e`
- [ ] Unit: all `validatePatchText` cases above green
- [ ] Live: replay the saved steer request (`curl -sN -X POST localhost:3000/api/generate --data-binary @…`) ×5 — every attempt returns either complete JSONL (all lines parse, ≥1 op) or a clean 503 JSON; **never** a partial 200
- [ ] Live: UI steer on the gallery still applies patches end-to-end (no regression to normal edits)

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-06 | plan drafted |
| 2026-10-06 | approved |
