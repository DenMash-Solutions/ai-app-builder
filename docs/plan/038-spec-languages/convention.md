# ADR: In-Spec Languages (copy seed + `i18n.<tag>` overlays)

**Status:** accepted · 2026-10-12 · Plan: `docs/plan/038-spec-languages/plan.md`

## The contract

One spec carries any number of languages. No sidecar storage, no per-language
spec copies, no `?lang=` URLs.

```jsonc
{
  "state": {
    "locale": "en",                 // app locale — drives $template routing (/en/ui…)
    "copy": {                       // the SEED: one language, stable keys
      "title": "Describe your page.",
      "heroSubtitle": "AI builds it in seconds."
    },
    "i18n": {                       // translations: any BCP-47 tags
      "es": { "title": "Describe tu página." },
      "fr": { "title": "Décrivez votre page." }
    }
  }
}
```

Rules:

1. **Elements reference `/copy/<key>` only** — never a literal string for
   user-facing copy, never a language-specific path. (`$template`, `$cond`,
   checks, and non-copy props like `href`/`src` are exempt.)
2. **`state.copy` is the seed and the source of truth for its own language.**
   The seed language is `state.locale` (canonicalized; `en` when absent).
   `i18n` overlays are therefore only ever consulted for *other* languages —
   an `i18n[seed]` entry is redundant and ignored by the merge (reported by
   the validator).
3. **Any BCP-47 tag at every layer** — schema, editor, validator, bake. Tags
   are canonicalized with `Intl.getCanonicalLocales`; invalid tags are
   ignored (merge) and reported (validator). The en/es *generation* default
   is a convenience, not a limit.
4. **App locale ≠ content language** — `state.locale` always keeps following
   app routing; the *viewed* language comes from the route (live pages) or
   the editor toggle. On live/preview the renderer's **runtime**
   `state.locale` is diffed to the route tag (stored spec untouched) so the
   design's own switcher highlights the language actually served.

## Merge & fallback chain

`mergeI18n(state, tag)` (in `lib/i18n/spec-languages.ts`) resolves per key:

```
i18n[exact tag]  →  i18n[base language]  →  state.copy (seed)
```

- Layers whose tag equals the seed locale are skipped (rule 2), so for the
  seed language the merge returns the seed unchanged.
- `es-MX` falls back to `es`, then to the seed. Unknown tags render the
  seed (WYSIWYG — never a raw key).
- The merge returns a **new state object** with `copy` replaced; `locale`
  and everything else are untouched. Callers pass the merged state to the
  renderer (`StateProvider initialState`); the stored spec is never mutated
  by rendering.

`availableLanguages(spec)` = `[seed, …canonical(i18n keys)]` — the editor
toggle's option list and the bake's per-tag loop.

## Where the merge happens (by surface)

| Surface | Language source | Merge point |
| --- | --- | --- |
| Featured root (`/{tag}` — app or carried content language) | route locale | server, before render/bake lookup; `state.locale` injected from the route so the switcher's highlight matches |
| Live/featured (`/{tag}/{slug}`) | route locale | server, before render/bake lookup |
| Preview route (`/ui/{ref}` preview pill target) | route locale | client, same helper; its `state.locale` diff + `switch_language` handler navigate `/{tag}/{slug}` |
| Playground canvas | editor content-language toggle | `initialState` of the canvas `StateProvider` |
| Committed specs (login/signup/admin) | route-injected bundles | unchanged — route already injects locale-correct `copy` via `extraState` |
| Published pages | baked per tag at publish | artifact lookup uses the same chain (exact → base → seed) |

**Switching (decisions 5, 11, 13)**: the design's switcher declares
`{"action": "switch_language", "params": {"tag": {"$state": "/locale"}}}` on
its `change` event (catalog action; the group writes `/locale` before it
emits, so the param resolves to the pressed tag). Each surface supplies the
handler — canvas switches in place (never navigates), preview navigates
`/{tag}/{slug}`, the root navigates `/{tag}` — kept stable-once behind a
ref (the action provider captures its initial handlers) with an effect
re-syncing the closure. Specs **without** the binding (published before the
action) keep the older `onStateChange` state-write intercept; once the
binding is declared the intercept is disabled for that surface, so the two
never double-navigate. The completion fix-up binds the action on every
model commit when a switcher is present, so existing designs migrate on
their next edit.

Serving routes (decisions 11 + 12, 2026-10-15): **any segment that is
neither an app locale nor an app path segment leads content** — the proxy
passes `/{tag}/{slug}` *and* a bare `/{seg}` through untouched (next-intl
routing would rewrite them into a prefixed or dead three-segment URL), and
the **root page (moved out of the `(app)` group) is the single
disambiguator**: app locale → serve; non-app locale carried by the
featured design → serve it in that language (`mergeI18n` fallback per key;
content-only artifacts via `servingArtifact`); otherwise the old slug sugar
— a published slug redirects to `/{default}/{slug}`, anything else 404s.
The layout's canonical-tag guard moved down to the `[slug]` route so
non-canonical slugs can still resolve; the `request.ts` config reuses the
default message catalog for content-only locales (their pages render baked
content; only shell strings leak through). App surfaces (`/ui`, `/admin`,
`/login`, `/signup`) sit behind a strict `hasLocale` gate in
`(app)/layout` — `/fr/denmash` serves, `/fr/ui` is a 404. The preview
pill and the authed root's account cluster pin their links to an app locale
so they never point into a content root (`/fr` → `/fr/ui` would 404).

