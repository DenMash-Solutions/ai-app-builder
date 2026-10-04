# Commit Plan

Generated: 2026-10-04

## Summary

- Total commits: 4
- Files to commit: 27 (commit-plan.md stays untracked — scratch file)
- Format verified before committing: `bun run format` + `format:check` ✓

## Commits

### Commit 1: chore(deps): add prettier and next-intl

**Files:**
- package.json
- bun.lock

**Command:**
```bash
git add package.json bun.lock
git commit -m "chore(deps): add prettier and next-intl"
```

**SHA:** _pending_

---

### Commit 2: style: add prettier configuration and format codebase

**Files:**
- .prettierrc
- .prettierignore
- .vscode/settings.json
- app/globals.css
- components/ui/alert.tsx
- components/ui/badge.tsx
- components/ui/button.tsx
- components/ui/card.tsx
- components/ui/drawer.tsx
- components/ui/input.tsx
- lib/utils.ts
- e2e/global-setup.ts
- e2e/playground.spec.ts
- e2e/history.spec.ts

**Command:**
```bash
git add .prettierrc .prettierignore .vscode app/globals.css components/ui lib/utils.ts e2e/global-setup.ts e2e/playground.spec.ts e2e/history.spec.ts
git commit -m "style: add prettier configuration and format codebase"
```

**SHA:** _pending_

---

### Commit 3: refactor(e2e): use @ alias for cross-folder imports

**Files:**
- e2e/helpers.ts
- e2e/msw/fixture.ts

**Command:**
```bash
git add e2e/helpers.ts e2e/msw/fixture.ts
git commit -m "refactor(e2e): use @ alias for cross-folder imports"
```

**SHA:** _pending_

---

### Commit 4: feat(i18n): add en/es locale routing with next-intl

**Files:**
- proxy.ts
- next.config.ts
- lib/i18n/routing.ts
- lib/i18n/navigation.ts
- lib/i18n/request.ts
- lib/i18n/locale/en.json
- lib/i18n/locale/es.json
- lib/history.ts
- app/[locale]/layout.tsx
- app/[locale]/page.tsx
- app/layout.tsx (deleted)
- app/page.tsx (deleted)
- components/locale-switcher.tsx
- components/history-drawer.tsx
- e2e/constants.ts
- e2e/locale.spec.ts

**Command:**
```bash
git add -A
git commit -m "feat(i18n): add en/es locale routing with next-intl"
```

**SHA:** _pending_

---

## Validation

- [x] All tests pass (format:check, lint, tsc, build, 7/7 e2e)
- [x] No secrets committed
- [ ] All commits executed successfully
- [ ] All SHA IDs recorded

## Execution Log

| # | Type | Scope | Description | SHA | Status |
|---|------|-------|-------------|-----|--------|
| 1 | chore | deps | add prettier and next-intl | _pending_ | _pending_ |
| 2 | style | — | add prettier configuration and format codebase | _pending_ | _pending_ |
| 3 | refactor | e2e | use @ alias for cross-folder imports | _pending_ | _pending_ |
| 4 | feat | i18n | add en/es locale routing with next-intl | _pending_ | _pending_ |
