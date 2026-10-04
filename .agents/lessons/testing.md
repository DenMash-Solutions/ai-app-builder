# Testing Setup & Best Practices

> **Note**: Vitest is **not installed in this repo yet** — `bun run test` does not exist. Follow this lesson when setting up testing for the first time.

## Key Lessons Learned

### Testing Infrastructure

- **Set up testing infrastructure from the start** - Vitest + Testing Library provides comprehensive testing
- **Create basic test verification** - Ensures testing environment works before building complex tests
- **Configure test scripts** - test, test:ui, test:coverage provide different testing workflows

### Common Issues & Solutions

#### Test Environment Setup

- **Problem**: Testing framework not properly configured
- **Solution**: Install all required dependencies and verify with basic test
- **Dependencies**: `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`

#### Test File Organization (Co-located Approach)

- **Problem**: Tests scattered across project
- **Solution**: Place test files next to the components they test
- **Pattern**: `Component.test.tsx` right next to `Component.tsx`

#### Co-located File Structure

```
src/
  components/
    Button/
      Button.tsx
      Button.test.tsx    ← right next to the source
      Button.module.css
    Card/
      Card.tsx
      Card.test.tsx     ← co-located with component
      Card.module.css
  lib/
    utils.ts
    utils.test.ts       ← test file next to utility file
    api/
      client.ts
      client.test.ts    ← test alongside API client
```

#### Benefits of Co-located Testing

- **Easier Discovery**: Tests are immediately visible when working on components
- **Better Context**: Tests are in the same context as the code they test
- **Simpler Imports**: No complex relative paths needed
- **Easier Refactoring**: When moving components, tests move with them
- **Faster Development**: Less context switching between files

#### Test Configuration

- **Problem**: Vitest not recognizing co-located test files
- **Solution**: Configure vitest.config.ts to find test files next to source files
- **Example**: `testMatch: ['**/*.test.{ts,tsx}']` or `testMatch: ['**/*.spec.{ts,tsx}']`

### Best Practices

#### Setup Checklist

- [ ] Install testing dependencies
- [ ] Create vitest configuration
- [ ] Set up test scripts in package.json
- [ ] Create basic verification test
- [ ] Configure test environment (jsdom)

#### Test Scripts

```json
{
  "test": "vitest",
  "test:ui": "vitest --ui",
  "test:coverage": "vitest --coverage",
  "test:watch": "vitest --watch"
}
```

#### Basic Test Template (Co-located)

```typescript
// Button.test.tsx - placed next to Button.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  it('should render correctly', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
  });

  it('should handle click events', () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Click me</Button>);

    fireEvent.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('should show loading state', () => {
    render(<Button loading>Loading</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
```

### Testing Strategies

#### Unit Tests

- Test individual functions and components
- Mock external dependencies
- Focus on business logic

#### Integration Tests

- Test component interactions
- Test data flow
- Verify user workflows

#### Coverage Goals

- Aim for 80%+ coverage
- Focus on critical paths
- Don't test implementation details

### Recovery Commands

```bash
# Reinstall testing dependencies
bun remove vitest @testing-library/react @testing-library/jest-dom jsdom
bun add -D vitest @testing-library/react @testing-library/jest-dom jsdom

# Run tests
bun run test

# Run tests with UI
bun run test:ui

# Generate coverage report
bun run test:coverage
```

### Configuration Templates

#### vitest.config.ts (Co-located Setup)

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./__tests__/setup.ts'],
    globals: true,
    // Find test files next to source files
    testMatch: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    // Ignore node_modules and build outputs
    exclude: ['node_modules', '.next', 'out', 'dist'],
  },
});
```

#### **tests**/setup.ts (Global test setup)

```typescript
import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock Next.js router
vi.mock('next/router', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    pathname: '/',
    query: {},
    asPath: '/',
  }),
}));

// Mock Next.js navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));
```

## Memory Triggers

- When setting up new projects
- When tests are failing unexpectedly
- Before adding new features
- During code reviews
