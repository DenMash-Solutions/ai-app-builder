# UI Routes — Implementation Plan

**Status:** implemented
**Date:** 2026-10-08

## Goal

Make the active UI addressable: selecting or generating a UI must land the user on `/ui/[id]` (locale-prefixed, e.g. `/es/ui/<uuid>`). The URL becomes the source of truth for which history entry is open — deep-linkable, reload-safe, back/forward-friendly — instead of the current all-local `activeId` state on a single `/` page.

## Scope

### In scope

- Extract the whole `Playground` client component from `app/[locale]/page.tsx` into `components/playground/playground.tsx` (behavior unchanged) with an optional `initialId` prop
- New route `app/[locale]/ui/[id]/page.tsx` (client page, `useParams()`) mounting `<Playground initialId={id} />`; `/[locale]` keeps `<Playground />` as the clean landing
- Route-driven activation: on mount / id change, resolve the entry from localStorage history by id → activate (`setRestoredSpec` + `setActiveId`); neutral loading state until client resolution (history is localStorage-only, so resolution cannot happen during SSR/hydration)
- Not-found panel for unknown/deleted/foreign ids (title + explanation + link back to `/`); en/es i18n keys
- Redirects via locale-aware `useRouter` from `lib/i18n/navigation.ts` (`router.push("/ui/" + id)` — next-intl prefixes the locale):
  - generation completes (`onComplete` generate branch: `createEntry` → `addEntry`) → push `/ui/[id]` (user watches the stream on `/`, lands on `/ui/[id]` with the identical spec restored from the entry)
  - import JSON (`handleImportSpec`) → push (same path)
  - history drawer select (`handleSelect`) → push
  - delete active entry (`handleDelete`) / clear all history (`handleClear`) / clear current (`handleClearCurrent`) → push `/`
- Steer, prop edits, structural ops, undo/redo on `/ui/[id]` keep the same URL (entry id is stable across revisions)
- e2e: update generate/edit/restore flows for the URL change; add regression tests (generate → `/ui/<uuid>`; history select → URL switch; deep-link to missing id → not-found panel)

### Out of scope

- Temp/pending URLs for streaming (`/ui/pending`) — rejected 2026-10-08: ids exist only after `createEntry`; completion-time redirect is seamless and simpler (user-approved)
- Read-only preview mode at `/ui/[id]` — rejected 2026-10-08: user chose the full playground at the route
- Silent redirect home for missing ids — rejected 2026-10-08: user chose an explicit not-found panel
- Remember-last-UI auto-redirect on `/` — descoped 2026-10-08: `/` stays a clean landing; back button returns there with empty state (entry remains in history)
- Server-persisted UIs (localStorage remains the store; deep links work per-browser) — descoped 2026-10-08: out of this feature's range
- Query-param or hash fallbacks (`/?id=`) — descoped 2026-10-08: real path segment chosen
- Streaming progress display on the destination route — descoped 2026-10-08: navigation happens after the stream completes

## Design decisions

