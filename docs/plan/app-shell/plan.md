# App Shell — Sidebar Navigation & Account Menu — Implementation Plan

**Status:** implemented
**Date:** 2026-10-12

## Goal

Give the app persistent navigation and make authentication state visible everywhere it matters. Today the sync dot (playground top bar only) is the sole session indicator, there is no sign-out anywhere, and `/admin` is reachable only by typing the URL — anonymous visitors are silently bounced to the root. A left sidebar wraps the app routes with global navigation (brand → home, Playground, Live pages for admins) and an account block (sign-in button when anonymous; avatar + email + role + **Sign out** when authenticated).

## Context

- `AuthProvider` already exposes `user` (email), `role` (`user | admin`), `loading` — the account menu is pure composition.
- Route tree has no layouts besides the root: `app/[locale]/ui/layout.tsx` and `app/[locale]/admin/layout.tsx` are the insertion points.
- Public surfaces stay chrome-less by design: landing (featured), live URLs, previews keep only the pill; login/signup stay centered cards.
- Playground has a canvas-docked tool rail (Pick/Drag/X-ray/Clear) — the sidebar is global chrome, they don't compete; the top bar keeps page-local controls (rename, preview, model, history).

## Scope

### In scope

1. **`AppShell` sidebar** — shadcn Sidebar with `collapsible="icon"` on desktop (header trigger + `SidebarRail` + collapsed-state tooltips) and a sheet drawer on mobile (edge-tab opener, in-sheet close); brand → `/{locale}`; nav: Playground (`/ui`), Live pages (`/admin`, rendered only when `role === "admin"`).
2. **Account block** — anonymous: "Sign in" → `/{locale}/login`; authenticated: avatar/initials + email + role chip, popover with **Sign out** (`supabase.auth.signOut()`), then redirect to `/{locale}`.
3. **Sign-out semantics** — local history stays local (entries are never deleted), sync engine reverts to the anonymous state, sync dot reflects it. The stale-session path must be covered by the sync engine (session loss mid-debounce).
4. **Admin guard UX** — anonymous hitting `/admin` redirects to `/{locale}/login` with a return path instead of the silent root bounce; non-admin authenticated keeps today's behavior (redirect home).
5. **Wiring** — route layouts wrap `/ui/**` and `/admin`; i18n strings (en/es) for nav + account menu; active-route highlighting.
6. **Session-aware auth pages** (2026-10-12, user feedback) — login/signup never render the form for a signed-in visitor: placeholder while the session settles, then redirect to `?next=` or `/{locale}/ui`; shared open-redirect-guarded `safeNextPath` moved to `lib/auth/next-path.ts`.
7. **Root account cluster** (2026-10-12, user feedback) — the featured root gains an authed-only avatar menu (Playground, Live pages, Sign out) so the owner can reach the app chrome from the chrome-less landing; anonymous visitors still see pure content.

### Out of scope

- Moving locale/theme controls out of the top bar — keep in place for v1, revisit with usage (2026-10-12)
- Per-page admin sections / nested nav — single admin page today (2026-10-12)
- Authenticated e2e coverage of sign-out — lives in the `e2e-hardening` plan (sign-out test lands there) (2026-10-12)
- Shell on live/featured/preview pages — chrome-less is a product decision, unchanged; exception: an authed-only account cluster floats on the featured root (2026-10-12, user request) — live/preview URLs untouched (2026-10-12)

## Design decisions

1. **Sidebar via route layouts, not a root-layout shell** — rejected: wrapping everything in `app/[locale]/layout.tsx` (would put chrome on the landing and live pages, breaking the public content model).
2. **Sign-out clears session only, never local data** — rejected: wiping history on sign-out (data loss for shared machines is worse than lingering drafts; entries are private until synced).
3. **Admin link hidden for non-admins (and `/admin` redirect preserved)** — rejected: showing a locked nav item (noise; the guard stays as defense-in-depth alongside RLS).
4. **Account state from `useAuth`, no new data layer** — rejected: a second user context (role/user already resolved and cached).
5. **Collapse-state restore deferred** (2026-10-12) — stock shadcn Sidebar writes the `sidebar_state` cookie but never reads it (verified against the official radix-nova registry source), so a reload resets to expanded, exactly like the examples. Reading the cookie back is a deliberate deviation — parked until asked for.

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build && bun run test:e2e`
- [x] MCP journey: login → sidebar shows email + Admin chip + Live pages nav → sign out → dot reverts, history intact, `/admin` bounces to login
- [x] Anonymous: sidebar shows Sign in; `/admin` → login with return path; landing/live/preview remain chrome-less
- [x] Mobile viewport: sidebar collapses to drawer, playground tool rail unaffected

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-12 | plan drafted |
| 2026-10-12 | implemented — full gate green (273 unit / 75 e2e incl. 5 new shell tests, lint, tsc, build); MCP admin journey verified end-to-end (login → admin nav + account menu → sign-out with intact history → `?next=` guard round-trip). Built on the shadcn Sidebar (`bunx shadcn add sidebar`), DropdownMenu account menu per the canonical `NavUser` pattern |
| 2026-10-12 | feedback round: `collapsible="icon"` + `SidebarRail`, trigger moved into the sidebar header (placement), nav wrapped in `SidebarGroup` (icon alignment), session redirect on login/signup (no form flash), authed-only account cluster on the featured root; gate re-run green |
