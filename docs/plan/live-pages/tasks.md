# Live Pages — Task Board

Updated as work progresses (checkbox states are the source of truth; see plan: `docs/plan/live-pages/plan.md`).

Legend: `[ ]` pending · `[~]` in progress · `[x]` done

## Phase 1 — Supabase foundation (spec-rendered auth)

- [x] 1.1 Fetch project URL + anon key; `.env.local` + `.env.example` (no secrets committed)
- [x] 1.2 Install `@supabase/supabase-js` + `@supabase/ssr`
- [x] 1.3 Browser/server clients (`lib/supabase/`) + session refresh in `proxy.ts`
- [x] 1.4 Auth context provider (`user`, `role`, `onAuthStateChange`)
- [x] 1.5 Spec form primitives audit: Input state binding, submit action, validation — extend catalog if missing *(verdict: engine supports it; nested `checks[].message` needed an eager `localizeSpec` pre-pass while `checks[].args` must stay untouched — the engine resolves those lazily against live state; eager resolution froze cross-field `matches` and was fixed + regression-tested)*
- [x] 1.6 Auth specs authored (agent-generated, committed under `lib/specs/`) + unit tests (validateSpec, localizeSpec, action wiring)
- [x] 1.7 `/login` + `/signup` routes (spec render + wired auth actions + confirmation screen state)
- [x] 1.8 "Edit in playground" pill component (shared) — **rendered only from the admin context** (user: only the admin can edit committed pages; public spec pages stay clean)

## Phase 2 — Schema + RLS

- [x] 2.1 Inspect current project state (tables) via MCP *(public schema was empty; 1 confirmed auth user already existed)*
- [x] 2.2 SQL: `profiles` trigger, `uis`, `page_versions`, `published_pages`, `site_settings` *(migration `live_pages_schema`)*
- [x] 2.3 RLS policies (owner drafts / anon published / admin featured) *(migration `live_pages_rls`, 14 policies; probes: anon read `published_pages` ✓, anon write `uis` denied ✓)*
- [x] 2.4 Confirmed admin user + `role=admin` *(user pre-existed and was confirmed; `profiles` backfilled to `admin` — password never in the repo)*

## Phase 3 — Auto-sync engine

- [x] 3.1 `HistoryEntry.updatedAt` + `normalizeEntry` back-fill (+tests)
- [x] 3.2 `lib/history/sync.ts`: debounced push, LWW merge, mocked-client unit tests *(incl. `flushSync` for "Upload now"; deletes by synced-id diff)*
- [x] 3.3 Status dot (Saved to account / Syncing / Offline) *(`SyncStatusDot` in the top bar — desktop cluster + mobile menu)*
- [x] 3.4 First-login "Upload your N local UIs?" banner; anon "Sign up to keep your UIs" banner *(nudge = visible shortcut, not a consent gate — Q7 is fully auto sync)*

## Phase 4 — Publish flow (history drawer)

- [x] 4.1 Go-live dialog: slug prefilled, debounced global availability, version snapshot *(verified live: availability → publish → v1 snapshot + public row + Live badge)*
- [x] 4.2 Unpublish + live URL display/link; anon → signup CTA *(unpublish covered by unit test; full journey in 7.3)*
- [x] 4.3 i18n en/es for publish strings

## Phase 5 — Featured root

- [x] 5.1 Server fetch `site_settings.featured` → chrome-less render at `/{locale}` + pill + `generateMetadata` *(verified live: root title = live page name; un-featured after the check)*
- [x] 5.2 `/{locale}/ui` landing route (pill target; root falls back when nothing featured) *(auth redirects now land on /ui)*
- [x] 5.3 `RESERVED_SLUGS` += `admin | login | signup` (+tests) *([slug] route also gained the published-pages fallback so live URLs work for anonymous visitors — fresh-browser visit verified)*

## Phase 6 — Admin page

- [x] 6.1 Admin spec authored (agent-generated, committed under `lib/specs/`) + pure `buildAdminSpec` composition (+tests) *(`Badge` takes `text` prop, not children — engine quirk documented in the builder)*
- [x] 6.2 `/{locale}/admin`: admin-only guard, spec render, wired actions (list/feature/unfeature) *(verified live incl. feature→badge→unfeature cycle; guard waits for the role fetch before denying — race fixed)*

## Phase 7 — Verification

- [x] 7.1 Full chain: format, lint, tsc, unit, playwright *(no regressions — gate green; full suite passed with 2 banner-overlay failures fixed by landing-only gating)*
- [x] 7.2 e2e additions (anonymous paths): root fallback, auth pages render, reserved slugs, banners *(`e2e/live-pages.spec.ts`, 6 tests ×3 repeats green; auth specs gained a real `h1` (a11y); drawer test waits for the post-generation redirect to settle — mid-navigation opens get dropped by the route remount)*
- [x] 7.3 MCP journey: signup → confirm → publish → fresh-browser live visit → feature → root change *(signup → "check your email" screen → SQL-confirm → login → sync dot "Guardado en la cuenta" ✓; publish/live-visit/feature cycle verified earlier ✓; temp user + rows cleaned up, `featured_ui_id` left null)*
- [x] 7.4 Secrets audit: no credentials in git; `.env.local` untracked *(only `.env.example` tracked with placeholders; `.env` + `.env.local` gitignored; no password/JWT literals in any committable file)*

## Follow-up — Landing page at root *(user request; content via the publish pipeline, no new app code)*

- [x] 8.1 Self-contained landing spec authored *(copy inline in `state` — published pages render with no injection; anchor CTAs — no action handlers on `LivePage`; single language: English, default locale; validated by `validateSpec`)*
- [x] 8.2 Admin journey via MCP: logged in → imported spec in the playground → renamed *Landing page* / `landing` → published (`/landing` v1) → **Feature as root** in the admin console (badge + toast confirmed)
- [x] 8.3 Verified: `/` → `/en` renders the landing (h1, CTAs → `/en/ui` + `/en/signup`, sign-in → `/en/login`, playground pill, no prompt chrome); `/es` renders it too; responsive classes confirmed (`grid-cols-1 … sm:grid-cols-3`)
- [x] 8.4 e2e migration: playground entry moved from `/` to `/ui` (12 files mechanical; `locale.spec` + `live-pages.spec` root tests rewritten to the landing; `ui-routes` back-link now asserts the landing; `Clear`/`delete` in the playground now fall back to `/ui`, not the root)
- [x] 8.5 Full gate green: format, lint, tsc, **272 unit, 70 e2e**
