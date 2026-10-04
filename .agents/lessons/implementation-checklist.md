# Implementation Checklist & Pattern Reference

> **Note**: Concrete paths in the examples below (`features/`, dashboard, patients) come from a prior project. Apply the _principles_ to this repo's structure (`app/`).

## 🎯 Pre-Implementation Checklist

**Before writing ANY code, always complete this checklist:**

### ✅ Phase 0: Implementation Preview & Clarification (MANDATORY)

- [ ] **Show detailed preview** of what you plan to implement
- [ ] **Ask clarifying questions** if requirements are unclear
- [ ] **Include examples** in clarifying questions for better understanding
- [ ] **Wait for user approval** before proceeding to implementation

### ✅ Phase 1: Research

- [ ] **Read relevant lessons** in `.agents/lessons/`
- [ ] **Find existing patterns** in the codebase
- [ ] **Check compliance** with `.agents/rules/code.md`
- [ ] **Verify architecture patterns** from lessons

### ✅ Phase 2: Pattern Verification

- [ ] **Using object-based constants** (no string literals)
- [ ] **Following feature-based organization** (grouped by business capability)
- [ ] **Applying dependency injection** (no React hooks in utilities)
- [ ] **Using factory patterns** for providers
- [ ] **Following SOLID principles**

### ✅ Phase 3: Implementation

- [ ] **Code follows established patterns exactly**
- [ ] **TypeScript strict mode compliance**
- [ ] **Proper error handling implemented**
- [ ] **Prettier formatting ready**

## 📚 Critical Pattern References

### ✅ Implementation Preview & Clarification (NEW - MANDATORY FIRST STEP)

**❌ WRONG - Jump straight to implementation:**

```
User: "Add a new dashboard component"
Assistant: [Immediately starts coding without preview]
```

**✅ CORRECT - Always show preview first:**

```
User: "Add a new dashboard component"
Assistant: "I'll help you add a new dashboard component. Here's my implementation plan:

**Preview:**
1. Create `features/dashboard/components/new-component.tsx`
2. Add TypeScript interfaces for props
3. Implement server-side translation support
4. Add component to dashboard layout

**Clarifying Questions:**
- What type of data should this component display? (e.g., stats, charts, lists)
- Should it be interactive or static content?
- Any specific styling requirements?

**Examples:**
- For stats: "Should it show patient counts, appointment metrics, or revenue data?"
- For charts: "Do you need line charts, bar charts, or pie charts?"

Please confirm this approach and answer the questions before I proceed."
```

### ✅ Object-Based Constants (NEVER use string literals)

```typescript
// ❌ WRONG - String literals
switch (type) {
  case 'admin':
    return true; // AVOID!
  case 'clinical':
    return false; // AVOID!
}

// ✅ CORRECT - Object-based constants
switch (type) {
  case USER_ROLES.admin:
    return true; // CORRECT!
  case ROUTE_TYPES.CLINICAL:
    return false; // CORRECT!
}
```

### ✅ Feature-Based Organization

```
features/
├── auth/
│   ├── core/
│   │   ├── types/
│   │   ├── interfaces/
│   │   └── factories/
│   ├── providers/
│   ├── components/
│   └── middleware/
```

### ✅ Dependency Injection Pattern

```typescript
// ❌ WRONG - React hook in utility
export const getRoleName = (role: string) => {
  const t = useTranslations(); // Hook violation!
  return t(role);
};

// ✅ CORRECT - Dependency injection
export const getRoleName = (role: string, t: (key: string) => string) => {
  return t(role);
};
```

### ✅ Factory Pattern for Providers

```typescript
export class AuthProviderFactory {
  static createAuthProvider(): IAuthProvider {
    switch (authConfig.provider) {
      case AUTH_PROVIDERS.SUPABASE:
        return new SupabaseAuthProvider();
      default:
        throw new Error(`Unsupported provider: ${authConfig.provider}`);
    }
  }
}
```

## 🚨 Memory Triggers

### When you see these patterns → STOP and check lessons:

