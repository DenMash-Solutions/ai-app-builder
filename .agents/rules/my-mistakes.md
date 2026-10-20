# My Common Mistakes & Prevention

## 🚨 Critical Mistakes I Keep Making

### 1. String Literals Instead of Object-Based Constants

**Problem:** Using `'admin'` instead of `USER_ROLES.admin`
**Lesson Reference:** `architecture-patterns.md` - "Never use string literals for role definitions"
**Prevention:** Always use object-based constants from existing codebase

### 2. Not Checking Lessons Before Implementation

**Problem:** Jumping to implementation without reading lessons
**Lesson Reference:** All lessons are there to prevent these exact mistakes
**Prevention:** Mandatory lesson review before any code writing

### 3. Feature Architecture Misclassification

**Problem:** Treating a business capability (e.g. dashboard) as shared components instead of a feature
**Lesson Reference:** `architecture-patterns.md` - organize by business capability
**Prevention:** Always organize by business capability, not technical layers

### 4. File Naming Convention Violations

**Problem:** Using PascalCase for component files instead of kebab-case
**Lesson Reference:** `development-environment.md` - "Enforce kebab-case for ALL files"
**Prevention:** Always use kebab-case: `stats-card.tsx` not `StatsCard.tsx`

### 5. String Literal Pattern Misses

**Problem**: Not immediately catching string literal violations in switch statements
**Lesson Reference**: `implementation-checklist.md` - "Switch statements → Must use object-based constants"
**Prevention**: Systematically review all switch cases for string literals

### 6. Component Reusability Violations

**Problem**: Creating components that require translation props, violating reusability principles
**Lesson Reference**: `component-reusability.md` - "Component should manage its own i18n"
**Prevention**: Make components self-contained with their own translation hooks

### 7. Translation Namespace Arguments Violation

**Problem**: Using namespace arguments in `useTranslations()` or `getTranslations()` limits component reusability
**Lesson Reference**: `component-reusability.md` - "useTranslations() must not receive arguments"
**Prevention**: Always call `useTranslations()` and `getTranslations({ locale })` without arguments for truly reusable components

### 8. Translation Props Pattern Misses

**Problem**: Not immediately catching translation props that make components non-reusable
**Lesson Reference**: `component-reusability.md` - "Avoid translation props that violate reusability"
**Prevention**: Systematically review component interfaces for translation props

### 9. Next.js Layout Nesting Violations (NEW)

**Problem**: Adding `<html>` and `<body>` tags to nested layouts
**Lesson Reference**: Next.js layout nesting documentation - "Only root layout should contain html/body"
**Prevention**: Never add html/body tags to any layout except `app/layout.tsx`

### 10. Translation Loading Without Locale (NEW)

**Problem**: Calling `getMessages()` without locale parameter
**Lesson Reference**: next-intl documentation - "getMessages() requires locale parameter"
**Prevention**: Always pass locale: `getMessages({ locale: params.locale })`

### 11. Middleware Configuration Issues (NEW)

**Problem**: Creating separate `middleware.ts` instead of using `proxy.ts`
**Lesson Reference**: Project structure - Use proxy.ts for middleware exports
**Prevention**: Use proxy.ts pattern with proper matcher configuration

### 12. Server-Side vs Client-Side Rendering (NEW)

**Problem**: Using client-side components for static dashboard content
**Lesson Reference**: Performance optimization - Server-rendered content is better for static content
**Solution**: Use server-side rendering with `getTranslations({ locale })` for dashboard components

### 13. Dashboard Internationalization (NEW)

**Problem**: Not implementing proper internationalization for dashboard components
**Lesson Reference**: Dashboard internationalization documentation - "Use server-side rendering for static content"
**Prevention**: Implement server-side rendering with `getTranslations({ locale })` for dashboard components

### 14. Component Organization Violations (NEW)

