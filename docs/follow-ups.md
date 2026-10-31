# Follow-ups Backlog

> Living tracker for work descoped or promised by completed plans but **not yet claimed**
> by a new plan. When a follow-up gets a plan, move it to the plan's `NNN` link below and
> mark it ✅ claimed. Source plans are always `docs/plan/{NNN}-*/plan.md`.
>
> Last reviewed: 2026-10-30 (plan 061 implemented — F15 closed, A4 remainder
> registered as F19; F17/F18 remain open)

## 🔴 Open — needs a plan

| # | Follow-up | Source | Notes |
|---|-----------|--------|-------|
| F19 | **A4 flow canvas** — React Flow board of a project's screen artboards (arrange/connect screens of one multi-UI) | 061 out-of-scope, F15 deferral 2026-10-27 | **Unblocked 2026-10-30**: the deferral condition "A1–A3 exist" is met (061 implemented A1 organization, A2 navigate, A3 shared data/state) |
| F16 | **Portal container for spec-driven overlays** — `@json-render/shadcn` renders Dialog/Select/Popover/Tooltip via `Portal(…)` (10 call sites) and Radix resolves `container = globalThis.document.body`, so these mount **outside** the 059 device frame (mispositioned popper). Needs upstream `container`/portal-context support or a registry-level wrapper | 059 R6 finding 2026-10-27 | Known v1 limitation; blocked on `@json-render/shadcn` extensibility |
| F17 | **Cross-device project sync** — supabase `projects` table + RLS + a second LWW sync loop so project grouping follows the account (061 kept projects local-only per F14 precedent) | 061 Q1 descope 2026-10-29 | Needs `projects` migration + sync merge alongside `uis` |
| F18 | **Multi-screen publishing** — one project publishes as a site with per-screen routes, cross-page `navigate` links, `APP_SEGMENTS`/proxy work and a featured pointer story (061 leaves publish per-screen) | 061 Q4 descope 2026-10-29 | Own plan: routing + publish artifacts + e2e |
| F1 | **Theme hydration mismatch** — `ThemeSwitcher` sun/moon `aria-label`/icon: stored preference applied while SSR commits the spec default → hydration failure; **3 hydration errors still in every dev log**. `spec-theme` e2e only covers fresh visitors (no stored decision) so it never fires | 055 finding 9, descoped "record for later" (user decision 2026-10-25); re-observed in 057's build log | Small fix, currently pollutes every dev-log scan |
| F2 | **Design-page history race** — generation navigates to `/en/ui/{id}` before the history entry exists → "UI not found" → canvas reset **loses the whole generation** | 053, descoped as "candidate 054" — **054 never picked it up** | Unclaimed bug |
| F3 | **`/api/tailwind` hardening** — persistent/disk cache, concurrency dedupe, missing-only diffs, rate limiting | 057, "separate plan after this one" | Endpoint untouched by 057 |
| F4 | **Partial Prefetching adoption** (`partialPrefetching: true`) | 056, "its own follow-up after adoption completes" | Prerequisite (056) met; skill installed: `.agents/skills/next-partial-prefetching-adoption/` |
| F5 | **Static-shell optimizer pass** (`next-cache-components-optimizer`) | 056, "pure optimization after adoption" | Prerequisite met; skill `next-cache-components-optimizer` available |
| F6 | **`instant()` e2e regression tests** | 056, "decide at the check-in if wanted" | Open decision for the user |

## 🟡 Lower priority / conditional

| # | Follow-up | Source | Trigger |
|---|-----------|--------|---------|
| F7 | Per-app precompiled CSS beyond `bakedCss` (themes in the cache key, artifact regen on spec change) | 057 | Needs per-app theme design first |
| F8 | Semantic-token vocabulary expansion (`bg-primary`-centric prompt rewrite, option 3) | 057 | Prompt-behavior change → its own plan |
| F9 | Share the RSC projection cache with the proxy | 056 | No documented API; measured mitigation landed (slim reads, ~500ms → 190-260ms) |
| F10 | Rewrite 055's fetch-tag caches into `"use cache"` | 056 | Composes as-is; migrate only if wanted |
| F11 | Client-side (SWR/IndexedDB) caching of published specs | 055 | Pending user decision (server cache was the reported pain) |
| F12 | Admin overview queries (`lib/admin/overview.ts`) as its own surface | 055 | Never picked up |
| F13 | Residual 45 FPS vs 65 FPS gap (kept patterns' own cost) | 057 | Bar is "0 frames >100ms" — already met; revisit only if FPS complaints resume |

## 🧰 Deliberate rejections (reopen only on evidence)

- **054**: buffering generate mode (kills progressive streaming), client-side placeholder
  synthesis, forking `@json-render/react`'s silent `parseLine`, auto-healing old broken
  entries on page open, generic JSONRepair heuristics — logging reveals any new
  malformation classes first
- **053**: runtime tolerance for bare pointers / repeat params (strict validation is the
  product answer); `gemini-3.8-flash` 503 timeouts → covered by plan 017
- **057**: finite utility catalog / restricted generation vocabulary (limits what models
  may emit)

## ✅ Recently closed (kept for context)

| Follow-up | Closed by |
|-----------|-----------|
| Component templates (F14) | plan 060 (implemented 2026-10-29) |
| Project design / multi-UI A1–A3 (F15) | plan 061 (implemented 2026-10-30 — A4 remainder registered as F19) |
| Cache Components app-wide adoption (055 descoped pending decision) | plan 056 (implemented 2026-10-26) |
| 057 scope D — delete `app/probe/*` control pages | done in 057 |
| 057 scope E — reopen 016's declined slimming with stall evidence | 016 reopened → superseded/implemented by 057 |
| Safelist size / resize-FPS stall (016 descopes, reopened 2026-10-25) | plan 057 (3,053 KB → 197 KB) |
