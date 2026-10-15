# Spec Languages — In-Spec Translations & Server-Baked Live Pages — Implementation Plan

**Status:** in progress
**Date:** 2026-10-12

## Goal

One spec carries any number of languages: `state.copy` is the single-language seed, translations live in `state.i18n.<tag>` (any BCP-47 tag), and every renderer merges the active language over the seed before rendering. On live/featured pages the language comes from the route (`/en/…`, `/es/…`); in the editor it comes from a persisted content-language toggle. Live pages stop being client-rendered: publish bakes one static artifact (HTML + compiled CSS) per language tag — served by route locale with zero JS for content pages (hydration only when a spec is stateful). The playground/editor keeps the full client engine. This generalizes the committed-spec pattern (login/signup: copy injected from outside, spec = seed) to generated and published pages, without duplicating specs per language.

## Context

- Committed specs (`lib/specs/*.json`) already put language outside: route injects `copy`/`checks` via `extraState`, `state.copy` is a seed (standing rule).
- Generated/published specs are single-language with inline literal copy — no shared keys, so route injection can't help; `/es` serves the English landing today.
- `LivePage` renders `spec.state` as-is (no locale), and its styles arrive by client effect (`useRuntimeClasses → fetch /api/tailwind → inject <style>`) — a FOUC today and broken without JS.
- Engine already supports `$state`, `$template`, `$cond` — but `$cond` props are editor-read-only (app i18n strings document it), which made bilingual-`$cond` specs rejected below.

## Scope

### In scope