**Problem**: Using flat component structure instead of sub-component organization
**Lesson Reference**: `component-reusability.md` - "Sub-component Organization (Dashboard Pattern)"
**Prevention**: Group related components in sub-folders with index files for clean exports

### 15. Mixed Responsibilities in Components (NEW)

**Problem**: Components handling both business logic and UI presentation
**Lesson Reference**: `component-reusability.md` - "Feature Structure (Auth Pattern)"
**Prevention**: Separate business logic into hooks/actions, keep components pure UI

### 16. Implementation Preview & Clarification Violations

**Problem**: Not showing implementation preview and asking clarifying questions before writing code
**Lesson Reference**: `implementation-protocol.md` - "Step 0: IMPLEMENTATION PREVIEW & CLARIFICATION (MANDATORY)"
**Prevention**: Always show detailed preview of implementation plan and ask clarifying questions with examples before any code generation

### 17. Skipping User Approval

**Problem**: Proceeding with implementation without waiting for explicit user approval
**Lesson Reference**: `implementation-protocol.md` - "WAIT for user approval before proceeding to implementation"
**Prevention**: Never proceed with implementation until user explicitly approves the plan

### 18. Raw Inline `<script>` in React Trees (NEW)

**Problem**: Rendering a raw executable `<script>` (e.g., theme pre-paint init) from a React component → "Encountered a script tag while rendering React component" warning on client re-creates (Fast Refresh recovery, Strict Mode remounts)
**Lesson Reference**: `react-inline-scripts.md` + Next guide `node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md`
**Prevention**: Client-component wrapper with `type={typeof window === "undefined" ? "text/javascript" : "text/plain"}` + `suppressHydrationWarning`, placed in `<head>`; re-apply script-set `<html>` attributes in `useLayoutEffect`. Head placement alone does NOT fix it

### 19. Controlled Input Drafts Ignored + Wrong Debug Triage Order (NEW)

**Problem**: New `style` field kind rendered `serialize(props)` directly instead of `draft ?? serialize(props)` → keystrokes vanished on re-render ("typing does nothing"); then debugged React event internals / CDP occlusion for a long spiral while the bug was one line of own code
**Lesson Reference**: `controlled-input-drafts.md`
**Prevention**: Controlled inputs with drafts always resolve `draft ?? serialize(props)` for every field kind; new field kind → update `currentText` AND `commitText` together + test; triage order: app pipeline → React fiber state → environment (last)

### 20. Feature Plan Not Persisted to `docs/plan/` (NEW)

**Problem**: Structure-editing feature's initial plan (including drag-and-drop scope) lived only in conversation → descoped silently, zero trace in the repo (no `docs/`, no git-history hit for "drag"); scope decisions unrecoverable after session ended
**Lesson Reference**: `feature-plan.md`
**Prevention**: Every feature plan written to `docs/plan/{NNN}-{kebab-feature}/plan.md` BEFORE code, committed with the feature; scope changes update the plan file in the same turn; chat-only plans don't count

### 21. Plan Drafted Before Checking Lessons + Related Skills (NEW)

