# Project Publishing and Route Claims (closes F18)

**Status:** draft
**Date:** 2026-10-31

## Goal

Publish a project as one application under a globally unique handle with
multiple entry points, without breaking any existing published URL.

## Scope

### In scope

- Namespace registry as a single module shared by preview and live,
  implementing 062 decision 1 precedence
- Handle claim on publish: globally unique, lowercase, reserved-checked,
  atomic — separate from the name-derived `Project.slug`
- Handle change: reserve new → update routing → keep old as a redirect row →
  an active redirect blocks re-claiming it (no takeover); retention policy
  recorded in the plan when implemented
- Published projection keyed (project_id, route) with per-screen artifacts
- Project runtime: handle → route → screen spec → existing
  `bakeHtmlByLanguage` / `servingArtifact` path; dynamic params seed state
  exactly as preview does (`overlayPathState`)
- Publish validation: home screen set, every route resolves, data configs
  valid, no dangling references (source requirement checklist)
- Featured pointer story (`site_settings.featured_ui_id` is screen-based
  today) and cache-tag invalidation for every new writer
- Zero-JS `content` contract preserved per screen (plan 056 F2)

### Out of scope

- Custom domains, deployment environments (prod/preview per project),
  BYO credentials

## Design decisions

1. One namespace registry for preview and live — rejected: separate
   namespaces, because there is a single URL space and the source document
   requires one resolution mechanism.
2. Existing `published_pages` slugs keep resolving unchanged, and a handle
   can never collide with them (shared unique constraint) — rejected:
   migrating old slugs under handles, because it breaks every URL already
   shared.
3. Per-screen artifacts reuse the existing bake/classify path — rejected:
   one monolithic bundle, because it breaks the per-screen zero-JS contract
   and cache granularity.
4. Redirect rows are exclusive: an active redirect blocks re-claiming the
   value, and a handle change never silently drops the old entry point.
5. Every new writer invalidates tags through the same helper — rejected:
   ad-hoc revalidate calls, because the `cache-invalidation-writers` lesson
   exists for exactly this.
6. Published state lives on the project (`status`) plus entry-point rows —
   rejected: deriving state from row existence, because unpublish must be
   atomic across routes.

## Files

`db/` migration (entry points + redirects + handle column), namespace
registry module (new `lib/routes/`), `lib/publish/*`, `proxy.ts` if
required, publish UI, `app/[locale]/[slug]/[[...route]]` resolution,
en/es keys, e2e publish specs.

## Tasks

### 1. Schema (db/)

- [ ] Migration: `project.handle`, `published_entry_points`
      (project_id, screen_id, route, unique per project+route), redirect
      rows; handle uniqueness shared with existing `published_pages` slugs
      so a claim can never collide (decision 2)
- [ ] RLS + grants per the file pattern
- [ ] Featured-pointer story for projects (`site_settings.featured_ui_id`
      is screen-based today)

### 2. Namespace registry (lib/routes/)

- [ ] One registry module shared by preview and live implementing 062
      decision 1 precedence: app segments > `/user` > project handles >
      published slugs > local entry slugs
- [ ] Precedence unit matrix covering every claimant pair, ties included
- [ ] Claim paths consult the registry (reserved + already-taken checks)

### 3. Claim, change, redirect

- [ ] Handle claim on publish: atomic, lowercase, reserved-checked,
      separate from the name-derived `Project.slug`
- [ ] Handle change: reserve new → update routing → old handle becomes a
      redirect row; an active redirect blocks re-claim (decision 4);
      retention policy recorded in this plan when implemented
- [ ] Unpublish is atomic across routes via `project.status`
      (decision 6)

### 4. Project runtime and validation

- [ ] `app/[locale]/[slug]/[[...route]]` resolution: handle → route →
      screen spec → existing `bakeHtmlByLanguage` path; dynamic params seed
      state through `overlayPathState` exactly like preview
- [ ] Publish validation checklist: home screen set, every route resolves,
      data configs valid, no dangling references
- [ ] Per-screen zero-JS `content` contract preserved (056 F2)

### 5. Cache and writers

- [ ] Every new writer invalidates through the shared tag helper
      (decision 5; lesson `cache-invalidation-writers`)

### 6. Tests

- [ ] Unit: registry precedence matrix, atomic claim, redirect
      exclusivity, dynamic route resolution
- [ ] e2e: project publishes → home, static, dynamic and 404 routes resolve
      live; a second project is unaffected; handle change redirects the old
      URL; a pre-existing published slug still serves
- [ ] Cache revalidation observable in the e2e log; full gate + build

## Verification

- [ ] `bun run format && bun run lint && bunx tsc --noEmit && bun run test`
- [ ] Unit: registry precedence incl. every claimant pair, atomic claim,
      redirect exclusivity, route resolution with dynamic segments
- [ ] e2e: publish a project → four routes (home, static, dynamic,
      404 case) resolve live; a second project is unaffected; handle change
      redirects the old URL; a pre-existing published slug still serves
- [ ] Cache revalidation observable in the e2e log; full gate + build

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-31 | plan drafted (F18 claimed here) |
