# React Inline Scripts & Pre-Paint State (Next.js)

> **Lesson source**: "Encountered a script tag while rendering React component" warning in `app/[locale]/layout.tsx` (theme init script). Official guide: `node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md` (read Next docs in `node_modules/next/dist/docs/` first — AGENTS.md rule).

## Problem Description

- React 19 **never executes** `<script>` tags it creates on the client, and warns in dev:
  "Encountered a script tag while rendering React component…"
- The warning fires on any **client re-create** of the script: Fast Refresh error recovery, Strict Mode remounts, full-tree client re-renders — NOT on normal hydration
- Moving the script from `<body>` to `<head>` does **not** silence it (React's `isScriptDataBlock` check is type-based, not location-based)
- A raw script rendered from a **Server Component** can't self-fix: the RSC payload carries the server-computed props, so the client never re-evaluates `typeof window`

## Solution Steps

1. **Client component wrapper** — the `type` expression must evaluate in both environments (SSR + client), so the script must be rendered from a client component (`components/theme-init.tsx` pattern)
2. **Type trick** (official guide):

   ```tsx
   "use client";

   export function ThemeInit() {
     return (
       <script
         type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
         suppressHydrationWarning
         dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
       />
     );
   }
   ```

   - Server → `text/javascript`: browser executes it while parsing HTML (before paint, no flash)
   - Client → `text/plain`: React's `isScriptDataBlock()` returns true → no warning; script is inert (doesn't need to re-run)
   - `suppressHydrationWarning` absorbs the `type` attribute mismatch
3. **Place in `<head>`** — runs before any body content paints (guide's Themes example)
4. **Dev Strict Mode guard** — React's dev remount resets attributes it manages from JSX (including `<html>` className), clearing the script-set class. Re-apply in `useLayoutEffect` (`applyStoredTheme()` in `lib/theme/theme.ts`)

## Verification

- Reproduce the client re-create path with a transient render error (undefined identifier) → Fast Refresh recovery → console must stay clean
- Console messages reset on navigation: use `list_console_messages` with `includePreservedMessages: true` to inspect across reloads
- Two-step edits (remove a const, then its usage) cause transient HMR `ReferenceError`s — apply import + usage changes in a **single atomic edit**

## Prevention Strategies

- Never render a raw executable `<script>` from React — use the client-component `type` trick
- Check `node_modules/next/dist/docs/` guides for hydration/flash topics before inventing patterns
- `isScriptDataBlock`: JS MIME types (`text/javascript`, `module`, …) → warns; any other type (`text/plain`, `text/template`) → safe data block

## Memory Triggers

- Warning "Encountered a script tag" → client component + `type` trick from the guide
- About to add an inline script to a layout → read `preventing-flash-before-hydration.md`
- Theme/pre-paint state flashing → inline script in `<head>` + `useLayoutEffect` dev guard
- HMR `X is not defined` during edits → edit import + usage atomically
