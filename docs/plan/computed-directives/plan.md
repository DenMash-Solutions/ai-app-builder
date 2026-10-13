# Computed Directives — Generic `$`-Values via `standardDirectives` + Custom Directives — Implementation Plan

**Status:** implemented
**Date:** 2026-10-12

## Goal

Give the AI a rich set of **generic computed values** — `length`, `search`, `filter`, aggregates, string ops, locale-aware formatting — so generated specs can emit live derivations instead of broken literal templates (the todo-app counter resolves `${/todos}` to `[object Object],… items remaining`). We do this with **json-render custom directives** (`$`-prefixed expressions), reusing the official pre-built `standardDirectives` for the common cases and adding custom directives for the collection/predicate gaps. Directives are described in the prompt automatically from their Zod schemas, and every render site resolves them via `JSONUIProvider directives=`.

## Context

- A **directive** is a userland `$`-prefixed dynamic expression: `{ name: "$filter", description?, schema: ZodObject, resolve(value, ctx) }` via `defineDirective` (from `@json-render/core`). `defineDirective` validates the `$` name and rejects built-in conflicts; `findDirective` matches on key presence; resolvers call `resolvePropValue` on inputs so directives nest/compose inside-out.
- **Wiring is two-sided**: `catalog.prompt({ directives })` emits a **"CUSTOM DYNAMIC VALUES"** section that auto-describes each directive (`formatZodType(d.schema)` + description) — the model gets full arg signatures for free — and `<JSONUIProvider directives={…}>` (or `createRenderer`) resolves them at render time. Installed core `0.21.0` already supports both (verified).
- **`@json-render/directives@0.21.0`** (official, matches core, peer `zod ^4`) ships **`standardDirectives`**: `$format` (date/currency/number/percent + `relative`), `$math` (add/subtract/multiply/divide/mod/min/max/round/floor/ceil/abs), `$concat`, `$count`, `$truncate`, `$pluralize`, `$join`.
- **Why directives over `$computed` functions**: the built-in `$computed` prompt path lists only bare **names** (no signatures/args), so computed functions would need a hand-written rules block; directives get their schemas auto-described instead. Directives also use the same `$`-syntax the model already knows (`$state`, `$cond`, …) and ship a battle-tested pre-built set. This supersedes the earlier `$computed`-functions design (2026-10-12).
- All 5 render sites share one provider stack: `StateProvider → Visibility → Action(handlers={}) → Validation(customFunctions={}) → Renderer`. `JSONUIProvider` = that exact stack **+ Functions + Directives**, so swapping in `JSONUIProvider directives={…}` is behavior-equivalent.
- Prompt assembly (`app/api/generate/route.ts`): `catalog.prompt({ editModes }) + STYLING_RULES + i18nRules(locale) + COMPLETENESS_RULES`.

## Scope

### In scope

1. **Install `@json-render/directives@^0.21.0`** (matches core; `bun add`).
2. **Reuse `standardDirectives`** — `$format`, `$math`, `$concat`, `$count`, `$truncate`, `$pluralize`, `$join` come free and battle-tested.
3. **Custom directives** (`lib/computed/directives.ts`, `defineDirective` + Zod schemas, defensive never-throw `resolve`) for the collection/predicate/string gaps:
   - **Filtering/search**: `$filter` (`{ $filter: <items>, field?, op?, value? }`; ops enum `eq|neq|gt|gte|lt|lte|contains|startsWith|endsWith|exists|in|truthy|falsy`; `value` present → default `eq`, else `truthy`), `$search` (`{ $search: <items>, query, fields? }`, case-insensitive substring).
   - **Predicates**: `$some` / `$every` (same predicate as `$filter`; `$every` vacuously `true` when empty).
   - **Aggregates**: `$agg` (`{ $agg: "sum"|"avg"|"min"|"max", items, field? }`) — one directive, op-in-value style like `$math`/`$format`.
   - **List ops**: `$sortBy` (`{ $sortBy: <items>, field?, dir?: "asc"|"desc" }`), `$unique` (`{ $unique: <items>, field? }`), `$map` (`{ $map: <items>, field }`), `$first` / `$last` (`{ $first: <items> }`).
   - **Fallback**: `$coalesce` (`{ $coalesce: [exprA, exprB, …] }` → first non-null/undefined/"" — array style like `$concat`).
   - **Strings**: `$upper`, `$lower`, `$capitalize` (`{ $upper: <value> }`), `$replace` (`{ $replace: <value>, find, replacement }`, literal).
   - One shared `matchesCondition(item, field, op, value)` helper powers `$filter`/`$some`/`$every`.
4. **Directive wiring** — export `appDirectives = [...standardDirectives, ...customDirectives]` (stable module constant):
   - `catalog.prompt({ directives: appDirectives })` in `app/api/generate/route.ts` (auto-describes all).
   - `<JSONUIProvider directives={appDirectives}>` at all 5 render sites: `components/playground/playground.tsx`, `app/[locale]/[slug]/preview-client.tsx`, `components/live/live-page.tsx`, `components/spec-page/spec-page.tsx`, `lib/publish/bake.tsx` (bake must resolve directives so artifacts are correct).