**Problem**: `form-validation-gating` + `action-loading-states` plans were drafted straight from package-source research — `.agents/lessons/` was never grepped and the `json-render` skill was not loaded first. The skill audit that followed immediately changed both plans. Worse: a consequential design rejection ("`watch` isn't taught in the prompt") rested on a **mis-filtered grep** (filters `prompt|rule|description` on the same line missed the prompt's "STATE WATCHERS" rules at core `2795+`) — negative "evidence" from a weak grep is not evidence.
**Lesson Reference**: `implementation-protocol.md` Step 0 — "BEFORE CREATING ANY PLAN — CHECK LESSONS + RELATED SKILLS FIRST"
**Prevention**: Before drafting any `docs/plan/**`: (1) `grep -r "<topic>" .agents/lessons/`, (2) load the matching skill via the `skill` tool, (3) only then draft. For any REJECT/CONFIRM conclusion drawn from a grep: read the enclosing context / re-grep with a broad pattern before recording it.

### 22. Blaming the Model Instead of the Prompt Vocabulary (NEW)

**Problem**: Pokédex steer test — fresh gens emitted `{"$template": "…${$index + 1}.png"}` (JS inside a template that only interpolates `${/state/paths}` → silently "") or dropped the image entirely; I concluded "lite-model adherence gap" when the actual gap was the RECIPE never teaching the registered-directive composition (`$concat` + `$math`) for derived strings — a plain-language steer ("the number is the Pokemon's position in the list") made the model one-shot the correct spec
**Lesson Reference**: `template-derived-strings.md`
**Prevention**: Silent-empty bindings → suspect JS-inside-`$template` first (read the STORED spec, not the pixels); "model won't do X" after ONE attempt → grep the prompt for the composition before blaming the model; when steering, state the DATA relationship in plain language, never the syntax

### 23. Ran `bun run build` Over a Live `next dev`, Then Chased the Wrong Symptom (NEW)

**Problem**: Started a production `next build` while `next dev` was serving the same `.next` → Turbopack's persistent cache got poisoned; three authed e2e tests then failed (`42501` on publish, sync dot stuck at "Syncing") and the dev log replayed `Unknown regular expression flags` parse errors for a file that was **valid on disk** (tsc green; the mangled `ahpst` variant existed only in cache). Despite failures starting in exactly that run, I probed tokens → DB → policy for a long detour before reading the server log's parse errors and grepping the file bytes; I also misread Playwright trace timestamps as seconds (a "6867s span" in a 70s run).
**Lesson Reference**: `.agents/lessons/dev-server-e2e-triage.md`
**Prevention**: Never build while dev serves the same `.next` (stop dev first, or wipe `.next` after); when e2e failures begin right after an environment action, read the dev log FIRST and verify disk bytes (`grep`/`tsc`) before editing anything a parser blames; RLS `42501` with identical old/new-token probe results = race with the parent row → gate async e2e waits on the database (service-role poll), never on status-dot text; sanity-check trace spans (ms) against wall-clock.

## Dashboard Internationalization Implementation (NEW LESSON)

### Architecture Pattern Used

- **Server-Side Rendering**: Dashboard components use `getTranslations({ locale })` from `next-intl/server`
- **Client-Side Separation**: Login form uses client-side `useTranslations()` for interactive elements
- **Proper Data Flow**: Server page extracts locale from URL params and passes to components

### Component Design Principles Applied

- **Self-Contained Components**: Each dashboard component manages its own translations
- **No Translation Props**: Components accept `locale` parameter instead of translation strings
- **Type Safety**: Proper TypeScript interfaces with locale parameters

### Performance Benefits

- **Server Rendering**: Content is server-rendered with correct translations
- **SEO Optimization**: HTML includes proper lang attributes
- **Reduced Client Bundle**: No translation duplication in client-side code

### Translation Flow

```
Server Page → getTranslations({ locale }) → Dashboard Component → Translated Content
```

## Best Practices Reinforced

1. **Server-side rendering for static content** with i18n
2. **Component self-containment** for translation management
3. **Proper TypeScript interfaces** with locale parameters
4. **Clean separation of concerns** between server and client logic

This implementation demonstrates proper Next.js 13+ internationalization patterns and component architecture principles.

## 🔧 Prevention Commands

### Before Any Implementation

```bash
# 1. Check lessons for relevant patterns
grep -r "topic" .agents/lessons/

# 2. Find existing codebase examples
grep -r "similar-pattern" app/

# 3. Verify compliance
bun run type-check
```

### Implementation Checklist

- [ ] Read lessons completely
- [ ] Found existing patterns
- [ ] Using object-based constants
- [ ] Following feature-based organization
- [ ] Applied dependency injection
- [ ] No string literals
- [ ] No React hooks in utilities
- [ ] Using kebab-case file naming
- [ ] Business capability classified as a feature
- [ ] All switch cases use constants

## 📚 Pattern Reference (Copy-Paste Ready)

### Object-Based Constants

```typescript
// ✅ ALWAYS do this
case USER_ROLES.admin: return true;
case ROUTE_TYPES.CLINICAL: return false;

// ❌ NEVER do this
case 'admin': return true;
case 'clinical': return false;
```

### Feature Organization

```typescript
// ✅ ALWAYS structure like this
features/auth/core/types/
features/auth/providers/
features/auth/components/

// ❌ NEVER organize by technical layers
utils/auth/
types/auth/
components/auth/
```

### Dependency Injection

```typescript
// ✅ ALWAYS inject dependencies
export const utility = (param: string, dependency: Function) => {
  return dependency(param);
};

// ❌ NEVER use hooks in utilities
export const utility = (param: string) => {
  const hook = useHook(); // WRONG!
  return hook(param);
};
```

## 🎯 Memory Triggers

When I see these → STOP and check lessons:

- `case 'string':` → Must use object constant
- `useTranslations()` in utility → Must use dependency injection
- Creating new files → Must follow feature-based structure
- Provider instantiation → Must use factory pattern
- `emptyStateTitle?: string` → Component not truly reusable
- Translation props in interface → Violates reusability principles
- **NEW**: `<html>` or `<body>` in nested layout → Violates Next.js rules
- **NEW**: `getMessages()` without locale → Loads wrong translations
- **NEW**: Creating middleware.ts → Use proxy.ts instead
- **NEW**: `useTranslations('namespace')` → Arguments limit reusability
- **NEW**: `getTranslations({ locale }, 'namespace')` → Arguments limit reusability
- **NEW**: Flat component structure → No sub-component organization
- **NEW**: Business logic in components → Mixed responsibilities
- **NEW**: About to implement code → Must show preview and ask clarifying questions
- **NEW**: Rendering `<script>` from a component → Must use client-component type trick (`react-inline-scripts.md`)
- **NEW**: HMR `X is not defined` during edits → Edit import + usage in one atomic edit
- **NEW**: Input "ignores what I type" → draft must win: `draft ?? serialize(props)` (`controlled-input-drafts.md`)
- **NEW**: Debugging a single input for >10 min → verify app renders keystroke first, environment last
- **NEW**: Playwright finds 0 but a11y tree shows the name → missing `{" "}` between JSX spans (`jsx-whitespace-names.md`)
- **NEW**: MCP screenshot contradicts a change you just made → stale frame; verify with `evaluate_script` (`mcp-verification.md`)
- **NEW**: Fixed-dark component invisible in light theme → scope `.dark` class on the island (`mcp-verification.md`)
- **NEW**: Writing a feature plan only in chat → must persist to `docs/plan/{NNN}-{feature}/plan.md` (`feature-plan.md`)
- **NEW**: About to write a plan file → lessons grep + related skill load FIRST (`implementation-protocol` Step 0, mistake #21)
- **NEW**: About to reject an option based on a grep result → re-grep broad + read enclosing context first (weak filter = false negative, mistake #21)
- **NEW**: Concluding "model adherence gap" from one generated spec → check whether the recipe teaches the composition (`template-derived-strings.md`, mistake #22)
- **NEW**: e2e admin-write failures (`42501`, stuck sync dot) starting right after a build → stale `.next` cache + sync race — log first, disk bytes before edits, gate on the DB (`dev-server-e2e-triage.md`, mistake #23)
- **NEW**: About to run `bun run build` with `next dev` still up → stop dev first (or expect to wipe `.next`) (`dev-server-e2e-triage.md`, mistake #23)

## ⚡ Quick Recovery Commands

```bash
# If I made a mistake:
bun run format
bun run type-check
git checkout -- file-to-reset

# To find correct patterns:
grep -r "USER_ROLES" app/
grep -r "ObjectConstants\|FACTORY" app/
```

---

**RULE: Implementation preview & clarification first, lessons second, implement third. Never the other way around.**
