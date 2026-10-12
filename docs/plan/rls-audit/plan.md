# RLS Audit — Adversarial Review & Fixes — Implementation Plan

**Status:** draft
**Date:** 2026-10-12

## Goal

Formally review the Row Level Security policies written in the live-pages Phase 2 against an adversarial checklist before anything is deployed publicly. The earlier secrets audit covered keys and committed files; this one covers **row access**: who can read/write each table, whether privilege escalation is possible, and whether the anon surface exposes anything beyond the intended public projection.

## Context

- Tables from Phase 2: `profiles` (role mirror + trigger on signup), `uis` (private drafts, unique per owner+slug), `page_versions` (private snapshots), `published_pages` (public projection, anon SELECT), `site_settings` (singleton featured pointer, admin write).
- Auth context resolves `role` from `profiles`; admin console relies on a **client-side** guard — RLS is the actual backstop.
- Review runs via Supabase MCP (introspection + adversarial queries against the live project) plus the platform's security advisories.

## Scope

### In scope

1. **Policy inventory** — every table × policy × role (anon / authenticated / admin) documented in `docs/security/rls-audit.md`.
2. **Adversarial battery** (run as anon, as user A, against user B's rows, as admin):
   - **Role escalation**: can a user `UPDATE profiles SET role='admin'` on their own row? (Owner-writable columns must exclude `role`.)
   - Cross-user reads/writes: `uis`, `page_versions` for B's ids.
   - Anon writes anywhere (expect: none — publish requires `auth.uid()`).
   - `published_pages`: anon SELECT is by design; confirm anon **cannot** write, and drafts never leak through it.
   - `site_settings`: anon/authenticated write denied; only `role=admin`.
   - `auth.users` exposure; any exposed views/functions; realtime channel access.
3. **Supabase security advisories + logs review** (platform tooling) folded into the report.
4. **Fixes applied** for every finding, then re-run of the battery.
5. **Report** — findings, severity, fix, verification query per item.

### Out of scope

- App-layer guards (client redirect in admin) — kept as UX, not security (unchanged)
- Email/auth flow hardening (password reset, confirmation token semantics) — separate if asked (2026-10-12)
- Pen-testing beyond the data layer (host infra) — covered by the deploy plan's checklist (2026-10-12)

## Design decisions

1. **Adversarial queries executed through the MCP connection as real roles** — rejected: reading policy DDL only (policies can be correct in text and still bypassed via exposed functions or missing grants).
2. **One report file as the durable artifact** (`docs/security/rls-audit.md`, committed) — rejected: chat-only findings (no trace rule).
3. **Any fix lands with the query that proved the hole** — rejected: fixes without regression proof.

## Verification

- [ ] Full adversarial battery re-run post-fix: every item passes or is documented as intended behavior
- [ ] Advisories reviewed, zero unresolved high/medium findings
- [ ] `docs/security/rls-audit.md` committed with per-finding verification queries
- [ ] `bun run test` (data-layer unit tests unaffected) + existing e2e green

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-12 | plan drafted |
