# Learning & Problem-Solving Hub

## Overview

This file serves as the central entry point for all lessons learned and problem-solving strategies. For comprehensive educational content, patterns, and detailed guidance, read the relevant file in the lessons directory at **`.agents/lessons/`** (do not load them all upfront — read the one relevant to the task).

## 🎯 Quick Access to Lessons

### **Critical Lessons for Implementation**

#### **[implementation-checklist.md](../lessons/implementation-checklist.md)** - MANDATORY BEFORE CODING

- 5-step implementation process
- Object-based constants patterns
- Feature-based organization rules
- Dependency injection principles
- Memory triggers and red flags

#### **[development-environment.md](../lessons/development-environment.md)** - FILE NAMING COMPLIANCE

- **kebab-case MANDATORY for ALL files**
- Environment setup procedures
- Common configuration issues
- Recovery commands

#### **[architecture-patterns.md](../lessons/architecture-patterns.md)** - FEATURE-BASED ARCHITECTURE

- Feature-based screaming architecture
- Dashboard classification as feature
- Plugin-based dependency decoupling
- Type-safe role management

#### **[component-reusability.md](../lessons/component-reusability.md)** - COMPONENT REUSABILITY PRINCIPLES

- Critical principles for creating truly reusable React components
- Avoid translation props that violate reusability
- Component self-contained i18n management
- Single responsibility and loose coupling patterns

### **Supporting Lessons**

#### **[github-workflow.md](../lessons/github-workflow.md)** - COLLABORATION

- Branch management and naming
- Pull request processes
- Tool limitations and workarounds

#### **[code-quality.md](../lessons/code-quality.md)** - FORMATTING & STANDARDS

- Prettier configuration
- VSCode setup and automation
- Common formatting issues

#### **[testing.md](../lessons/testing.md)** - QUALITY ASSURANCE

- Testing infrastructure setup
- Test organization and strategies
- Coverage goals and best practices

#### **[ui-design-implementation.md](../lessons/ui-design-implementation.md)** - UI PATTERNS

- Design system guidelines
- Responsive design patterns
- Component conventions

#### **[react-inline-scripts.md](../lessons/react-inline-scripts.md)** - REACT INLINE SCRIPTS & HYDRATION

- Pre-paint scripts without React warnings (client `type` trick)
- Next.js `preventing-flash-before-hydration.md` guide
- Dev Strict Mode remount guards (`useLayoutEffect`)

#### **[controlled-input-drafts.md](../lessons/controlled-input-drafts.md)** - CONTROLLED INPUT DRAFTS & DEBUG TRIAGE

- Draft precedence: `draft ?? serialize(props)` for every field kind
- New field kind → update display + commit paths together, with tests
- Debug triage order: app pipeline → React fiber state → environment (last)

#### **[jsx-whitespace-names.md](../lessons/jsx-whitespace-names.md)** - JSX WHITESPACE & SELECTOR NAMES

- JSX strips whitespace between adjacent spans → `textContent`/accname run together
- Always add `{" "}` between spans that e2e must match
- A11y-tree names ≠ Playwright names — verify with real matchers

#### **[mcp-verification.md](../lessons/mcp-verification.md)** - BROWSER VERIFICATION VIA MCP

- Full-page screenshots can be stale compositor frames — `evaluate_script` is ground truth
- Fixed dark islands: scope `.dark` vars per element (`ACTION_BUTTON_CLASS` pattern)
- Element screenshots (uid) over page screenshots; verify freshness before debugging

#### **[template-derived-strings.md](../lessons/template-derived-strings.md)** - DERIVED STRINGS & $TEMPLATE ANTI-PATTERN

- `$template` interpolates `${/state/paths}` only — missing path = "" silently
- Derived strings (URL/labels from `$item`/`$index`) → `$concat` + `$math`, never JS inside `${…}`

#### **[dev-server-e2e-triage.md](../lessons/dev-server-e2e-triage.md)** - DEV-SERVER CACHE & E2E FAILURE TRIAGE

- Never `next build` while `next dev` serves the same `.next` — stale Turbopack cache replays dead parse errors across restarts; disk bytes + `tsc` are ground truth
- RLS `42501` with healthy-token probes → race with the parent row, not the policy — probe REST A/B first, gate async work on the database (service-role poll), never on status-dot text
- Trace `_monotonicTime` is milliseconds — sanity-check derived spans against wall-clock before theorizing
- Server-side query/cache proof → Supabase `query_logs` (`toDateTime64` literals, `log_attributes['request.path']`), not the browser network panel

#### **[css-safelist-performance.md](../lessons/css-safelist-performance.md)** - CSS SAFELIST MASS = RESIZE-FPS KILLER

- Speculative `@source inline` cross-products (3 MB / ~42k rules) = ~1s style-recalc stalls per resize with DevTools open; cut to evidence-backed 10 sources / 1,083 candidates → 197 KB, 17 → 64 FPS
- FPS protocol: control arm first, DevTools open (the reported condition), real build — DevTools-closed reads ~120 on every variant
- `@source inline("…")` lines must end exactly `");` (no trailing comments); after a bulk splice re-derive source/candidate counts
- Revisit "declined/slimming rejected" decisions when new measurement evidence arrives (plan 016 reopened by plan 057)

