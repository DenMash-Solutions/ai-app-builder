# Live Pages — Supabase Accounts, Publishing & Featured Root — Implementation Plan

**Status:** approved
**Date:** 2026-10-11

## Goal

Turn the playground into a 3-stage funnel: **trial** (anonymous, localStorage) → **account** (registered, UIs sync to Supabase) → **live** (user publishes specific versions of their UIs as shareable pages; admins feature one as the root `/{locale}` page). A user can have several live pages (barber shop, coffee shop, …); only `role=admin` can change the root.

## Context

- Supabase project exists and is healthy: **`ai-app-builder`** (`rfgmupbktannfedkqypq`, `us-east-1`) in `Mario's Org` — no new project needed.
- Supabase Auth admin credentials (email + password) were provided by the user — they live **only** in Supabase Auth / local `.env.local` (gitignored) and are **never committed**.
- Today's app is localStorage-only; anonymous behavior must remain byte-for-byte unchanged (except the new signup banner).

## Scope

### In scope

1. **Supabase wiring** — `@supabase/ssr` (cookie session) + `@supabase/supabase-js`; browser client, server client, and session refresh in `proxy.ts` (Next 16's middleware replacement); env in `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
2. **Auth** — `/login` and `/signup` are **json-render specs** (committed, AI-generated like the admin — see standing rule below), rendered with the registry and wired to Supabase Auth actions (login, signup, resend confirmation, session persistence); **email confirmation required** on signup → "check your email" screen; session persists across reloads via refresh-token cookies; auth context exposing `user` + `role`.
3. **Spec-mandate standing rule** (user amendment 2026-10-11): *every page added from here on is a json-render spec rendered via `Renderer` + registry* — it dogfoods and hardens the render engine. Spec pages are editable in the playground **from the admin context only** (user amendment 2026-10-11: editing committed pages is an admin capability — the affordance lives on the admin page, not on public pages like login/signup).
3. **Schema + RLS** (SQL applied via Supabase MCP, after inspecting current state):
   - `profiles` (mirrors `auth.users`, `role: user|admin`, created via trigger on signup)
   - `uis` — private drafts: `owner_id, name, slug, prompt, revisions jsonb, head, updated_at`, **unique (owner_id, slug)** — per-user slug uniqueness (Q6)
   - `page_versions` — immutable publish snapshots per UI (`version, spec, label, published_at`), private to owner/admin — **version tracking** (Q3)
   - `published_pages` — the **public projection**: `ui_id (PK), owner_id, slug UNIQUE (global), name, version, spec, published_at` — anon may `SELECT` only; this table is the "domain registry" (Q6: availability validated at publish, DB unique constraint is the backstop)
   - `site_settings` — singleton, `featured_ui_id → published_pages(ui_id) on delete set null`; write only for `role=admin` (Q2)
   - RLS: drafts/versions owner-or-admin only; anon sees only `published_pages`; publish = `auth.uid()` required (Q: anon never reaches Supabase)
4. **Auto-sync engine** (Q7) — local-first; when a session exists, debounce-and-push entry changes (create/update/delete/rename) to `uis`; merge on login (`updated_at` LWW; local-only entries upload, remote-only download); "Saved to account / Syncing / Offline" status dot in the top bar; on first login a banner *"Upload your N local UIs to your account?"*.
5. **Publish flow** — per-UI actions in the **history drawer rows** (flagged below): *Go live* dialog with slug field prefilled from the draft slug, **globally validated like a domain** (debounced availability query + unique constraint), version = snapshot of the currently selected revision → `page_versions` + `published_pages` upsert; *Unpublish* deletes the public row (versions retained); live URL shown/linked. Requires login — anonymous users see a signup CTA instead.
6. **Root page at `/{locale}`** (Q1) — server-fetch `site_settings.featured` → render the published spec chrome-less with a floating "Open playground" pill; `generateMetadata` from the live page name. **No featured page → today's playground landing** (keeps all current e2e green). New `/{locale}/ui` route hosts the landing permanently so the pill always has a target (slug `ui` was already reserved for this).
7. **Admin page at `/{locale}/admin`** — **admin-only** (route guard + RLS, Q2); renders a **once-generated, committed AI json-render spec** (Q5: generated with the model during development, refined, committed under `lib/specs/` — zero runtime model calls) with wired actions: list all `published_pages` as cards (name, owner, slug, version, live preview thumbnail, featured badge), **feature / unfeature**, open live link.
8. **Slug reservations** — `RESERVED_SLUGS` += `admin`, `login`, `signup` (preview-route collisions).
9. **Anonymous conversion banner** on the playground: "Sign up to keep your UIs" → `/{locale}/signup`.
10. **HistoryEntry** gains `updatedAt` (LWW merge needs it; `normalizeEntry` back-fills).

### Out of scope (v1)

- Email templates/branding (Supabase defaults), password reset flows — reschedule if asked
- Realtime multi-device sync / conflict UI (last-write-wins only)
- Per-locale featured pages (one root page for all locales)
- Version browser/rollback UI (versions are tracked in DB; UI comes later)
- OAuth/social login, orgs/teams, billing
- Admin as AI *chat* (admin is an AI-generated static spec only)
- Saving playground edits of spec pages back into the repo (import-only for now)

## Design decisions

1. **Public content lives in its own table (`published_pages`)** — rejected: column filters on `uis` — RLS can't hide draft columns on an anon row, so drafts would leak through a "public" row.
2. **Publish snapshots (immutable rows) rather than publishing a revision index in place** — rejected: index reference — local revision trimming (`MAX_REVISIONS=10`) could destroy a published version; snapshots are also what "versions" means to your users.
3. **Published slug may differ from the draft slug** — per-user drafts can collide privately; publish demands global availability like a domain, so the dialog prefill is editable and validated (first-to-publish wins).
4. **Root falls back to the current landing when nothing is featured** — rejected: placeholder page — keeps e2e green and the app useful from minute one.
5. **`/{locale}/ui` becomes the permanent playground landing** — root is taken by the featured page; the already-reserved `ui` slug finally gets its route (matches the post-generate `/ui/{id}` prefix naturally).
6. **AI-generated admin spec is committed once** (user Q5) — deterministic, no latency or model-key dependency per page view; genuinely model-generated during the build.
7. **Auto-sync is local-first** (user Q7) — Supabase is a persistence layer, not the working copy; the app stays instant and offline-friendly, sync is fire-and-forget with a status dot.
8. **Every new page is a committed json-render spec** (user mandate 2026-10-11) — login, signup, admin (and existing preview/root) render through the same engine; each addition is a stress test that hardens the catalog. Rejected: hand-written forms — they bypass the engine the product exists to improve.
9. **Spec-page editing is an admin capability** (user amendment 2026-10-11) — the "Edit in playground" affordance (`EditInPlaygroundPill`, imports the committed spec as a local playground entry) is surfaced from the admin page behind the admin guard; public spec pages (login, signup) render clean. Rejected: pill on every page — non-admin visitors have no business editing auth screens; save-back-to-source is out of scope either way.

## Implementation steps (phases, each keeps lint/tsc/tests green)

1. **Foundation**: env vars, `@supabase/ssr` clients, session refresh in `proxy.ts`, auth context/provider; spec-rendered login/signup pages + confirmation screen + session persistence.
2. **Schema**: inspect project state → apply SQL (`profiles` trigger, `uis`, `page_versions`, `published_pages`, `site_settings`) → RLS policies → create admin user (email confirmed, `role=admin`; password never stored in repo).
3. **Sync**: `lib/history/sync.ts` (unit-tested merge/queue with mocked client), status dot, first-login upload banner, anon signup banner.
4. **Publish**: history-drawer row actions, Go-live dialog (global slug validation + version snapshot), unpublish, live-URL link; i18n en/es.
5. **Root**: featured server fetch + chrome-less render + pill; `/{locale}/ui` landing route; reserved slugs.
6. **Admin**: generate spec once with the model, refine + commit under `lib/specs/`; `/{locale}/admin` guard + renderer + handlers (feature/unfeature).
7. **Spec form primitives**: audit `Input`/`Textarea` state binding, submit actions, and field validation against the auth specs; extend the catalog/registry if the engine lacks them (part of the mandate's engine-hardening goal); "Edit in playground" pill component shared by all spec pages.
8. **Verification**: full chain + MCP end-to-end journey (signup → confirm via dashboard → publish → fresh-browser visit to `/{slug}` → feature → root shows it → anon sees it).

## Verification

- [ ] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bunx playwright test`
- [ ] Unit: sync merge (LWW, upload/download), slug availability helper, reserved slugs incl. `admin|login|signup`, `updatedAt` back-fill
- [ ] e2e (anonymous paths only — no live Supabase in CI): existing 64 stay green, root fallback = landing, login/signup render, reserved slug → not-found, signup banner appears/dismisses on auth
- [ ] MCP journey on real project: full funnel incl. admin feature + root change
- [ ] `git log` shows **no** credentials, `.env.local` untracked

## Decisions (user-answered 2026-10-11)

1. Root page lives at **`/{locale}`**
2. **Only `role=admin`** can open `/admin` and change the root page
3. UIs are **private until the user publishes a specific version** → version tracking required
4. Signup open to all, **email confirmation required**
5. Admin UI spec **generated by AI once** and committed
6. Slugs **unique per user**; global availability validated **at publish time** (domain-style)
7. Sync strategy: **automatic background sync** when logged in

## Resolved points

- Publish/unpublish entry point = **per-row actions in the history drawer** (dialog for slug/version) — confirmed by user 2026-10-11 ("for now we use history, we can work on sites later"); dedicated `/sites` page deferred to v2.

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-11 | discovery completed — 7 questions answered (root route, admin-only, publish+versions, email confirmation, one-time AI spec, per-user slugs with publish-time availability, auto-sync) |
| 2026-10-11 | plan drafted; existing Supabase project `ai-app-builder` located (ACTIVE) |
| 2026-10-11 | plan **approved**; publish entry point confirmed (history drawer, sites page later) |
| 2026-10-11 | standing rule amendment: **all new pages are rendered specs** (login/signup included) + every spec page is editable in the playground — plan updated (scope, decisions 8-9, step 7) |
