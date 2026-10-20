# Plan Organization (Numbered Folders + Index) — Implementation Plan

**Status:** implemented
**Date:** 2026-10-20

## Goal

`docs/plan/` currently holds 48 feature plans in flat kebab-case folders with
no ordering signal — you cannot see the step-by-step order work happened in,
nor which steps are done, without opening every `plan.md`. This change prefixes
every plan folder with its incremental number (creation order, from git
history) and adds a single `docs/plan/INDEX.md` that shows the sequence and
each plan's Status at a glance, so "how far did we get" is answerable from one
file. All path references (rules, docs, cross-links, code comments) are updated
in the same change set; `_template.md` stays unnumbered (it is the template,
not a step).

## Scope

### In scope

- `git mv` of all 48 folders: `docs/plan/<slug>/` → `docs/plan/NNN-<slug>/`
  (numbering format + order per decisions 1–2 below)
- New `docs/plan/INDEX.md` — sequence table: №, feature, Status, created date
- Reference updates:
  - Repo rules: `.agents/rules/feature-plan.md`,
    `.agents/rules/implementation-protocol.md` (3 spots),
    `.agents/rules/my-mistakes.md` (3 convention spots)
  - Docs: `docs/data-sources.md` (4), `docs/security/rls-audit.md` (1),
    `README.md` (1 link to `spec-languages/convention.md`)
  - Cross/self-links inside `docs/plan/**` (14 files: tasks ×6, plan ×6,
    `spec-languages/convention.md`, `scrollable-carousel/responses/capture.ts`)
  - Code comments: `app/[locale]/[slug]/preview-client.tsx`,
    `components/playground/playground.tsx` (2)
- Rule-text change: convention becomes
  `docs/plan/{NNN}-{kebab-feature}/plan.md`; next number = max + 1, claimed
  when the plan file is drafted; INDEX.md row updated in the same turn
- This plan's own folder gets the next free number (`049-plan-organization/`)

### Out of scope

- Root `data sources.md` + root `commit-plan.md` references — scratch files
  (untracked / gitignored), never committed, so their stale paths don't matter
  (descoped 2026-10-20)
- Content edits to plan files beyond path references — plans stay verbatim
  historical records (descoped 2026-10-20)
- Auto-generating INDEX.md (script/CI check) — a same-turn manual update rule
  in `feature-plan.md` is enough for 48 plans (descoped 2026-10-20)

## Design decisions

1. **Number format `NNN` (3-digit, zero-padded)** — `001-drag-and-drop` …
   `048-api-data-source`, next `049`. Rejected: bare `1-`/`01-` (variable
   width breaks column alignment in listings and diffs; runs out of clean
   sort at 100 vs never).
2. **Order = plan creation chronology** (first git commit of each `plan.md`;
   same-day ties broken by commit timestamp, so the mapping is deterministic).
   The resulting order —
   `001 drag-and-drop · 002 instance-scoped-editing · 003 spec-state-seeding ·
   004 card-content-flush · 005 unavailable-service-handling ·
   006 atomic-patch-stream · 007 no-op-steer-detection ·
   008 tailwind-runtime-classes · 009 edit-panel-drawer ·
   010 pick-selection-ring · 011 prop-list-inputs · 012 dual-theme-generation ·
   013 scrollable-carousel · 014 json-import-export · 015 runtime-class-compile ·
   016 safelist-audit · 017 model-timeout · 018 aspect-suggestions ·
   019 runtime-css-layer · 020 drawer-adaptive · 021 xray-labels · 022 ui-routes ·
   023 canvas-editing-shortcuts · 024 prompt-scope-chips ·
   025 xray-chip-dfs-placement · 026 xray-chip-tree-indent · 027 xray-chip-pick ·
   028 prompt-bar-mentions · 029 prompt-mention-instance-labels ·
   030 xray-overlay-priority · 031 xray-dots · 032 ui-rename-preview ·
   033 live-pages · 034 app-shell · 035 deploy · 036 e2e-hardening ·
   037 rls-audit · 038 spec-languages · 039 computed-directives ·
   040 catalog-icons · 041 responsive-ui · 042 tool-rail-and-spec-theme ·
   043 data-sources · 044 action-loading-states · 045 data-mutate-input-binding ·
   046 database-provider · 047 form-validation-gating · 048 api-data-source`.
   Rejected: logical/milestone order (rewrites history by feel; unstable as
   statuses change — creation date is a fact git already records).
3. **`docs/plan/INDEX.md` carries the "done so far" signal** (Status column
   read from each plan's `Status:` line). Rejected: numbers alone (sequence
   without completion state — plans like `deploy` are still draft).
4. **Renames via `git mv`** (one commit) so `git log --follow` keeps working;
   reference updates in the same commit — a rename without repointed links is
   a broken tree mid-history.

## Verification

- [x] Tree shows the full move: 81 tracked plan files renamed (66 `R` + 15
      `RM` = rename + in-file path update), 43 files with reference edits,
      2 untracked additions (`INDEX.md`, `049-plan-organization/`) — no other
      leftovers (`049` was plain-moved: it had no git history yet)
- [x] `grep` for `docs/plan/<slug>/` finds **zero** unnumbered references
      outside scratch (`data sources.md`, `commit-plan.md`) — the only hits
      left are the `{NNN}`-convention placeholders and one never-existing
      example slug, both intended
- [x] `bun run format:check && bun run lint && bunx tsc --noEmit && bun run test`
      green — format clean, lint 0, tsc clean, 551/551 unit
- [x] `INDEX.md` = 49 rows; status spot-check 6/6 matches its plan's `Status:`
      line (`015` draft, `026` rejected, `033` approved, `035` draft, `043`
      implemented, `048` implemented); created dates verified against git
      (001 → 2026-10-05 … 048 → 2026-10-19, 049 → 2026-10-20)
- [x] README link to `spec-languages/convention.md` resolves to
      `docs/plan/038-spec-languages/convention.md`

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-20 | plan drafted (chronology + reference inventory from git) |
| 2026-10-20 | approved — 3-digit numbers, chronological order, INDEX.md, global rule updated too |
| 2026-10-20 | implemented — 49 folders numbered `001`–`049`, `INDEX.md` live, ~60 files repointed, repo + global rules on the `{NNN}` convention; gates green (format/lint/tsc/551 unit), 6/6 status spot-checks |
