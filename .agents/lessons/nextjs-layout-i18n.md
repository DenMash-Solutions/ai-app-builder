# Next.js Layout Nesting & i18n Lessons

> **Note**: The i18n half comes from a prior project (next-intl) and does not apply to this repo yet — there is no i18n setup. The layout-nesting rules (only the root layout may contain `<html>`/`<body>`) apply now.

## Problem Description

- Next.js App Router has strict rules about layout nesting
- Adding `<html>` or `<body>` tags to nested layouts violates Next.js patterns
- Internationalization requires proper middleware and translation loading
- Incorrect layout structure causes 404 errors and broken functionality

## Solution Steps

1. **Root Layout Only HTML/Body**: Only `app/layout.tsx` contains `<html>` and `<body>` tags
2. **Nested Layouts**: Never contain HTML/body tags - only providers and components
3. **Translation Loading**: `getMessages()` must receive locale parameter
4. **Middleware Configuration**: Use proxy.ts pattern, not separate middleware.ts
5. **Layout Chain**: Root → Locale → Feature layouts (no HTML duplication)

## Prevention Strategies

- Always check Next.js documentation for layout patterns
- Test internationalization with both locales
- Verify middleware configuration before deployment
- Use proper TypeScript types for layout parameters

## Common Issues & Solutions

### Layout Nesting Violations

**Problem**: Adding html/body to `[locale]/layout.tsx`

```typescript
// ❌ WRONG - Violates Next.js rules
export default function LocaleLayout({ children }) {
  return (
    <html lang={locale}>  // VIOLATION!
      <body>
        <NextIntlClientProvider messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
```

**Solution**: Remove html/body from nested layouts

```typescript
// ✅ CORRECT - Follows Next.js patterns
export default async function LocaleLayout(props: any) {
  const params = await props.params;
  const messages = await getMessages({ locale: params.locale });

  return (
    <NextIntlClientProvider messages={messages}>
      {props.children}
    </NextIntlClientProvider>
  );
}
```

### Translation Loading Issues

**Problem**: `getMessages()` called without locale

```typescript
// ❌ WRONG - Loads default locale only
const messages = await getMessages();
```

**Solution**: Pass locale parameter

```typescript
// ✅ CORRECT - Loads correct locale
const messages = await getMessages({ locale: params.locale });
```

### Middleware Configuration

**Problem**: Creating separate middleware.ts file

```typescript
// ❌ WRONG - Causes conflicts with proxy.ts
// middleware.ts
export default createMiddlewareChain();
```

**Solution**: Use proxy.ts pattern

```typescript
// ✅ CORRECT - proxy.ts
import { createMiddlewareChain } from './middleware/middleware-chain';

export default createMiddlewareChain();

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

## Recovery Commands

```bash
# Check layout structure
find app -name "layout.tsx" | head -5

# Test internationalization
curl -s http://localhost:3000/en | grep -o "Welcome\|Bienvenido"
curl -s http://localhost:3000/es | grep -o "Welcome\|Bienvenido"

# Verify middleware
cat proxy.ts

# Check for html/body violations
grep -r "<html\|<body" app/ --include="*.tsx" | grep -v "app/layout.tsx"
```

## Memory Triggers

- When creating new layouts → Check Next.js nesting rules
- When adding i18n → Verify translation loading pattern
- When configuring middleware → Use proxy.ts approach
- When seeing 404 errors → Check layout structure

## Quick Reference

### Correct Layout Structure

```
app/
├── layout.tsx              # ✅ Contains <html> and <body> ONLY
├── [locale]/
│   ├── layout.tsx         # ✅ NO html/body - only providers
│   ├── dashboard/
│   │   └── layout.tsx     # ✅ NO html/body - only components
│   └── page.tsx           # ✅ NO html/body
```

### Translation Pattern

```typescript
// Locale layout
export default async function LocaleLayout(props: any) {
  const params = await props.params;
  const messages = await getMessages({ locale: params.locale });

  return (
    <NextIntlClientProvider messages={messages}>
      {props.children}
    </NextIntlClientProvider>
  );
}
```

### Middleware Pattern

```typescript
// proxy.ts
import { createMiddlewareChain } from './middleware/middleware-chain';

export default createMiddlewareChain();

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

---

**REMEMBER: Next.js layout rules are strict - violations cause immediate failures.**
