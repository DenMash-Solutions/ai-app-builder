# Implementation Protocol - MANDATORY STEPS

## 🚨 BEFORE WRITING ANY CODE - FOLLOW THIS EXACTLY

### Step 0: IMPLEMENTATION PREVIEW & CLARIFICATION (MANDATORY)

- **ALWAYS** show a detailed preview of what you plan to implement
- **ALWAYS** ask clarifying questions if requirements are unclear
- **ALWAYS** include examples in clarifying questions for better understanding
- **ALWAYS** include the best approach for each question
- **NEVER** skip this step unless user explicitly requests direct implementation
- **WAIT** for user approval before proceeding to implementation

### Step 1: LESSONS FIRST (MANDATORY)

```bash
# Always run this before implementing:
grep -r "topic" .agents/lessons/
cat .agents/lessons/implementation-checklist.md
cat .agents/rules/my-mistakes.md
```

### Step 2: PATTERN RESEARCH (MANDATORY)

```bash
# Find existing patterns in codebase:
grep -r "similar-pattern" app/
grep -r "USER_ROLES\|ROUTE_TYPES" app/
```

### Step 3: COMPLIANCE CHECK (MANDATORY)

- [ ] Read implementation-checklist.md completely
- [ ] Reviewed my-mistakes.md
- [ ] Found 2+ examples of similar code
- [ ] Verified using object-based constants
- [ ] Confirmed feature-based organization

## 🔥 CRITICAL RULES - NEVER BREAK THESE

### 1. NO STRING LITERALS

```typescript
// ❌ NEVER
case 'admin': return true;

// ✅ ALWAYS
case USER_ROLES.admin: return true;
```

### 2. LESSONS BEFORE CODE

```typescript
// ❌ NEVER - Implement without reading lessons
// Jump straight to coding

// ✅ ALWAYS - Read lessons first
// 1. Read relevant lessons
// 2. Find existing patterns
// 3. Follow exactly
```

### 3. FEATURE-BASED ORGANIZATION

```
❌ NEVER: utils/, types/, components/ at the root (technical layers)
✅ ALWAYS: group by business capability (app/<capability>/... today, features/<capability>/ when introduced)
```

### 4. DEPENDENCY INJECTION

```typescript
// ❌ NEVER - Hooks in utilities
export const utility = () => {
  const t = useTranslations(); // WRONG!
};

// ✅ ALWAYS - Inject dependencies
export const utility = (t: Function) => {
  return t('key');
};
```

## ⚡ QUICK VERIFICATION COMMANDS

```bash
# Before implementation:
cat .agents/lessons/implementation-checklist.md
cat .agents/rules/my-mistakes.md

# After implementation:
bun run format
bun run lint
bun run type-check
```

## 🎯 MEMORY TRIGGER SYSTEM

When you see these patterns → STOP AND READ LESSONS:

- `case 'string':` → Read implementation-checklist.md
- Creating new files → Read architecture-patterns.md
- Utility functions → Read dependency injection section
- Provider creation → Read factory pattern section
- **NEW**: About to implement code → Must show preview and ask clarifying questions

### 5. IMPLEMENTATION PREVIEW & CLARIFICATION (MANDATORY)

- **Show detailed preview** of what you plan to implement
- **Ask clarifying questions** if requirements are unclear
- **Include examples** in clarifying questions
- **Wait for user approval** before proceeding

## 📋 IMPLEMENTATION WORKFLOW

1. **STOP** - Don't write code yet
2. **PREVIEW** - Show implementation plan and ask clarifying questions
3. **READ** - lessons/implementation-checklist.md
4. **RESEARCH** - existing codebase patterns
5. **VERIFY** - compliance with all rules
6. **IMPLEMENT** - following established patterns exactly
7. **VERIFY** - `bun run lint && bun run type-check && bun run format`

---

**THIS IS NOT OPTIONAL. THIS IS MANDATORY.**
**IMPLEMENTATION PREVIEW & CLARIFICATION FIRST, LESSONS SECOND, IMPLEMENTATION THIRD.**
