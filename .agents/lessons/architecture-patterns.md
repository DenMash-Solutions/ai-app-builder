# Feature-Based Architecture & Plugin Design

> **Note**: `features/` paths in the examples come from a prior project — this repo currently only has `app/`. Organize by business capability when the structure grows.

## Problem Description

- Traditional authentication systems tightly couple business logic to specific providers
- File organization often follows technical concerns rather than feature boundaries
- String-based role definitions lead to maintenance issues and type safety problems
- Hard to switch authentication providers without extensive code changes
- Utility functions that depend on React hooks violate React rules
- Provider implementations scattered across the codebase make maintenance difficult

## Solution Steps

1. **Feature-Based Organization**: Structure code by features (`features/auth/`) rather than technical layers
2. **Plugin Architecture**: Abstract external dependencies behind interfaces for provider swapping
3. **Type-Safe Roles**: Use object-based role definitions instead of string unions
4. **Next.js Integration**: Use thin wrapper route files with feature page components
5. **Dependency Injection**: Pass dependencies (like translation functions) as parameters instead of importing hooks
6. **Provider System**: Centralized provider architecture with domain interfaces and vendor implementations

## Prevention Strategies

- Always design interfaces before implementing providers
- Use dependency injection for external services
- Prefer object-based constants over string literals
- Separate routing concerns from business logic
- **Never use React hooks in utility functions** - pass dependencies as parameters
- **Use factory pattern for provider creation** to enable plugin switching
- **Centralize provider architecture** in dedicated `providers/` directory with clear separation of concerns

## Provider System Architecture

### **Structure Overview**

```
providers/
├── domain/           # Domain interfaces and types
│   └── auth/        # Authentication domain interfaces
├── vendors/          # Vendor-specific implementations
│   ├── supabase/     # Supabase provider implementations
│   └── mock/         # Mock provider for testing
├── registry/         # Provider registry and client setup
└── index.ts         # Public API exports
```

### **Domain Interfaces**

Define contracts that vendor implementations must follow:

```typescript
// providers/domain/auth/interfaces/auth-provider.interface.ts
export interface IAuthClientProvider {
  signIn(email: string, password: string): Promise<AuthResult>;
  signOut(): Promise<void>;
  getCurrentUser(): Promise<User | null>;
}

export interface IAuthServerProvider {
  getUser(request: Request): Promise<User | null>;
}
```

### **Vendor Implementations**

Concrete implementations of domain interfaces:

```typescript
// providers/vendors/supabase/auth/client-auth-provider.ts
export class SupabaseClientProvider extends Provider implements IAuthClientProvider {
  readonly name = Provider.createName(
    PROVIDER_VENDORS.SUPABASE,
    PROVIDER_CONTEXTS.CLIENT,
    PROVIDER_DOMAINS.AUTH,
  );

  async signIn(email: string, password: string): Promise<AuthResult> {
    // Supabase-specific implementation
  }
}
```

### **Provider Registry**

Centralized provider management and factory pattern:

```typescript
// providers/registry/registry-client-provider.tsx
export class RegistryClientProvider {
  private static authProvider: IAuthClientProvider;

  static getAuthProvider(): IAuthClientProvider {
    if (!this.authProvider) {
      this.authProvider = AuthProviderFactory.createAuthProvider();
    }
    return this.authProvider;
  }
}
```

### **Benefits of Provider System**

1. **Decoupling**: Business logic separated from vendor-specific code
2. **Testability**: Easy to mock providers for testing
3. **Swappability**: Switch providers via configuration
4. **Maintainability**: All provider code in one location
5. **Type Safety**: Compile-time validation of provider contracts
6. **Extensibility**: Easy to add new vendors or domains

## Dependency Injection Pattern

### **Problem**

```tsx
// ❌ React hook in utility function - violates rules
export const getRoleDisplayName = (role: string): string => {
  const t = useTranslations('auth.roles'); // Hook violation!
  return t(role, { fallback: role });
};
```

