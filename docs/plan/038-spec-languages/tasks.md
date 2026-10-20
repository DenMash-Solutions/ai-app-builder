# Spec Languages — Tasks

Plan: `docs/plan/038-spec-languages/plan.md` (Status: in progress)

Legend: `[ ]` pending · `[~]` in progress · `[x]` done

Dependency order: 1 → (2, 3) → 4 → 5 → 6 → 7. Phases 2 and 3 are parallel after 1; 4 needs 1 (toggle works on existing specs) and 2 (new generations); 5 needs 1 + 3; 6 needs 3 + 4/5.

## Phase 0 — Convention

- [x] 0.1 ADR `docs/plan/038-spec-languages/convention.md`: the contract in one page — copy-seed rule, `i18n.<tag>` namespace, merge + fallback chain (exact → base → seed), app-locale ≠ content-language separation, generation contract, route-driven serving, editor semantics (toggle, write redirection, persistence)

## Phase 1 — Core mechanics (`lib/`, unit-tested)

- [x] 1.1 `lib/i18n/spec-languages.ts`: `mergeI18n(state, tag)` — `Intl.getCanonicalLocales` canonicalization, shallow merge `copy ← i18n[base] ← i18n[exact]`, missing keys fall back to seed; `availableLanguages(spec)` = `[seedLocale] ∪ keys(i18n)` (+ unit tests: exact/base/seed chain, canonicalization, empty i18n)
- [x] 1.2 Coverage validator: per-tag key diff (missing / orphaned), tag-format check, non-blocking report shape (+ tests)
- [x] 1.3 Ingest normalizer: walk spec, lift whitelisted string props (`text`, `label`, `title`, `description`, `placeholder`, …from the catalog) into stable `state.copy.<key>` and replace with `$state` refs; skip existing refs, `$template`, `$cond` (+ tests: lifted, idempotent, expressions untouched)

## Phase 2 — Generation contract

- [x] 2.1 Generator prompt/schema: copy at stable `/copy` keys; translations for each requested language under `i18n.<tag>` (BCP-47); default when unspecified = app pair (en, es)
- [x] 2.2 Wire normalizer + validator into generate/import ingest; missing-translation coverage surfaces as a non-blocking flag on the entry

## Phase 3 — Renderer merge

- [x] 3.1 `LivePage` (featured root + live URL): merge copy for the **route locale** before `StateProvider`; `state.locale` left as app locale so `$template` hrefs keep following app routing
- [x] 3.2 Preview route: same merge (route locale), preview stays client-rendered
- [x] 3.3 Regression: committed spec pages (login/signup/admin) untouched — they keep route-injected bundles — no code touched login/signup (their journeys pass in the e2e sign-in/sign-out runs); `mergeI18n` early-returns on specs without `state.i18n`, so route-injected copy can't be re-merged; admin console verified live: committed frame + injected copy render, only the per-page cards gained badges (6.3)

## Phase 4 — Editor content-language toggle

- [x] 4.1 Toggle in the playground top bar: options = `availableLanguages(spec)` + "Add language…"; canvas re-binds via `mergeI18n` (same helper as render)
- [x] 4.2 Persistence: `genui-editor-lang:<entryId>` + global `genui-content-lang`; resolved synchronously while computing the initial state (no seed flash, no effect-based switch); stale tag (absent from spec) falls through the chain
- [x] 4.3 Write redirection: state-data edits to `/copy/*` while a non-seed language is active write to `i18n.<tag>.<key>` (create-if-missing); "Revert to source" deletes the key → seed fallback
- [x] 4.4 Untranslated-key badges (per-tag diff) + model actions: **Translate missing** (fill gaps in active language), **Add language…** (searchable picker over all ISO 639-1 tags + common variants — names derived via `Intl.DisplayNames` in the app locale, free-text BCP-47 tag fallback restricted to real code shapes), and per-language **remove** (drops the overlay layer; seed never removable; confirm dialog also guards Revert to source; add streams with live feedback — pill spinner + loading/success/failure toasts) — user directives 2026-10-14, no demo pool. The design's own language switcher stays in step too (decision 10): option added with the add's revision (prompt + `withLanguageSwitcherOption` fix-up), dropped by the local remove/revert op, and the canvas toggle now really switches (click ⇄ pill)
- [x] 4.5 e2e: toggle survives reload (localStorage round-trip); edit-in-es mutates `i18n.es`, seed untouched (wrong-layer-write guard); stored tag absent → clean fallback

