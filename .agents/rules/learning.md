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