### **Solution**

```tsx
// ✅ Dependency injection - pure function
export const getRoleDisplayName = (
  role: string,
  t: (key: string, options?: { fallback?: string }) => string,
): string => {
  return t(role, { fallback: role });
};
```

### **Usage in Components**

```tsx
// In React component
const t = useTranslations('auth.roles');
const displayName = getRoleDisplayName(user.role, t);
```

## Provider Registry Pattern

### **Registry Implementation**

```typescript
// providers/registry/registry-client-provider.tsx
export class RegistryClientProvider {
  private static authProvider: IAuthClientProvider;

  static getAuthProvider(): IAuthClientProvider {
    if (!this.authProvider) {
      this.authProvider = AuthProviderFactory.createAuthProvider();
    }
    return this.authProvider;
  }
}
```

### **Configuration-Driven Selection**

```typescript
// Environment-based provider switching
export const authConfig = {
  provider: process.env.NEXT_PUBLIC_AUTH_PROVIDER || PROVIDER_VENDORS.SUPABASE,
  // ...
};
```

## Recovery Commands

```bash
# Create provider structure
mkdir -p providers/{domain,vendors,registry}

# Create feature structure
mkdir -p features/auth/{core,providers,components,pages,config}

# Type checking
bun run build

# Format code
bun run format
```

---

# Type-Safe Role Management

## Problem Description

- String union types like `'admin' | 'doctor' | 'assistant'` are hard to maintain
- No single source of truth for role values
- Prone to typos and inconsistencies
- Difficult to iterate over roles or add new ones

## Solution Steps

1. **Object-Based Roles**: Define roles as const objects with keyof typeof
2. **Role Utilities**: Create helper functions for role checking and hierarchy
3. **Type Safety**: Leverage TypeScript for compile-time validation
4. **Enhanced Hooks**: Build role-based hooks with utility functions

## Prevention Strategies

- Never use string literals for role definitions
- Always create utility functions for role operations
- Use const assertions for role objects
- Implement role hierarchy for complex permission systems

## Recovery Commands

```bash
# Check type errors
bun run type-check

# Lint
bun run lint

# Format role types
bun run format
```

---

# Next.js App Router Integration

## Problem Description

- Feature-based architecture needs to work with Next.js app router conventions
- Page components should be reusable while respecting routing structure
- Need clear separation between route files and business logic
- Confusion about when to use 'use client' directive in page components

## Solution Steps

1. **Two-Layer Pages**: Feature page components + thin route wrappers
2. **Route Integration**: Import feature components into Next.js route files
3. **Layout Integration**: Use feature layouts for route groups
4. **Middleware Connection**: Connect feature services to Next.js middleware
5. **Smart Client Boundaries**: Place 'use client' at the right component level

## Client vs Server Component Guidelines

### **Use Server Components (Default)**

- Pure layout and composition
- Static content rendering
- Only composing client components
- Better performance and SEO

### **Use Client Components ('use client')**

- React hooks (useState, useEffect, etc.)
- Event handlers (onClick, onSubmit)
- Browser APIs (window, document)
- Form state management
- Interactive UI elements

### **Example Pattern**

```tsx
// ❌ Wrong: Unnecessary client directive
'use client';
export function LoginPage() {
  return <LoginForm />; // Only composition
}

// ✅ Correct: Server component composing client component
export function LoginPage() {
  return <LoginForm />; // LoginForm handles client logic
}
```

## Prevention Strategies

- Keep route files minimal and focused on routing only
- Place all business logic in feature components
- Use TypeScript for proper prop passing between layers
- Test feature components in isolation
- **Only use 'use client' when page components need React hooks or browser APIs**
- **Prefer server components for page layouts that only compose client components**

## Recovery Commands

```bash
# Verify route structure
find app -name "page.tsx" | head -10

# Test feature components
bun run lint
bun run type-check

# Check Next.js build
bun run build
```