5. **Counter fix** — steer the todo spec's `counter-text` to:
   `{ "$concat": [ { "$count": { "$filter": { "$state": "/todos", "field": "done", "value": false } } }, " ", { "$state": "/copy/remaining-label" } ] }` → "2 items remaining" / "2 elementos restantes" (label is i18n-merged).
6. **Tests** — unit per custom directive (happy path + defensive: null/undefined/non-array/non-numeric/empty); predicate ops; nested composition (`$count` over `$filter` over `$state`); `catalog.prompt({ directives })` emits the "CUSTOM DYNAMIC VALUES" section with each directive name.

### Out of scope

- `$computed` computed-functions registration (superseded by directives — 2026-10-12); no `functions` catalog entry.
- `createI18nDirective` / `$t` — the app already does in-spec i18n via `state.i18n.<tag>` + `mergeI18n` (spec-languages); `$t` would duplicate it (2026-10-12).
- Per-entry / user-defined directives — fixed registered set (2026-10-12).
- ICU message formatting / full pluralization rules — `$pluralize` covers one/other/zero; deeper CLDR plural categories deferred (2026-10-12).

## Design decisions

1. **Directives, not `$computed` functions** — rejected: computed-functions (catalog `functions` + runtime impls). The built-in `$computed` prompt lists names only (no signatures), so correctness would depend on a hand-written rules block; directives auto-describe their Zod schemas, reuse the official `standardDirectives`, and match the `$`-syntax the model already uses. (User directive 2026-10-12 — "check the directives page".)
2. **`standardDirectives` for common ops; custom only for the gaps** — rejected: reimplementing `$count`/`$truncate`/`$format`/… ourselves. The package is official, battle-tested, and version-locked to core; we write only the collection/predicate/string directives it lacks.
3. **`$agg` single directive for sum/avg/min/max** (op-in-value) — rejected: four separate `$sum`/`$avg`/… directives (clutters the prompt, risks confusion with `$math`'s two-operand `min`/`max`). One op-driven directive mirrors `$math`/`$format`.
4. **`$coalesce` takes an array** (`{ $coalesce: [a, b] }`) — rejected: fixed-key `coalesce(a, b, c)` (can't express N). Array style matches `$concat`; array args resolve expressions (verified in core).
5. **Zod `enum` for `op` / `dir` / agg op** — richer auto-description: `formatZodType` renders the exact allowed values into the prompt, so the model sees `eq | neq | …` without hand-written docs.
6. **Defensive, never-throw resolvers** — a throw inside a directive crashes render; every resolver coerces bad input (`toArr`/`toStr`, `Number()` with a `Number.isFinite` guard; empty aggregates → `0`).
7. **`JSONUIProvider` swap at all 5 sites** — rejected: adding a separate directives wrapper (none exists) or a `Renderer directives` prop for runtime (it's a provider prop). `JSONUIProvider` is the exact existing stack + Directives, so the swap is behavior-equivalent; bake gets it too so static artifacts resolve directives.
8. **Stable `appDirectives` module constant** — `createDirectiveRegistry` is memoized on the array identity; a fresh array each render would rebuild the registry every render.
9. **Accept directive args both as siblings and nested inside the primary value** (`directiveArgs` helper) — the canonical form (like `$truncate`) is siblings (`{ "$filter": { "$state": "/todos" }, "field": "done", "value": false }`), but models routinely nest (`{ "$filter": { "$state": "/todos", "field": "done", "value": false } }`); because `$state` resolution drops sibling keys inside its own value, the nested form silently dropped the condition and counted every item. Reading the RAW (unresolved) primary lets both shapes apply the condition; a `$state`/`$computed` expression never carries literal arg keys, so it's never mistaken for the nested form.

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build` — all green (349 unit tests). `bun run test:e2e` — 74 passed, 4 failed; the 4 failures reproduce on a clean `HEAD` (featured-landing content is absent — a known spec-languages publishing-state issue, not caused by this change).
- [x] Unit (`lib/computed/directives.test.ts`, 30 tests): each custom directive happy path + defensive edge (null/undefined/non-array/non-numeric/empty); predicate op matrix; `$count`/`$filter`/`$state` nested composition; `$coalesce` first-non-empty; **args-nested-inside-directive-value (model drift)** still applies the condition.
- [x] Prompt: `catalog.prompt({ directives: appDirectives })` contains "CUSTOM DYNAMIC VALUES:" listing every directive with its auto-described schema (asserted in the test).
- [x] UI: steered the todo counter → canvas shows **"2 items remaining"**; content-language → Español shows **"2 elementos restantes"**; canvas + EditPanel still work.
- [x] UI: the model emitted the `$concat`/`$count`/`$filter` directive when steered and it renders (the steer surfaced a shape mismatch, fixed by accepting args both as siblings and nested — see design decision 9).
- [x] Render sites resolve directives: playground ✓, preview (`/en/…`) ✓ (both verified in-browser), bake ✓ (`lib/publish/bake.test.ts` asserts baked HTML contains the computed text); live page + spec page share the identical `JSONUIProvider` wiring (tsc-verified).

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-12 | plan drafted (initially `$computed` functions) |
| 2026-10-12 | revised → directives after reviewing json-render.dev/docs/directives (auto-described prompt + `standardDirectives`) |
| 2026-10-12 | implemented — gate green; counter verified en/es; directives accept sibling **and** nested arg shapes after the steer exposed model drift |
