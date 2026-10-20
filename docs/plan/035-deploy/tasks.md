# Deploy — Tasks

Plan: `docs/plan/035-deploy/plan.md` (Status: draft — awaiting approval; 3 decisions needed from user first)

Legend: `[ ]` pending · `[~]` in progress · `[x]` done

Dependency: start after `rls-audit` (hard gate) and preferably after `e2e-hardening` (green suite = safer deploys).

## Phase 0 — Decisions

- [ ] 0.1 Host confirmed (Vercel unless overridden)
- [ ] 0.2 Production domain confirmed + DNS access
- [ ] 0.3 Email sender strategy confirmed (custom domain vs Supabase default to start)

## Phase 1 — Provision

- [ ] 1.1 Vercel project linked; bun build settings verified; first deploy of `main`
- [ ] 1.2 All `.env.example` vars set in host env (server-only stay server-side)
- [ ] 1.3 Supabase Auth: Site URL → prod domain; redirect URLs added; email sender configured
- [ ] 1.4 DNS records (domain, TLS, MX/SPF/DKIM if custom sender)
- [ ] 1.5 Prod DB: landing published + featured (MCP journey / seed helper)

## Phase 2 — Smoke & record

- [ ] 2.1 Fresh-account loop: signup → confirm email → login → generate → publish → live URL
- [ ] 2.2 Root shows landing; `/es` localized; admin gated; anon publish denied (RLS spot-check)
- [ ] 2.3 Client bundle secret scan
- [ ] 2.4 Runbook section (redeploy, env locations, key rotation) → README; plan → implemented
