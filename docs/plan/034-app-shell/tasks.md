# App Shell — Tasks

Plan: `docs/plan/034-app-shell/plan.md` (Status: implemented)

Legend: `[ ]` pending · `[~]` in progress · `[x]` done

## Phase 1 — Shell frame

- [x] 1.1 `components/shell/app-shell.tsx`: sidebar via the **shadcn Sidebar** (desktop rail + mobile sheet), brand → `/{locale}`, nav links with active-route state; i18n strings (en/es)
- [x] 1.2 Route layouts `app/[locale]/ui/layout.tsx` + `app/[locale]/admin/layout.tsx` wrap children in the shell; `/ui/[ref]` inherits; login/signup/landing/preview/live untouched (`SidebarInset` owns the `<main>` landmark — canvas pages render containers, `SpecPage` gained `main={false}` for the admin route)
- [x] 1.3 Live pages nav item gated on `role === "admin"`

## Phase 2 — Account menu & sign-out

- [x] 2.1 Account block: anonymous → "Sign in" (`/{locale}/login`); authenticated → avatar + email in a **DropdownMenu** trigger (canonical `NavUser` pattern — a Popover trigger did not open through the `SidebarMenuButton asChild` chain; DropdownMenu does)
- [x] 2.2 Sign out via `AuthProvider.signOut()` → redirect `/{locale}`; local history untouched (verified: 17/17 entries survive)
- [x] 2.3 Sync engine: session-loss path (sign-out mid-debounce) settles to idle — unit test added in `lib/history/sync.test.ts`

## Phase 3 — Guard UX

- [x] 3.1 Anonymous `/admin` → `/{locale}/login?next=…`; login honors the return path (open-redirect-guarded, read from `window.location` at click time)
- [x] 3.2 Non-admin authenticated `/admin` → redirect home (unchanged behavior)

## Phase 4 — Verification

- [x] 4.1 MCP journey (2026-10-12): login → Live pages nav + account menu shows email + Admin → sync "Saved to account" → sign out → root landing, token removed, 17/17 local UIs intact → anon `/admin` bounces to `login?next=%2Fen%2Fadmin` → sign-in returns to `/en/admin`, console renders
- [x] 4.2 Anonymous + mobile checks: `e2e/shell.spec.ts` (5 tests — sidebar anon/locale/chrome-less public surfaces/mobile sheet) + desktop + mobile screenshots
- [x] 4.3 Full gate: `format | lint | tsc | test (273) | build | test:e2e (75)` — all green

## Phase 5 — Feedback round (2026-10-12)

- [x] 5.1 Collapsible like the examples: `collapsible="icon"` + `SidebarRail` + collapsed tooltips (`TooltipProvider` — the installed Sidebar uses Tooltip without shipping a provider); collapse trigger moved into the sidebar header (right of the brand when open, under the brand icon when collapsed, doubles as the mobile sheet close); the mid-edge desktop handle was removed
- [x] 5.2 Icon alignment: nav wrapped in `SidebarGroup` (its `p-2` matches header/footer); DOM-verified — brand/nav/trigger all center at x=24
- [x] 5.3 Session-aware auth pages: login/signup render a placeholder while the session settles, then redirect signed-in visitors to `?next=` ?? `/{locale}/ui` (`useAuthedRedirect` + `lib/auth/next-path.ts`); MCP-verified `/en/login` → `/en/ui` with no form flash
- [x] 5.4 Root account cluster (`components/shell/public-account-cluster.tsx`): authed-only avatar menu on the featured root → Playground / Live pages / Sign out; MCP-verified root → `/en/admin`
- [x] 5.5 Gate re-run: `format | lint | tsc | test (273) | build | test:e2e (75)` — all green