1. **Convention ADR** — `state.copy` = seed (one language); `state.i18n.<tag>` = translations (any BCP-47 tag); elements reference `/copy/<key>` only; merge-at-render with fallback chain (exact tag → base tag → seed).
2. **Core mechanics** (`lib/`, unit-tested) — `mergeI18n(state, tag)` (canonicalization via `Intl.getCanonicalLocales`, fallback chain); coverage validator (per-tag key diff, tag-format check); ingest normalizer that lifts inline copy strings (`text`, `label`, `title`, `description`, `placeholder`, … — catalog whitelist) into stable `state.copy` keys and replaces them with `$state` refs.
3. **Generation contract** — generator prompt/schema requires stable `/copy` keys + translations for requested languages (default: app pair en/es when the prompt names none); ingest validates non-blockingly and flags missing translations.
4. **Renderer merge** — `LivePage` (featured root + live URL) and the preview route merge copy for the **route locale**; `state.locale` stays the app locale so `$template` hrefs (`/${/locale}/ui`) keep following app routing.
5. **Editor content-language toggle** — playground top bar control; options derived from the spec (`seed ∪ keys(i18n)`) + "Add language…"; canvas re-binds via the same merge; selection persisted device-locally (`genui-editor-lang:<entryId>` + global default `genui-content-lang`), resolved synchronously before mount; edits while a non-seed language is active write to `i18n.<tag>` (create-if-missing) with revert-to-source; untranslated-key badges + model-driven **Translate missing** / **Add language** actions.
6. **Static live rendering** — publish-time bake per tag: HTML via `renderToStaticMarkup` (client-side — RSC route layer can't render the json-render client providers) + CSS via `/api/tailwind`; artifacts stored with the snapshot (`published_pages.artifacts` jsonb); invalidation on publish/unpublish/feature; serving maps route locale → artifact (fallback chain); specs classified at bake: content-only → static 0-JS, stateful (editable state/inputs) → server-injected baked CSS + client render (FOUC-free; full hydration deferred). Fixes the existing FOUC.
7. **Content** — republish the landing with `i18n.es` (verify `/es`); demo an extra language end-to-end (e.g. `fr`) via "Add language…".
8. **Tests** — unit (merge, normalizer, validator, write redirection); e2e (toggle persists across reload; wrong-layer-write guard; missing-tag fallback; `/es` live content; JS-disabled live page for content-only specs).

### Out of scope

- App chrome languages beyond en/es (next-intl dictionaries stay en/es; growing the app locale list is a separate tiny task when wanted — live pages are chrome-less) (2026-10-12)
- Automatic staleness detection of translated strings (v1: manual; future: source-hash flags) (2026-10-12)
- Side-by-side translation editor (toggle only in v1) (2026-10-12)
- Per-locale featured pages (`featured-per-locale` schema) — superseded by in-spec overlays; revisit only if different *pages* per locale are ever needed (2026-10-12)
- `?lang=` query serving / on-page language pickers — live language comes from the route only (user directive 2026-10-12)
- Sidebar/account menu, sign-out UI, RLS audit, e2e DB seed, authenticated e2e, deploy — separate follow-ups from the next-steps discussion (2026-10-12)

## Design decisions

1. **Single spec with in-spec `i18n.<tag>` namespace** — rejected: duplicate specs per language (structure drifts on pages you keep editing, e.g. a todo app), sidecar overlay storage (still two artifacts + a sync problem), bilingual `$cond` per string (editor renders `$cond` props read-only, spec bloat, both languages inside the copy bag).
2. **`copy` stays one language; translations never mix into it** — preserves plain `$state` refs (editable in the playground) and the spirit of the standing rule.
3. **Any BCP-47 tag at every layer** (schema, editor, validator, bake) — no en/es lists in spec tooling; the en/es generation default is a convenience, not a limit (user directive 2026-10-12).
4. **Merge-at-render via shared helper** (`mergeI18n`, used by bake, editor, preview) — rejected: `$cond`-per-string (editor-hostile), engine changes (unnecessary; merge runs before `StateProvider`).
5. **Route locale = content language on live pages; no `?lang=`; app locale ≠ content language** — rejected: query-param serving and on-page pickers (user directive 2026-10-12); featured-per-locale schema (superseded).
6. **Editor toggle is canvas-local with device persistence and pre-mount synchronous resolution** — rejected: URL state; storing language on the entry (sync conflict surface for view state); effect-based switching (canvas flash + a fast click can write to the wrong language layer). "Add language…" shows a **searchable language picker** over all ISO 639-1 codes plus common region/script variants (tags only; names are derived per render via `Intl.DisplayNames` in the app locale, so they follow the en/es selector for free) and passes the chosen tag to the model steer; a free-text BCP-47 tag field stays as the escape hatch for languages outside the list (restricted to real code shapes — bare 5–8 letter words are grammatically legal BCP-47 but never real languages). Every non-seed language row also carries a **remove action** that drops its overlay layer outright after a confirmation dialog (the seed is never removable; removing the active one falls back to the seed; **Revert to source** routes through that same dialog because it performs the same removal; adding a language gives live feedback — pill spinner plus loading/success/failure toasts — because the model takes seconds while the canvas still shows the seed) — rejected: a hardcoded demo pool of tags (user directive 2026-10-14); a model-resolution endpoint that turns typed names into tags (latency, quota, and nondeterminism on a metadata lookup — the picker plus localized search covers the common-language scope).
7. **Publish-time bake per tag; static-for-content, client+baked-CSS-for-stateful** — rejected: build-time HTML files (feature/unfeature is runtime), pure static for all specs (breaks stateful specs like forms/todos), full React hydration of baked stateful markup (hydration-match fragility for no user gain — the page is interactive either way), client-only rendering (ships the engine for static content and keeps the FOUC).
8. **Untranslated keys render the seed (WYSIWYG) + badges** — rejected: raw-key display.
9. **Generation-time contract + ingest normalization, not schema trust** — models drift; the normalizer lifts inline strings via the catalog's copy-prop whitelist and reports coverage.

## Verification

- [ ] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bunx tsc --noEmit && bun run build && bun run test:e2e`
- [ ] Unit: merge fallback (exact → base → seed), tag canonicalization, coverage report, normalizer lifting, write-redirect targets active layer
- [ ] e2e: editor toggle survives reload; editing in `es` mutates `i18n.es` and not `copy`; stale stored tag falls back; `/es` live/featured shows Spanish; content-only live page renders styled with `javaScriptEnabled: false`
- [ ] MCP journey: Add language (`fr`) → canvas switch → publish → baked `fr` artifact present; admin coverage badges show carried tags
- [ ] Manual: no FOUC on `/en/landing`; canvas language switch has no seed flash

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-12 | plan drafted |
| 2026-10-14 | "Add language…" now asks for the BCP-47 tag (dialog + canonicalizeTag) and passes it to the model steer — replaced the hardcoded demo pool (user directive; decision 6 updated) |
| 2026-10-14 | "Add language…" redesigned again: searchable picker over all ISO 639-1 tags + common variants; names derive from the tag via `Intl.DisplayNames` in the app locale; free-text tag fallback kept; a model-resolve-name endpoint was designed and dropped (user decision — picker is deterministic, instant, offline) |
| 2026-10-14 | MCP browser check found the escape hatch accepting bare 5–8 letter words as BCP-47 ("chino" offered as a language) → tightened to real code shapes; added per-language **remove** action in the switcher (user directive); both verified by unit + e2e |
| 2026-10-14 | Language removal now asks for confirmation (dialog: name in title, Cancel/Remove; popover closes before it opens to avoid focus stacking) — user directive; e2e covers cancel-then-confirm |
| 2026-10-14 | Add-language gave no feedback while the model translated (user report) → in-flight pill spinner + loading→success/failure toasts wired through onComplete/onError/failure-retry (retry re-arms the loading toast, dismissal without retry fails it); "Revert to source" now routes through the same remove confirmation (same destructive op); e2e asserts the completion toast |
