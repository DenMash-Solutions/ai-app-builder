# Runtime Class Compile — Implementation Plan

**Status:** draft
**Date:** 2026-10-08

## Goal

Spec `className` values only exist at runtime (model output, history, editor input), so Tailwind's static build never sees them — anything not enumerated in `@source inline` silently no-ops. Two incidents this week (`aspect-portrait` recommended by the prompt doesn't exist at all; `aspect-[4/5]` used by the carousel spec isn't in the safelist) prove the safelist approach never finishes: arbitrary values are an infinite space. This feature ends the whack-a-mole with a three-part design: **(1)** a one-line safelist stopgap for the current `aspect-[4/5]` incident, **(2)** an on-demand compile API — `POST /api/tailwind` runs Tailwind's official `compile()`/`build(candidates)` engine (`@tailwindcss/node`, already in `node_modules`) over the exact class tokens a spec needs and returns the CSS, so **every valid utility incl. arbitrary values renders**, and **(3)** a lightweight auditor — tokens the compiler produces no rule for (genuinely invalid names) are badged in the editor instead of failing silently.

*Assumption on scope: "ok" = the recommended scope (stopgap + B + D). If you meant the smaller scope (stopgap + D only, keep safelisting), descope phase 2 below before approval.*

## Scope

### In scope

**Phase 1 — stopgap (immediate incident fix)**

- `app/globals.css`: add `aspect-[4/5]` literal to the `@source inline` aspect line
- `lib/editor/suggestions.ts`: add `aspect-[4/5]` to `COMMON_TAILWIND_CLASSES`
- unit test additions (`suggestions.test.ts`) + e2e probe for `aspect-[4/5]`

**Phase 2 — on-demand compile (`POST /api/tailwind`)**

- `bun add @tailwindcss/node` as a direct dependency (currently transitive via `@tailwindcss/postcss`); `next.config.ts`: `serverExternalPackages: ["@tailwindcss/node", "@tailwindcss/oxide"]` (native oxide module must not be bundled)
- `app/theme-tokens.css`: extract `@custom-variant dark`, `@theme`, `:root`, `.dark` blocks (globals.css:49-164) into a shared partial imported by **both** `app/globals.css` and the runtime compile input — single source of truth for semantic tokens (`bg-card` etc. must resolve identically)
- `lib/runtime-classes/candidates.ts` — `collectSpecClassTokens(spec)` (walk elements → `toClassTokens`, dedupe), `sanitizeCandidates()` (max 512 tokens, max length 200, reject whitespace/control chars)
- `lib/runtime-classes/escape.ts` — CSS-escaped selector matching with word-boundary safety (`.h-4` must not match `.h-48`), unit-tested
- `lib/runtime-classes/compile.ts` (server-only) — compile context cached per process (promise-deduped first build ~100ms), input = `node_modules/tailwindcss/theme.css` (reference) + `app/theme-tokens.css` + `node_modules/tailwindcss/utilities.css` (`layer(utilities)`) via absolute paths; `buildForCandidates()` → `{ css, missing }` where `missing` = requested tokens with no emitted rule
- `app/api/tailwind/route.ts` — POST `{ candidates: string[] }` → sanitize → build → `{ css, missing }`; in-memory cache keyed by sorted-token hash (entry cap); 400 on malformed body; Node runtime
- `components/playground/use-runtime-classes.ts` — hook on `displayedSpec`: debounce 200ms → collect → diff vs session `requested` Set → POST missing → append CSS to one persistent `<style data-runtime-tailwind>` in `<head>` → record `missing`; fetch failure → degrade silently to static CSS (`console.warn`); wired in `app/[locale]/page.tsx`
- `lib/runtime-classes/missing.ts` — tiny module store (get/subscribe) so the hook publishes `missing` tokens and the editor badge consumes it (no new deps)

**Phase 3 — auditor badge (D)**

- `components/editor/class-token-list.tsx` — token row shows an amber warning icon (`title` tooltip) when the token is in the `missing` set
- i18n en/es key `editor.classNotCompiled` (en: "No compiled rule — this may not be a valid utility class."; es: "Sin reglas compiladas — puede que no sea una clase de utilidad válida.")