- **Switch statements** → Must use object-based constants
- **New types** → Must use const objects with keyof typeof
- **File organization** → Must follow feature-based structure
- **Utility functions** → Must use dependency injection
- **Provider creation** → Must use factory pattern

### Red Flags 🚩

```
❌ String literals in switch cases
❌ React hooks in utility functions
❌ Technical layer organization
❌ Hardcoded route strings
❌ Direct provider instantiation
❌ Missing dependency injection
❌ Skipping implementation preview and clarification
```

### Green Flags ✅

```
✅ Object-based constants (USER_ROLES.admin)
✅ Feature-based folders (features/auth/core)
✅ Factory pattern usage
✅ Dependency injection
✅ Interface abstractions
✅ SOLID principles
✅ Component reusability principles
✅ Plugin-Based Architecture
✅ Component Reusability Principles
✅ Implementation preview with clarifying questions
```

## 🔍 Quick Reference Commands

```bash
# Before implementation:
grep -r "pattern" .agents/lessons/
grep -r "similar-pattern" app/
bun run type-check

# After implementation:
bun run format
bun run lint
bun run type-check
```

## 📋 Implementation Process

1. **PREVIEW** - Show implementation plan and ask clarifying questions
2. **READ** - lessons/implementation-checklist.md
3. **RESEARCH** - existing codebase patterns
4. **VERIFY** - compliance with all rules
5. **IMPLEMENT** - following established patterns exactly
6. **TEST** - format, type-check, test

## 🎯 Phase 4 Planning - Critical Lessons Integration

### ✅ Architecture Classification - Dashboard as Feature

**Critical Insight**: Dashboard is NOT shared components - it's a complete feature

**Correct Structure**:

```
features/dashboard/       # ✅ Complete feature
├── core/types/          # Feature-specific types
├── core/hooks/          # Feature-specific hooks
├── components/          # Feature-specific components
└── lib/                 # Feature-specific utilities
```

### ✅ File Naming Compliance - Kebab-Case Mandatory

**Critical Discovery from development-environment.md**:

```
❌ WRONG: StatsCard.tsx, UpcomingAppointments.tsx
✅ CORRECT: stats-card.tsx, upcoming-appointments.tsx
```

### ✅ String Literal Detection - Object-Based Constants

**Pattern to Enforce**:

```typescript
// ❌ WRONG - String literals
switch (status) {
  case 'scheduled':
    return 'default'; // Violation
}

// ✅ CORRECT - Object-based constants
switch (status) {
  case APPOINTMENT_STATUS.scheduled:
    return 'default'; // Compliant
}
```

### ✅ Feature-Based Organization

**Lesson**: Organize by business capability, not technical layers

**Pattern**: `features/dashboard/components/` not `components/dashboard/`

### ✅ Systematic Pattern Verification

**Process**: Study existing code (sidebar.tsx) to understand established patterns before implementation

**Perfect Example**:

```typescript
import { useRole } from '@/features/auth/core/hooks/use-role';
import { USER_ROLES } from '@/features/auth/core/types/role.types';
if (item.adminOnly && !hasAccess(USER_ROLES.admin)) return null;
```

---

**REMEMBER: The lessons prevent EXACT mistakes you're about to make. Follow them exactly.**

**NEW RULE: Always show implementation preview and ask clarifying questions with examples before writing any code.**

## ⚡ Quick Pattern Templates

### Route Types

```typescript
export const ROUTE_TYPES = {
  PUBLIC: 'public',
  ADMIN: 'admin',
  CLINICAL: 'clinical',
} as const;

export type RouteType = (typeof ROUTE_TYPES)[keyof typeof ROUTE_TYPES];
```

### Role Checking

```typescript
export class AccessControl {
  static canAccess(userRole: string, routeType: RouteType): boolean {
    switch (routeType) {
      case ROUTE_TYPES.ADMIN:
        return userRole === USER_ROLES.admin;
      case ROUTE_TYPES.CLINICAL:
        return ROLE_GROUPS[ROLE_GROUP_KEYS.CLINICAL].includes(userRole as any);
      default:
        return true;
    }
  }
}
```

---

**REMEMBER: The lessons are correct. Follow them exactly. Don't innovate on established patterns.**