1. **URL as source of truth, one shared Playground** — the existing `Playground` state machine moves verbatim into `components/playground/playground.tsx`; `activeId`/`restoredSpec` local state were **deleted** (see decision 6). Rejected: duplicating the editor into a second page, because two copies of the 700-line state machine will drift; rejected: `/ui/[id]` redirecting to `/?id=` query state, because it defeats deep-linking and reload-safety
2. **Client-side resolution with a neutral loading gate** (as built: `useSyncExternalStore`, not a mount effect — superseded by decision 6) — `useState` initializers run during SSR/hydration and `window.localStorage` is unavailable there; the entry must resolve on the client after hydration, and until then the route renders a minimal neutral loading state — not the empty-state and not the not-found panel. Rejected: synchronous first-render resolution, because the hydration state would come from the server's empty history and never re-initialize; rejected: Suspense/read-from-server, because history is localStorage-only
3. **Redirect on completion, not on click** (user-approved 2026-10-08) — the generate flow streams on `/` exactly as today; `onComplete` commits the entry and `router.push("/ui/" + entry.id)`; the destination remounts `Playground`, whose route snapshot restores the identical spec from the entry (one-frame transition through the loading gate). Rejected: navigate-immediately to a pending URL, because it needs temporary ids, cancel handling, and a second streaming surface
4. **Not-found panel, no silent redirect** (user-approved 2026-10-08) — unknown/deleted/foreign ids render an explanatory panel with a localized link back to `/` (`router.replace` not used: the user keeps the URL context until they choose). Rejected: silent `replace("/")`, because a mistyped or stale link should explain itself
5. **Locale-aware navigation through next-intl** — `useRouter` from `lib/i18n/navigation.ts` (`createNavigation(routing)`); pushes use unprefixed paths (`/ui/${id}`), the library prefixes the active locale (`localePrefix: "always"`). Rejected: raw `next/navigation` router, because it would drop the `/es` prefix
6. **Compiler-compliant derivation instead of state+effect** (as-built 2026-10-08, forced by `react-hooks` React-Compiler lint: "setState synchronously within an effect" is an error) — the entry is a second `useSyncExternalStore` over the history store (`getServerSnapshot → undefined` = pending, client snapshot = entry-or-null); `displayedSpec = isStreaming ? streamSpec : (routeEntry?.spec ?? streamSpec)`; `activeId` → `routeId`, `activeEntry` → `routeEntry`, revision commits are just `updateEntry` (the subscription re-derives); selection resets use the react.dev guarded render-time adjustment on `routeId` change. This also removed the local activeId/restoredSpec sync surface entirely. Rejected: keeping the mount-effect design and suppressing the lint, because the compiler rules are the project standard; rejected: `useState`+`useLayoutEffect` resolution, because it is the same flagged pattern plus SSR-warning noise
7. **e2e synchronizes on the post-generate URL** (as-built 2026-10-08) — the redirect remounts the playground, so any tool click (pick/x-ray/clear/steer/drawer) that lands on the pre-redirect instance is lost on unmount; tests wait for `toHaveURL(/\/ui\/[0-9a-f-]{36}$/)` after every generation before interacting. Rejected: app-side state lifting across the remount, because the URL contract intentionally scopes state per route and real users cannot click within the navigation frame

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build && bun run test:e2e` — **green**: 202 unit / 618 assertions, build compiled, **43/43 e2e** (×2 consecutive runs; was 40)
- [x] e2e updated: history delete/clearAll now assert the landing fallback + reopened empty drawer; reload-after-generate asserts the deep-linked spec instead of the empty state; generate helpers in editor/state/runtime-classes/history/errors/json-io/ui-routes wait for the /ui/[id] URL
- [x] e2e new (`e2e/ui-routes.spec.ts`): generate → `/ui/<uuid>` + reload deep-link restore; history drawer select switches the URL to the selected entry; fabricated id → not-found panel with working back link
- [x] MCP spot-check (browser at `/es`): import JSON → `/es/ui/da68ca97-…` with heading rendered; reload keeps the spec; delete active → `/es` landing + empty state; fabricated id → Spanish not-found panel (screenshot); back link → `/es` empty state; locale prefix preserved on every route
- [x] en/es message parity for `uiRoute.*` keys (constants wire en.json into e2e)

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-08 | plan drafted (research: single-page playground, localStorage history with stable ids, next-intl `createNavigation` available) |
| 2026-10-08 | approved — three clarifying answers: full playground at `/ui/[id]`, redirect on completion, explicit not-found panel |
| 2026-10-08 | implemented — mount-effect resolution replaced mid-implementation by compiler-compliant `useSyncExternalStore` derivation (decision 6); React-Compiler lint clean; chain green (202 unit / 618, build, **43 e2e** ×2); MCP verified all six flows incl. not-found screenshot |
| 2026-10-08 | e2e race hardening (decision 7) — post-generate redirect remounts the playground; tests that clicked tools/reload/drawer before the navigation committed failed intermittently under parallel load; all generation sites now wait on the /ui/[id] URL |
