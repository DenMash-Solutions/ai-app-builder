# No-Op Steer Detection — Implementation Plan

**Status:** approved
**Date:** 2026-10-06

## Goal

A steer whose response yields no usable change currently commits an **identical history revision** with no error — observed live when the model's stream stopped after 62 bytes mid-JSONL: zero complete ops, `useUIStream` dropped the fragment, `onComplete` fired with the unchanged spec, and `page.tsx` committed it as `prompt:Make the photo cover…`. Failures must surface like other model failures (service dialog with switch-and-retry, `pendingOpRef` preserved) instead of silently polluting history. This is the client-side safety net for "streamed fine, changed nothing" (including paths where MSW mocks bypass the server validation added by `atomic-patch-stream`).

## Scope

### In scope

- `lib/utils.ts` (or `lib/history/`): structural deep-equal helper `specsEqual(a, b)` — order-insensitive key comparison, arrays ordered — with unit tests in `lib/` (bun test)
- `app/[locale]/page.tsx` `onComplete` edit branch: before committing, compare `completedSpec` against the request baseline (`lastRequestRef.current?.context.previousSpec`); if the baseline was a non-empty spec and the specs are equal → `setFailure({ kind: "service", message: t("service.noChanges") })`, **skip** `commitRevision`, and keep `pendingOpRef` intact so dialog retry replays the request (reorder: `pendingOpRef.current = null` moves after the checks, only on the commit paths)
- `lib/i18n/locale/en.json` + `es.json`: `service.noChanges` key (en: "The model returned no usable changes to the spec." / es: "El modelo no devolvió cambios utilizables en la especificación.")
- e2e in `errors.spec.ts`: successful generate → set `__GENERATE_MOCK__` to a truncated single-line `editLines` → type into the prompt box → click Steer → expect service dialog visible, and `readHistoryStorage` shows `revisions` still length 1 with `head: 0` (no no-op revision), then dismiss → toast shows `noChanges` message

### Out of scope

- Detecting *partial* patches client-side (some ops applied, rest dropped) — client cannot un-apply; that is fixed server-side by `atomic-patch-stream` (descoped 2026-10-06)
- Changes to the `@json-render/react` `useUIStream` package — external dependency, our callback layer is the right seam (descoped 2026-10-06)
- Flagging a steer where ops applied but net result is coincidentally equal — covered by the same deep-equal check at no extra cost (in scope as part of the comparison)

## Design decisions

1. Compare against `lastRequestRef` baseline rather than entry `revisions[head]` — rejected: reading the entry's head spec (requires history lookup + can drift), because the baseline is exactly what was sent as `currentSpec`
2. Reuse `kind: "service"` dialog rather than a toast — rejected: toast-only, because retry with a different model is the valuable recovery for flaky streams, and `noSpec` already established this pattern
3. Structural deep-equal instead of `JSON.stringify` — rejected: stringify (key order after `applyPatch` spread can differ), because it risks false "changed" results

## Verification

- [ ] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build && bun run test:e2e`
- [ ] New unit tests: `specsEqual` — equal-but-reordered keys, differing nested props, array order, missing vs undefined state
- [ ] New e2e: truncated-steer → dialog + no new revision + dismiss → toast (assertions above)
- [ ] Live MCP check: reproduce the 62-byte steer → dialog appears, history entry keeps its revision count

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-06 | plan drafted |
| 2026-10-06 | approved |
