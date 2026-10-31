# Re-import Existing UI (create or update)

**Status:** implemented
**Date:** 2026-10-31

## Goal

Let JSON import either create a new UI (current behavior) or update an
existing one in place while preserving identity, memberships and revision
history.

## Scope

### In scope

- Per-row "Update from JSON" action on each history row (the row already
  identifies the target — no picker); create stays the footer import button
- Update path: replace spec, append a revision, bump `updatedAt`, keep
  id / name / slug / owner / memberships
- Two-step dialog on the row: paste + validate, then an overwrite
  confirmation showing target name, slug and revision count
- Normalization reuse: `parseSpecJson` (which runs `validateDataSources`)
  in the dialog, then `normalizeSpecCopy` + `commitRevision` (applies the
  coverage flag via `withCoverageFlag`) in the playground — same seam as
  generation
- Runtime state policy: project `/session` untouched; the screen's runtime
  state resets to the new spec seed on next open

### Out of scope

- Partial/merge import and visual diff — a diff UI is a separate plan
- Updating screens the user does not own — RLS forbids it server-side

## Design decisions

1. Update = **append a revision** through the existing revision stack (head
   moves, `MAX_REVISIONS` unchanged) — rejected: in-place spec overwrite,
   because the requirement explicitly forbids destroying rollback.
2. Identity preserved exactly (id, name, slug, owner, memberships); only spec
   and `updatedAt` change so LWW sync pushes it — rejected: new id, because
   links, memberships and published references would break.
3. Entry point is a new `components/playground/json-update-button.tsx`
   rendered per history row in `history-drawer.tsx` (new `onUpdateJson` prop
   → new `handleUpdateSpec` in `playground.tsx`) — rejected: a
   create-or-update mode with a target picker inside `json-import-button.tsx`
   (the draft's original shape), because the row already names the screen, so
   a picker adds a step without adding safety — also rejected: a separate
   import route, because the action already lives in the history drawer.
4. Atomicity: one history-store mutation (normalize + append in one write;
   debounced sync push as today) — rejected: multi-step writes, because a
   failure must never leave a half-replaced screen.
5. Update always requires confirmation; create keeps one-click.

## Files

New `components/playground/json-update-button.tsx`;
`components/history-drawer.tsx`; `components/playground/json-import-button.tsx`
(comment only); `components/playground/playground.tsx`
(`handleUpdateSpec`); `lib/history/history.ts` (`replaceEntrySpec`,
`REVISION_LABELS.import`); 8 en/es key pairs; unit tests in
`lib/history/history.test.ts`; e2e in `e2e/json-io.spec.ts`.
`lib/playground/json-io.ts` and `lib/projects/projects.ts` are **not** touched —
`parseSpecJson` is reused as-is.

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test`
      — 842 unit / 0 fail (839 + 3 new)
- [x] Unit: update preserves id/slug/projectId, appends exactly one revision
      and moves head, keeps revision 0 undoable, unknown target returns null
      with history untouched; create path unchanged (existing tests green)
- [x] e2e: create flow unchanged; update flow keeps identity (same URL,
      still one entry), adds revision 1 labelled `import`, previous content
      still stored — `e2e/json-io.spec.ts` 2 passed
- [x] Full e2e suite: **129 passed / exit 0** (128 + the new spec)
- [x] i18n en/es key parity — en = es, no diff
- [ ] MCP spot-check of both flows — **not run** (browser spot-check left
      for the review pass; the e2e spec covers the same flow in a real
      browser)

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-31 | plan drafted |
| 2026-10-31 | approved — user directed the next step of the roadmap |
| 2026-10-31 | implemented — `replaceEntrySpec` + `REVISION_LABELS.import` in `lib/history/history.ts`, row-scoped `json-update-button.tsx` (paste → confirm) wired through `onUpdateJson` in the drawer and `handleUpdateSpec` in the playground, 8 en/es key pairs; format + lint + tsc + 842 unit / 0 fail + full e2e 129 passed (exit 0) + i18n en/es key parity; MCP spot-check not run |
| 2026-10-31 | plan reconciled with the shipped design — per-row action instead of a create-or-update picker in the import dialog (In scope, design decision 3, Files rewritten); `UpdateStep` string literals replaced by the `UPDATE_STEPS` object constant |