## Generation contract

The generator is told (system-prompt rules + schema guidance):

- put every user-facing string in `state.copy` at a stable key; reference it
  as `{ "$state": "/copy/<key>" }`;
- ship translations for the requested languages under `state.i18n.<tag>`
  with the *same* keys — default pair when the prompt names none: **en, es**
  (the seed language is `state.locale`, so for an English seed only
  `i18n.es` is strictly required);
- if the design has a language switcher, keep `state.locale` bound on its
  `selected` prop and declare the switch:
  `"on": {"change": [{"action": "switch_language", "params": {"tag": {"$state": "/locale"}}}]}`;
- models drift: ingest is **not** trusted. The client ingest seam
  (`Playground.onComplete`, covering generate, steer-edit and JSON import)
  runs the normalizer (lifts stray inline copy into `state.copy`, replacing
  it with `$state` refs), the coverage validator, and the deterministic
  switcher fix-ups: a switcher gains the newly added language's option and
  its `switch_language` binding when missing (decisions 10 and 13 — pure,
  idempotent, input untouched). Missing translations
  are a **non-blocking** flag on the entry (`i18nMissing: string[]`, local
  device metadata — not synced), never a rejection.

The normalizer lifts only whitelisted top-level copy props (`text`, `label`,
`title`, `description`, `placeholder`, `caption`, `message`, `alt`,
`content` — the shadcn catalog's user-facing string props). Nested copy
(`items[].label`, `checks[].message`) is v1-exempt and documented as a known
limitation.

## Editor semantics

- **Toggle** in the playground top bar: options = `availableLanguages(spec)`
  + "Add language…". Selection persists device-locally:
  `genui-editor-lang:<entryId>` (per entry) falling back to
  `genui-content-lang` (global default), resolved synchronously while
  computing the initial state — no seed flash, no effect-based switch. A
  stored tag absent from the spec falls through to the seed (chain rule).
- **Write redirection**: editing a `/copy/*`-bound field while a non-seed
  language is active writes `state.i18n.<tag>.<key>` (create-if-missing)
  instead of the seed; the seed value stays intact underneath (rendered for
  the seed language). "Revert to source" deletes the overlay key → seed
  fallback. Seed-language edits keep writing `state.copy` exactly as today.
- **Badges**: per-tag missing-key diff (same validator) marks untranslated
  keys in the active language; **Translate missing** and **Add language…**
  are model-driven actions that stream patches into the active `i18n` layer.

## Publish-time bake

- On publish the app bakes one artifact per `availableLanguages(spec)`: merged
  state → `renderToStaticMarkup(<LiveTree/>)` + one shared CSS build of
  `collectSpecClassTokens(spec)`. The render runs **client-side** (the go-live
  dialog, `lib/publish/bake.tsx`): Next 16's RSC route layer treats the
  json-render providers + shadcn registry as opaque client references, so
  `renderToStaticMarkup` of them cannot execute in a Server Component / route
  handler. The CSS half stays server-side via the existing `/api/tailwind`
  (Node Tailwind), and the assembled artifacts are persisted by a thin server
  route `/api/publish-artifacts` (`lib/publish/bake-client.ts` orchestrates
  the three steps, all best-effort).
- Artifacts are stored on the `published_pages` row (`artifacts` jsonb,
  keyed by tag, each `{ html, css, kind, version }`), so they travel with
  the snapshot and are covered by the existing anon-SELECT policy.
  Serving checks `artifact.version === page.version`; a mismatch (bake still
  running / failed) degrades to today's client render — never stale HTML.
- **Classification**: a spec is `stateful` if any element declares `on`
  bindings, `watch`, or `$bindState`/`$bindItem`; otherwise `content`.
  - `content` → the served page is the baked HTML + inline CSS with **no
    client components** (works with JavaScript disabled; fixes today's FOUC).
  - `stateful` → the baked CSS is server-injected to kill the FOUC, and the
    page renders client-side exactly as today (interactivity needs JS
    anyway). Full React hydration of the baked markup is deliberately deferred
    — hydration-match fragility isn't worth it when the page is interactive
    regardless (decision recorded 2026-10-12).

## Out of scope (v1)

App-chrome locales beyond en/es · staleness/hash tracking of translations ·
side-by-side translation editor · per-locale featured pages · `?lang=`
serving / on-page pickers · nested copy props (`items[]`, `checks[]`) · a
generic spec `navigate` action (only `switch_language` is declared; other
navigation stays app-side).