### Out of scope

- Rewording `STYLING_RULES` line 9/11 (the "arbitrary values may not exist" advice stays true for boot/static contexts and named-token preference is good style) — (descoped 2026-10-08)
- `@tailwindcss/browser` Play CDN — official docs: *"development only, not intended for production"*; also re-emits the full stylesheet over the static build (cascade risk) — (rejected 2026-10-08)
- Persistent (localStorage) client CSS cache — server hash-cache + session Set suffice; persisted CSS risks staleness across theme/token changes — (descoped 2026-10-08)
- Badge/audit on the canvas itself or toasts — editor token rows only — (descoped 2026-10-08)
- Rate limiting/auth on the route — local playground; sanitization + size caps only — (descoped 2026-10-08)
- Per-chunk compile during streaming — debounced `displayedSpec` covers post-patch state — (descoped 2026-10-08)

## Design decisions

1. **Server on-demand compile via `@tailwindcss/node` `compile()`/`build(candidates)`** — rejected: Play CDN (`@tailwindcss/browser`), because docs declare it dev-only and it duplicates the full CSS on top of the static build; rejected: keep extending `@source inline`, because arbitrary values are infinite and every incident needs a human; rejected: client-side compile, because there is no official browser-safe engine API (the browser build is the CDN script, same rejection)
2. **Shared theme partial `app/theme-tokens.css`** imported by globals and the runtime input — rejected: compiling `globals.css` directly, because bare imports (`tw-animate-css`, `shadcn/tailwind.css`) have unproven resolution under `compile()` and its `@source` scans are wasted work at runtime; rejected: duplicating `@theme` in the lib, because it drifts from the real theme
3. **Coverage (`missing`) computed server-side** with an escaped-selector boundary match, returned as `{ css, missing }` — rejected: client `CSS.escape` parsing of the response, because the server owns the truth and unit tests run in bun; rejected: one `build()` per candidate, because N builds per request is orders of magnitude slower
4. **Session `requested` Set + in-memory route cache; no cross-reload CSS persistence** — rejected: localStorage CSS cache, because stale injected CSS outlives token/theme edits for marginal gain
5. **Badge driven by route-reported `missing`** — rejected: `document.styleSheets` scanning, because selector unescaping is brittle and it cannot distinguish "not compiled" from "not requested yet"
6. **Debounced (200ms) hook on `displayedSpec`** — rejected: synchronous fetch per edit commit (adds latency to every keystroke commit), rejected: per-stream-chunk (churn with no benefit)
7. **Keep the `aspect-[4/5]` safelist literal even though phase 2 would compile it on demand** — because the example spec uses it at first paint (no flash) and a static e2e probe guards it, at a one-line cost

## Verification

- [ ] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build && bun run test:e2e` green (baselines: 172 unit / 554 assertions / 33 e2e)
- [ ] New unit tests: candidates collection/sanitization, boundary-safe selector match, real-engine `buildForCandidates` (e.g. `aspect-[4/5]` → rule emitted; `aspect-portrait` → `missing`)
- [ ] New e2e: static probe `aspect-[4/5]` → `0.8`; `page.request.post("/api/tailwind", {candidates: ["aspect-[4/5]", "aspect-portrait"]})` → CSS contains escaped `.aspect-\[4\/5\]`, `missing` contains `aspect-portrait` (MSW only mocks `*/api/generate` — confirmed `onUnhandledFrame: "bypass"`)
- [ ] MCP live: free-type `mt-[13px]` in a className row → commit → computed `margin-top: 13px` (previously impossible); type `aspect-portrait` → amber badge with tooltip; type `aspect-[4/5]` → picked from suggestions, applies
- [ ] `next build` succeeds with `serverExternalPackages` change (no oxide bundling errors)

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-08 | plan drafted — research: `@source inline` cannot cover arbitrary values (docs); `compile()`/`build(candidates)` is the official on-demand pattern; `@tailwindcss/node` + oxide already in node_modules; MSW bypasses non-generate routes |