## Phase 5 — Static live rendering (bake)

- [x] 5.1 SSR-safety smoke: `renderToStaticMarkup` over representative specs (content + stateful) via the registry renderer
- [x] 5.2 Bake at publish: for each tag in `availableLanguages(spec)` → merge → `renderToStaticMarkup` (client-side — RSC route layer can't render the json-render client providers) + CSS via `/api/tailwind` → store artifacts on `published_pages.artifacts` (jsonb, version-guarded) via `/api/publish-artifacts`; invalidate on publish / unpublish / feature
- [x] 5.3 Serve: live route + featured root map route locale → artifact (fallback chain, stale-version guard); bake-time classification — content-only specs → static HTML+CSS (0 client components); stateful specs → server-injected baked CSS + client render (FOUC-free; full hydration deferred)
- [x] 5.4 e2e: content-only live page renders styled with `javaScriptEnabled: false`; compiled CSS present in served HTML (FOUC gone) — needs a baked content page (Phase 6) — shipped in `f82d410`: the authed publish test loads the live URL with `javaScriptEnabled: false` and asserts styled rendering; green in every full run (85 e2e, 2026-10-14)

## Phase 6 — Content + journey

- [x] 6.1 Republish the landing with `i18n.es` (via editor toggle + Translate action, MCP browser); verify `/es` serves Spanish, `/en` unchanged — republished to **v3** (v2 was published mid-journey from the open dialog; layers were already complete, so no Translate run was needed — exercised the toggle instead); `/es/denmash` 200 hero "Descríbelo. Míralo. Perfecciónalo.", `/en/denmash` 200 hero "Describe it. See it. Perfect it." (both match the pre-publish refs)
- [x] 6.2 Extra-language demo: Add language (`fr`) → canvas shows French → publish → baked `fr` artifact exists (route not exposed until the app grows `/fr` — expected) — removed + re-added `fr` through the picker (with the new switcher sync: `lang-toggle` buttons = ES/EN/FR), published **v3** with `artifact_tags = [en, es, fr]`; `/fr/denmash` 404 as designed
- [x] 6.3 Admin console: coverage badges reflect the tags each published page carries — implemented: `loadOverview` derives sorted artifact keys → `AdminPageSummary.languages` → `buildAdminSpec` renders one uppercase outline badge per tag ahead of the featured/live/actions; verified live: DenMash card `EN ES FR` (v3), todo `EN ES`, artifact-less row shows none; unit covers row order + text

## Phase 7 — Gate & close

- [x] 7.1 Full gate: `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build && bun run test:e2e` — green 2026-10-14 (369 unit, 85 e2e, build OK)
- [x] 7.2 Plan → `Status: implemented` + verification record; ADR linked from the repo docs index — README gains a Documentation section linking `docs/plan/038-spec-languages/convention.md` (plus plans/security)

## Phase 8 — Preview/live switching + content-only routes (reopened 2026-10-15, decision 11)

- [x] 8.1 Preview wiring: `preview-client.tsx` injects the route locale into `state.locale` (highlight = URL language) and gains `onStateChange` → for a locale write carrying a language the spec carries, `router.push` (plain app router) to `/{tag}/{slug}` — route owns the language (decision 5); the preview pill pins its app-locale link (`defaultLocale` for content-only tags) so it never points into a 404 — verified: click `ES` on `/en/{slug}` → `/es/{slug}` + Spanish content + `lang="es"`
- [x] 8.2 Route split: app surfaces (`/`, `/ui`, `/admin`, `/login`, `/signup`) move under `app/[locale]/(app)/` behind a strict `hasLocale(LOCALES)` gate; the root `[locale]` layout keeps html/providers only and 404s non-canonical tags; `lib/i18n/request.ts` stops `notFound()`-ing unknown tags and reuses the default message catalog for content-only locales; **`proxy.ts` passes `/{tag}/{slug}` led by a non-app tag straight through** (next-intl routing would rewrite it to `/{default}/{tag}/{slug}`, a dead three-segment URL) — while app **path segments** stay out of that rule (`APP_SEGMENTS`: the unprefixed deep link `/ui/{ref}` must keep redirecting to `/en/ui/{ref}` — regression caught by the ui-routes deep-link test on the first full run); verified live: `/fr/denmash` 200 with full French (`lang="fr"`, "Décrivez-le. Visualisez-le. Perfectionnez-le."), `/fr/ui` 404, `/ui/{id}` → 307 `/en/ui/{id}`, `/login` and `/` still redirect to `/en…`
- [x] 8.3 e2e: design's toggle on the preview navigates (`/en/{slug}` → click `ES` → URL `/es/{slug}` + Spanish content; first click wrapped in `toPass` — it races hydration); `/fr/{slug}` renders 200 with seed fallback + `lang="fr"`; pill href pinned to `/en/ui/{slug}`; `/fr/ui` 404s; existing `/es`/`/en` previews unchanged (5 i18n e2e green)
- [x] 8.4 Full gate green + plan closed again (decision 11 verification record; amend the 6.2 deferral note and the ADR route paragraph) — 2026-10-15: format, lint, tsc, 369 unit, build, 86 e2e; ADR gained the runtime-highlight rule and the serving-routes paragraph

## Phase 9 — Declared switching + root serving (reopened 2026-10-15, decisions 12/13)

- [x] 9.1 Catalog + lib: declare `switch_language { tag }` in `playgroundCatalog.actions` (zod params, model-visible description); `hasSwitchLanguageBinding(spec)` + `withSwitchLanguageBinding(spec)` in `lib/i18n/language-switcher.ts` (pure; detect/ensure `on.change → switch_language` with `tag: {$state: "/locale"}` on a detected switcher; appends instead of clobbering existing bindings; no-op without one); root locale-resolution helper `lib/publish/root-serving.ts` (injected slug lookup so serving paths never hit the DB) — unit tests for all three (5 + 4 new; registry gained the inert default impl the catalog's actions now type-require)
- [x] 9.2 Root serving: root page moved out of `(app)` (`git mv`, gate keeps wrapping `/ui`, `/admin`, `/login`, `/signup`); proxy passes any single segment that is neither an app locale nor an app path segment through; the root resolves: app locale → serve; non-app locale carried by the featured spec → serve in that language; else published-slug redirect `/{default}/{seg}`; else 404 (nothing featured + non-app → 404; playground landing stays app-locale). Follow-on: the layout's canonical-tag guard moved down to the `[slug]` route (a non-canonical segment must still reach the root's slug-sugar redirect — uuid-shaped slugs 404ed otherwise), `html lang` uses the canonical form, `request.ts` comment corrected
- [x] 9.3 Surfaces: canvas, preview, and root handlers for `switch_language` (canvas = `setLangOverride` + persist, never navigates; preview = `/{tag}/{slug}`; root = `/{tag}`); stable-once via the ref pattern with an **effect re-syncing the closure each render** (`ActionProvider` captures initial handlers only; render-time ref writes are a `react-hooks/refs` error — lint caught it); each surface disables its `onStateChange` intercept when the spec declares the binding (no double navigation); `LivePage` gains the route-locale `state.locale` injection (fixes ES lit on the English root) and pins its pill — and the `PublicAccountCluster` links — to an app locale
- [x] 9.4 Prompt + fix-up: generate-prompt bullet for the binding (`i18nRules`), add-language steer hint mentions it; `withSwitchLanguageBinding` folded into the **shared ingest seam** (generate + steer + import all commit through it; local prop/structure ops deliberately untouched) so every committed spec ends in the declared form
- [x] 9.5 e2e: fixture toggle carries the binding (canonical generated shape; preview + canvas tests now run the action path); fallback verified by unit (`hasSwitchLanguageBinding` false → intercept stays wired) + a **live headless check** (a stripped-binding variant is infeasible: the completion fix-up re-binds on every model commit — the live unbound DenMash stands in as the compat subject); the authed feature/unfeature test *became* the root journey (generate switcher design → pt-BR picker-add → publish → feature → `/en`→`/es`→`/pt-BR`→`/en` bare-root toggles → bare-slug redirect → unfeature) — kept as **one** featured-mutating test because `fullyParallel` would race the singleton; the rename test now asserts the bare old slug 404s at the root (decision 12) while `/en/{old}` keeps the friendly panel
- [x] 9.6 Full gate green 2026-10-15: format, lint, tsc, **378 unit**, build, **86 e2e**; plan → `Status: implemented` with the verification record; ADR `convention.md` gains the declared form, the fallback rule, the root-serving paragraph, the switcher prompt bullet, and the generic-`navigate` out-of-scope note; live spot-checks: `/fr` serves DenMash in French (`lang="fr"`), root fallback switches live (`/fr` → click ES → `/es`, Spanish copy), `/denmash` 307 → `/en/denmash`, `/fr/ui` 404, garbage bare path 404 (live design migrates to the declared form on its next model commit — optional steer + republish)