## 🚨 Critical Insights (Feature Organization)

### **Architecture Classification**

**Lesson**: A business capability is a FEATURE, not scattered shared components
**Details**: See **[architecture-patterns.md](../lessons/architecture-patterns.md)**

```
✅ CORRECT: features/<capability>/ (complete capability, when features/ exists)
❌ WRONG: components/<capability>/ (technical layer at root)
```

### **File Naming Compliance**

**Lesson**: kebab-case is MANDATORY for ALL non-route files
**Details**: See **[development-environment.md](../lessons/development-environment.md)**

```
✅ CORRECT: stats-card.tsx, upcoming-items.tsx
❌ WRONG: StatsCard.tsx, UpcomingItems.tsx
```

### **Object-Based Constants**

**Lesson**: Never use string literals in switch statements
**Details**: See **[implementation-checklist.md](../lessons/implementation-checklist.md)**

```typescript
✅ CORRECT: case ITEM_STATUS.active:
❌ WRONG: case 'active':
```

## 📋 Implementation Process (MANDATORY)

Before writing ANY code, follow this exact sequence:

1. **LESSONS FIRST** - Read **[implementation-checklist.md](../lessons/implementation-checklist.md)** completely
2. **PATTERNS SECOND** - Study existing codebase patterns (`app/` components)
3. **COMPLIANCE THIRD** - Verify against **[my-mistakes.md](../rules/my-mistakes.md)**
4. **IMPLEMENT FOURTH** - Write code following established patterns
5. **VERIFY FIFTH** - Test, format, and validate

## 🎯 Memory Triggers

### **Red Flags** → STOP and check lessons

- String literals in switch statements → **[implementation-checklist.md](../lessons/implementation-checklist.md)**
- PascalCase file names → **[development-environment.md](../lessons/development-environment.md)**
- Technical layer organization → **[architecture-patterns.md](../lessons/architecture-patterns.md)**
- React hooks in utilities → **[implementation-checklist.md](../lessons/implementation-checklist.md)**
- "Encountered a script tag" warning → **[react-inline-scripts.md](../lessons/react-inline-scripts.md)**
- Playwright finds 0 but a11y tree shows the name → **[jsx-whitespace-names.md](../lessons/jsx-whitespace-names.md)**
- MCP screenshot contradicts a change you just made → **[mcp-verification.md](../lessons/mcp-verification.md)**
- Fixed-dark component invisible in light theme → **[mcp-verification.md](../lessons/mcp-verification.md)**
- A URL/image prop renders with a gap (`…/…png`) → JS inside `$template`; only `${/paths}` interpolate → **[template-derived-strings.md](../lessons/template-derived-strings.md)**
- e2e failures began right after a build/restart → stale `.next` cache replay; verify disk bytes + wipe cache → **[dev-server-e2e-triage.md](../lessons/dev-server-e2e-triage.md)**
- `42501`/stuck status dot while probes show healthy tokens → sync race; gate on the DB, not UI status text → **[dev-server-e2e-triage.md](../lessons/dev-server-e2e-triage.md)**
- FPS/resize degrades only with DevTools open → CSS rule count first (`@layer utilities`), control arm first → **[css-safelist-performance.md](../lessons/css-safelist-performance.md)**
- `evaluate_script` timeout / rule "missing" from stylesheet scan / `setTimeout` ReferenceError in execute → stepwise calls, recurse `@layer`, page-context timers → **[mcp-verification.md](../lessons/mcp-verification.md)**
- Check reports 0 attempts / 0 elements / "nothing happened" → probe may not have exercised the path; invalid run, not a pass → **[css-safelist-performance.md](../lessons/css-safelist-performance.md)**
- Bulk-replace script exited 0 → re-derive the counts from a fresh read before trusting it → **[css-safelist-performance.md](../lessons/css-safelist-performance.md)**

### **Green Flags** → Continue with confidence

- Object-based constants (USER_ROLES.admin)
- Business capability organized as a feature
- Dependency injection patterns
- kebab-case file naming

## 🔧 Quick Recovery Commands

```bash
# Reset to clean state
git reset --hard HEAD && git clean -fd

# Reinstall dependencies
bun install

# Reformat project
bun run format

# Lint and type-check
bun run lint && bun run type-check
```

## 📚 When to Study

### **Before Starting Work**

- **MANDATORY**: **[implementation-checklist.md](../lessons/implementation-checklist.md)**
- **MANDATORY**: **[development-environment.md](../lessons/development-environment.md)**
- **MANDATORY**: **[my-mistakes.md](../rules/my-mistakes.md)**

### **During Implementation**

- Pattern verification: **[implementation-checklist.md](../lessons/implementation-checklist.md)**
- Architecture guidance: **[architecture-patterns.md](../lessons/architecture-patterns.md)**
- File naming: **[development-environment.md](../lessons/development-environment.md)**

### **When Encountering Problems**

- Search relevant lesson in **`.agents/lessons/`**
- Try recovery commands above
- Check **[my-mistakes.md](../rules/my-mistakes.md)**

---

**REMEMBER: This file is the ENTRY POINT. All detailed educational content lives in the lessons directory. Follow the rules → check lessons → implement correctly.**
