# UI Rename & Preview Routes — Implementation Plan

**Status:** implemented
**Date:** 2026-10-11

## Goal

Let every generated UI carry a human **name** and a custom **slug**: the name replaces the raw prompt as the UI's identity (top bar, history drawer), and the slug produces a short shareable URL. A new chrome-less read-only **preview page** lives at `/{locale}/{slug}` (e.g. `/es/clinica-dental-sonrisas`); the playground stays at `/{locale}/ui/{ref}` and resolves the ref by **id first, then slug**, so both `/es/ui/<uuid>` and `/es/ui/dental-sonrisas` open the editor.

## Scope

### In scope

- `HistoryEntry` gains `name: string` and `slug: string`; `normalizeEntry` back-fills legacy entries (name ← prompt, slug ← `ui-<8-char-id>`)
- Slugify utility (unit-tested): lowercase, strip diacritics (NFD), non-alphanumerics → hyphens, collapse/trim hyphens, cap length, reserve `ui`
- New-entry defaults: name = generation prompt, slug = slugified prompt (truncated, + short uuid tail for uniqueness)
- **Rename UI**: popover on the top-bar title with two inputs — Name (free text) and Slug (auto-follows name until manually edited, then decoupled); inline validation: pattern, reserved `ui`, uniqueness within history; i18n errors (en/es)
- **Preview route** `app/[locale]/[slug]/page.tsx`: resolves entry by slug (same `useSyncExternalStore` pattern as `/ui/[id]`), renders read-only via `Renderer` + `registry` + `fixupScrollLayout` — no prompt bar, editor, tools, overlays, **background, or layout padding** (spec renders edge-to-edge; refined 2026-10-11 during implementation); floating "Open in playground" pill linking to `/ui/{slug}`; `document.title` = entry name; not-found panel for unknown slug
- **Playground route** `app/[locale]/ui/[ref]/page.tsx` (renamed param): resolve by id, fall back to slug; existing not-found panel kept
- History drawer rows and the empty-state display show `entry.name` (fallback: prompt)
- Post-generate redirect keeps pushing `/ui/{id}` (id = stable identity; slug is an alias)
- e2e: rename → preview URL; slug edit → old slug not-found, new works; `/ui/{slug}` opens playground; `/ui/{uuid}` still works; duplicate/reserved slug rejected; preview has no editor chrome

### Out of scope

- Server-persisted UIs / cross-browser sharing — descoped 2026-10-11: localStorage remains the store; links work per-browser (same as today's id URLs)
- Redirects from stale slugs after rename — descoped 2026-10-11: old slug shows the not-found panel (Q5 pending override)
- SEO metadata (`generateMetadata`, og tags) — descoped 2026-10-11: store is client-only; only `document.title` is set
- Rename from the history drawer / bulk rename — descoped 2026-10-11: single entry point in the top bar for now

## Design decisions

1. **Name + slug live on the entry** — rejected: separate slug→id index map, because it duplicates state that must stay in sync across entry updates/deletes and complicates the storage migration
2. **`/ui/[ref]` single param, id-first then slug** — rejected: separate `/ui/s/[slug]` route, because it lengthens URLs and the user asked to keep playground mode "the same"; id-first preserves every existing deep link
3. **Slug auto-follows name until manually edited** (classic CMS dirty-tracking) — rejected: always-overwrite (can't customize), never-auto (user explicitly asked for generation)
4. **Slug uniqueness enforced at save time** against all history entries, with inline error — rejected: silent `-2` suffixing, because the user gets a URL they didn't choose
5. **Preview is a lean standalone page, not Playground with props stripped** — rejected: `Playground preview` prop, because the 1100-line component's streaming/editor state machine is dead weight in preview and the not-found/render paths diverge anyway
6. **Generate completion still redirects to `/ui/{id}`** — rejected: redirect to slug URL, because slug is user-editable (identity churn) and id is the stable key

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bunx playwright test` — all green (240 unit, 64 e2e)
- [x] Unit: slugify (diacritics, casing, length, reserved), normalizeEntry legacy back-fill, uniqueness helper
- [x] e2e scenarios listed in Scope; en/es message parity wired through `e2e/constants.ts`
- [x] MCP spot-check at `/es`: generate → rename → `/es/<slug>` preview renders with no chrome → playground pill works → edit slug → old slug not-found

## Decisions (user-answered 2026-10-11)

1. Default slug for a fresh generation: **auto from prompt** — slugified prompt (truncated) + short uuid tail; preview URL works immediately
2. Preview chrome: **floating "Open in playground" pill** (bottom-right) on an otherwise bare page
3. Slug collision: **block save with inline error** — no silent suffixing
4. Rename UI: **top-bar title popover** with Name + Slug inputs
5. Stale slug after rename: **not-found panel** — no redirects

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-11 | plan drafted (research: localStorage HistoryEntry, next-intl locale-prefixed routes, Renderer+registry for read-only render, useSyncExternalStore resolution pattern) |
| 2026-10-11 | clarifying answers received — all five defaults confirmed; awaiting implementation approval |
| 2026-10-11 | approved; implementation started |
| 2026-10-11 | scope refined mid-implementation: preview page drops the `dot-grid` background and padded max-width wrapper — spec renders edge-to-edge, pill only (user request) |
| 2026-10-11 | implemented — format/lint/tsc clean, 240 unit + 64 e2e pass, MCP spot-check verified (rename → preview bare surface + title → slug edit → stale slug not-found) |
