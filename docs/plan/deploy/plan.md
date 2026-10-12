# Deploy — Production Launch — Implementation Plan

**Status:** draft
**Date:** 2026-10-12

## Goal

Ship the app to a public URL: hosted Next.js build, a production Supabase configuration (env, auth URLs, deliverable email), the real landing published and featured, and a recorded smoke run proving the full loop (signup email → login → generate → publish → live URL → root shows the landing) works end-to-end outside this laptop.

## Context

- Secrets audit + `.env.example` restoration already document every variable the app reads (server + `NEXT_PUBLIC_*` + optional per-provider).
- The landing publish + feature journey has been executed once via MCP against this database; the production database needs the same run (or the `e2e-hardening` seed helper).
- Supabase Auth currently has no production Site URL/redirect config and no custom email sender — without both, signup confirmation links point at localhost and land in spam (or bounce).
- `rls-audit` should be complete **before** the URL goes public (ordering dependency recorded below).

## Decisions needed (blockers, user)

- [ ] Hosting target — **Vercel** recommended (Next.js 16 native; alternatives: self-host Fly/Railway)
- [ ] Production domain (candidate: a `denmash.com` subdomain, e.g. `ai.denmash.com` — user's call)
- [ ] Email sending: custom SMTP/sender domain with DNS records (MX + SPF/DKIM) vs. provider-managed (Supabase's default rate-limited SMTP is fine to *start*, upgrade if deliverability bites)

## Scope

### In scope

1. **Host setup** — Vercel project linked to the repo; build settings verified (`bun` lockfile); production branch = `main`.
2. **Env provisioning** — all `.env.example` variables set as host env vars (server-only where required); client bundle spot-check: no secrets leak.
3. **Supabase production config** — Auth Site URL → prod domain; additional redirect URLs (login, magic-link/confirm paths as used); email sender name/address.
4. **DNS + email** — domain added, TLS, email DNS records (if custom sender chosen).
5. **Production data** — publish + feature the landing on the prod DB (MCP journey or `e2e-hardening` seed helper with service-role key).
6. **Post-deploy smoke** (recorded in the status log): signup email arrives and confirms; login works; generate → publish → live URL renders; `/` shows the landing; `/es` shows Spanish overlay (after `spec-languages`); admin console reachable only when admin.
7. **README/runbook note** — one short section: how to redeploy, where env vars live, how to rotate keys.

### Out of scope

- CI/CD pipelines (PR gates, preview deploys) — v1 is deploy-from-`main`; pipelines are a later convenience (2026-10-12)
- Monitoring, error alerting, analytics — none configured; revisit after real users (2026-10-12)
- Automated prod e2e — local suite only; post-deploy smoke is manual + MCP (2026-10-12)
- Custom email templates/branding — Supabase defaults acceptable at launch (2026-10-12)

## Design decisions

1. **Vercel over self-hosting** — rejected: Fly/Railway containers (more ops surface — SSR host, HTTPS, restarts — for zero product benefit at this stage).
2. **Deploy ordered *after* `rls-audit`** — rejected: shipping first and auditing later (the admin surface and public `published_pages` projection would be live while holes are still unknown).
3. **Auth emails via a real sending domain** — rejected: default Supabase SMTP long-term (rate limits + shared IP reputation break confirmation flows; OK as a temporary start).
4. **Prod landing via the same MCP journey** (or seed helper), not a one-off SQL script — rejected: bespoke manual SQL (drifts from the tested path; the journey *is* the smoke test).

## Verification

- [ ] `curl` / browser: prod root renders the featured landing; live URL serves; `/es` localized (post `spec-languages`)
- [ ] Fresh-account loop on prod: signup → confirm email → login → generate → publish → open live URL
- [ ] Client bundle scan: no server secrets (`grep` built assets for service-role/JWT values)
- [ ] Anonymous `/admin` and anon publish attempts rejected (spot-check of RLS in prod)
- [ ] Redeploy from `main` reproduces cleanly; runbook section committed

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-12 | plan drafted |
