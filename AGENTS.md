<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# ai-app-builder

Next.js 16 (App Router) + React 19 + TypeScript app styled with Tailwind CSS 4 — a starter for building AI-powered apps.

## Package manager (bun only)

- Install: `bun install`
- `bun.lock` is the only lockfile (`package-lock.json` must not exist)

## Commands

| Command | Script |
| ------- | ------ |
| `bun run dev` | `next dev` (dev server) |
| `bun run build` | `next build` |
| `bun run start` | `next start` |
| `bun run lint` | `eslint` |
| `bun run test` | `bun test` (unit tests) |
| `bun run test:e2e` | `playwright test` |

Before finishing any change: `bun run lint && bunx tsc --noEmit && bun run test`.

## Structure

- `app/` — Next.js App Router: `layout.tsx`, `page.tsx`, `globals.css`, `favicon.ico`
- `public/` — static assets (SVGs)
- Config at root: `next.config.ts`, `tsconfig.json`, `eslint.config.mjs` (flat config), `postcss.config.mjs`
- `CLAUDE.md` contains `@AGENTS.md` (reference alias)
- `components/`, `lib/` — shared UI and utilities; create as needed and colocate feature code
- `docs/plan/` — per-feature implementation plans (mandated by `.agents/rules/feature-plan.md`)

## Git commits

- Commit messages end at their last line: **never add AI attribution** — no `Generated with` line, no `Co-Authored-By`, no co-author trailers
- Commit bodies are always a bullet list (subject, blank line, `-` bullets)

## Session memory (mandatory)

`.agents/memory/active-work.md` is the cross-session, **gitignored** working
state (never stage it). Update it **in the same turn**:

- on **every status request** — refresh it first, then answer from it
- after **every finding** (bug, gotcha, decision, migration applied)
- after **every completion** (task, gate run, commit, plan status change)

Full protocol: `.agents/rules/session-memory.md` (always-on via `instructions`
in `opencode.json`). The plan file (`docs/plan/{NNN}-…/plan.md`) stays the
long-form design source — the memory file points at it, it does not
duplicate it.

## Rules and lessons

- Always-on rules load from `.agents/rules/` (wired via `instructions` in `opencode.json`)
- Lessons in `.agents/lessons/` are lazy — read the relevant one before implementing (start with `lessons/implementation-checklist.md` and `rules/my-mistakes.md`)
- Session memory updates are enforced — see `rules/session-memory.md` (status / finding / completion → `.agents/memory/active-work.md` same turn)
- Commands: `/learn`, `/review`, `/gen-commit`, `/devtools-error-scan` (in `.opencode/commands/`)
