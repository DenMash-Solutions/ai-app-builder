# Spec Languages — Tasks

Plan: `docs/plan/spec-languages/plan.md` (Status: draft — awaiting approval)

Legend: `[ ]` pending · `[~]` in progress · `[x]` done

Dependency order: 1 → (2, 3) → 4 → 5 → 6 → 7. Phases 2 and 3 are parallel after 1; 4 needs 1 (toggle works on existing specs) and 2 (new generations); 5 needs 1 + 3; 6 needs 3 + 4/5.

## Phase 0 — Convention

- [ ] 0.1 ADR `docs/plan/spec-languages/convention.md`: the contract in one page — copy-seed rule, `i18n.<tag>` namespace, merge + fallback chain (exact → base → seed), app-locale ≠ content-language separation, generation contract, route-driven serving, editor semantics (toggle, write redirection, persistence)

## Phase 1 — Core mechanics (`lib/`, unit-tested)

- [ ] 1.1 `lib/i18n/spec-languages.ts`: `mergeI18n(state, tag)` — `Intl.getCanonicalLocales` canonicalization, shallow merge `copy ← i18n[base] ← i18n[exact]`, missing keys fall back to seed; `availableLanguages(spec)` = `[seedLocale] ∪ keys(i18n)` (+ unit tests: exact/base/seed chain, canonicalization, empty i18n)
- [ ] 1.2 Coverage validator: per-tag key diff (missing / orphaned), tag-format check, non-blocking report shape (+ tests)
- [ ] 1.3 Ingest normalizer: walk spec, lift whitelisted string props (`text`, `label`, `title`, `description`, `placeholder`, …from the catalog) into stable `state.copy.<key>` and replace with `$state` refs; skip existing refs, `$template`, `$cond` (+ tests: lifted, idempotent, expressions untouched)

## Phase 2 — Generation contract

- [ ] 2.1 Generator prompt/schema: copy at stable `/copy` keys; translations for each requested language under `i18n.<tag>` (BCP-47); default when unspecified = app pair (en, es)
- [ ] 2.2 Wire normalizer + validator into generate/import ingest; missing-translation coverage surfaces as a non-blocking flag on the entry

## Phase 3 — Renderer merge

- [ ] 3.1 `LivePage` (featured root + live URL): merge copy for the **route locale** before `StateProvider`; `state.locale` left as app locale so `$template` hrefs keep following app routing
- [ ] 3.2 Preview route: same merge (route locale), preview stays client-rendered
- [ ] 3.3 Regression: committed spec pages (login/signup/admin) untouched — they keep route-injected bundles

## Phase 4 — Editor content-language toggle

- [ ] 4.1 Toggle in the playground top bar: options = `availableLanguages(spec)` + "Add language…"; canvas re-binds via `mergeI18n` (same helper as render)
- [ ] 4.2 Persistence: `genui-editor-lang:<entryId>` + global `genui-content-lang`; resolved synchronously while computing the initial state (no seed flash, no effect-based switch); stale tag (absent from spec) falls through the chain
- [ ] 4.3 Write redirection: state-data edits to `/copy/*` while a non-seed language is active write to `i18n.<tag>.<key>` (create-if-missing); "Revert to source" deletes the key → seed fallback
- [ ] 4.4 Untranslated-key badges (per-tag diff) + model actions: **Translate missing** (fill gaps in active language), **Add language…** (translate whole spec into a new tag)
- [ ] 4.5 e2e: toggle survives reload (localStorage round-trip); edit-in-es mutates `i18n.es`, seed untouched (wrong-layer-write guard); stored tag absent → clean fallback

## Phase 5 — Static live rendering (bake)

- [ ] 5.1 SSR-safety smoke: `renderToStaticMarkup` over representative specs (content + stateful) via the registry renderer
- [ ] 5.2 Bake at publish: for each tag in `availableLanguages(spec)` → merge → `renderToStaticMarkup` + `buildForCandidates` CSS (in-process) → store artifacts with the snapshot; invalidate on publish / unpublish / feature
- [ ] 5.3 Serve: live route + featured root map route locale → artifact (fallback chain); bake-time classification — content-only specs → static HTML+CSS (0 KB JS); stateful specs → server-rendered HTML + hydration
- [ ] 5.4 e2e: content-only live page renders styled with `javaScriptEnabled: false`; compiled CSS present in served HTML (FOUC gone)

## Phase 6 — Content + journey

- [ ] 6.1 Republish the landing with `i18n.es` (via editor toggle + Translate action, MCP browser); verify `/es` serves Spanish, `/en` unchanged
- [ ] 6.2 Extra-language demo: Add language (`fr`) → canvas shows French → publish → baked `fr` artifact exists (route not exposed until the app grows `/fr` — expected)
- [ ] 6.3 Admin console: coverage badges reflect the tags each published page carries

## Phase 7 — Gate & close

- [ ] 7.1 Full gate: `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build && bun run test:e2e`
- [ ] 7.2 Plan → `Status: implemented` + verification record; ADR linked from the repo docs index
