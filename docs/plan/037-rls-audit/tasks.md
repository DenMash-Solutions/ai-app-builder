# RLS Audit — Tasks

Plan: `docs/plan/037-rls-audit/plan.md` (Status: draft — awaiting approval)

Legend: `[ ]` pending · `[~]` in progress · `[x]` done

- [ ] 1.1 Inventory: dump every table × policy × role via MCP → `docs/security/rls-audit.md` skeleton
- [ ] 1.2 Adversarial battery round 1 (anon / user A vs user B / admin): role escalation on `profiles`, cross-user `uis` + `page_versions`, anon writes, `published_pages` write-denial, `site_settings` write, `auth.users`/views/functions exposure, realtime channels
- [ ] 1.3 Supabase security advisories + logs review → findings appended with severity
- [ ] 1.4 Fixes for every finding (SQL via MCP), each paired with its proving query
- [ ] 1.5 Battery round 2: full re-run, all pass / documented as intended
- [ ] 1.6 Report finalized + committed; gates green; plan → implemented
