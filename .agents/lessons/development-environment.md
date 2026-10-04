# Development Environment Setup & Troubleshooting

> **Note**: The directory trees below are _target_ structures, not this repo's current layout (`app/` + `public/` only).

## Key Lessons Learned

### Environment Configuration

- **Set up all tooling upfront** - Prevents workflow interruptions
- **Use consistent configurations** - Ensures team collaboration works smoothly
- **Document setup processes** - Enables quick onboarding and recovery
- **Have alternative testing approaches** - MCP tools may fail unexpectedly

### MCP Testing Strategies

#### **When MCP Tools Fail**

##### **Common Issues**

- **Fill Tool Errors**: `Invalid arguments for tool fill` with numeric UIDs
- **Transport Errors**: `transport closed` or connection issues
- **Type Validation**: String/number type mismatches

#### **Best Practices for MCP Testing**

1. **Always Have Alternatives**: Keep JavaScript evaluation ready
2. **Test Multiple Ways**: Try fill, then evaluate_script, then direct navigation
3. **Handle Race Conditions**: Use waitFor when expecting page changes
4. **Verify Results**: Take snapshots after actions to confirm success
5. **Debug Systematically**: Check console logs and network requests

### Common Issues & Solutions

#### Dependency Management

- **Problem**: Missing dev dependencies for tooling
- **Solution**: Install all required packages upfront
- **Prevention**: Check package.json completeness, use lock files

#### Configuration File Conflicts

- **Problem**: Multiple configuration files overriding each other
- **Solution**: Understand configuration precedence, document settings
- **Prevention**: Create configuration documentation, use consistent naming

#### Line Ending Issues

- **Problem**: LF/CRLF conversion warnings in git
- **Solution**: Configure .gitattributes, use consistent settings
- **Prevention**: Set up proper git configuration early

#### File Naming Inconsistencies

- **Problem**: Mixed naming conventions (PascalCase vs kebab-case)
- **Solution**: Enforce kebab-case for ALL files, including React components
- **Prevention**: Use file naming verification in code review checklist
- **Common Mistakes**:
  - Wrong: `Sidebar.tsx`, `TopNav.tsx`, `LoginForm.tsx`
  - Correct: `sidebar.tsx`, `top-nav.tsx`, `login-form.tsx`

### Environment Setup Checklist

#### Initial Setup

- [ ] Install package manager (bun/npm/yarn)
- [ ] Initialize project with proper package.json
- [ ] Configure git repository
- [ ] Set up .gitignore
- [ ] Install development dependencies

#### Internationalization (i18n) Setup

- [ ] Configure next-intl plugin
- [ ] Set up locale routing structure (`app/[locale]`)
- [ ] Create locale JSON files for all supported languages
- [ ] Configure middleware for locale detection
- [ ] Test locale switching functionality

#### i18n Best Practices

- **Interpolation Syntax**: Use single braces `{variable}` not double braces `{{variable}}`
  - Correct: `t('forms.minLength', { count: 6 })` → "Minimum {count} characters"
  - Wrong: `t('forms.minLength', { count: 6 })` → "Minimum {{count}} characters"
- **Zod Validation**: Pre-interpolate messages before passing to zod validation
- **Translation Keys**: Use dot notation (e.g., `messages.welcome`, `forms.invalidEmail`)

#### File Naming Convention

**Rule**: All files use kebab-case, including React components

```bash
# React Components (kebab-case filenames)
components/
├── ui/
│   ├── alert.tsx              # exports Alert component
│   ├── avatar.tsx             # exports Avatar component
│   ├── button.tsx             # exports Button component
│   └── password-input.tsx     # exports PasswordInput component
└── layout/
    ├── sidebar.tsx            # exports Sidebar component
    ├── top-nav.tsx            # exports TopNav component
    └── mobile-nav.tsx         # exports MobileNav component

# Feature Components
features/
├── auth/
│   ├── components/
│   │   └── login-form.tsx     # exports LoginForm component
│   └── pages/
│       └── login-page.tsx     # exports LoginPage component
```

**Component Export Pattern**:

```tsx
// sidebar.tsx (kebab-case filename)
export function Sidebar() {
  // PascalCase export name
  return <div>...</div>;
}

// top-nav.tsx (kebab-case filename)
export function TopNav() {
  // PascalCase export name
  return <div>...</div>;
}
```

#### Directory Structure

```bash
project/
├── app/[locale]/              # Next.js routing
├── components/
│   ├── ui/                    # Reusable UI components
│   └── layout/                # Layout-specific components
├── features/                  # Feature-based organization
│   └── auth/
│       ├── components/        # Feature components
│       ├── core/              # Business logic
│       │   ├── hooks/         # Custom hooks (kebab-case.ts)
│       │   ├── services/      # Services (kebab-case.service.ts)
│       │   └── types/         # Types (kebab-case.types.ts)
│       └── providers/         # Auth providers
├── lib/                       # Utilities and configurations
├── locales/                   # i18n files
├── .agents/                   # Agent rules, lessons, skills
└── .opencode/                 # Agent commands & config
```

#### Code Organization

- **Feature-based structure**: Group by business feature, not technical layer
- **Core separation**: Business logic in `core/` directory
- **Type safety**: All types in dedicated `.types.ts` files
- **Service pattern**: All services end with `.service.ts`
- **Hook pattern**: All hooks use `use-` prefix and kebab-case filenames

#### Code Quality Tools

- [ ] Configure Prettier
- [ ] Configure ESLint
- [ ] Set up VSCode settings
- [ ] Add format and lint scripts
- [ ] Test formatting on sample files
- [ ] Verify file naming conventions follow kebab-case

#### Testing Setup

- [ ] Install testing framework (Vitest)
- [ ] Configure test environment
- [ ] Add test scripts
- [ ] Create basic verification test
- [ ] Set up coverage reporting

#### Git Configuration

```bash
# Set up user identity
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"

# Configure line endings
git config --global core.autocrlf false
git config --global core.eol lf

# Set up default branch
git config --global init.defaultBranch main
```

#### .gitignore Template

```gitignore
# Dependencies
node_modules/
.pnp
.pnp.js

# Production builds
.next/
out/
build/
dist/

# Environment variables
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Logs
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Runtime data
pids
*.pid
*.seed
*.pid.lock

# Coverage directory
coverage/
*.lcov

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Temporary files
*.tmp
*.temp
```

### Package.json Scripts Template

#### Development Scripts

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "lint:fix": "eslint --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest --coverage",
    "test:watch": "vitest --watch",
    "type-check": "tsc --noEmit",
    "clean": "rm -rf .next out dist node_modules",
    "reset": "bun run clean && bun install"
  }
}
```

### Recovery Commands

#### Dependency Issues

```bash
# Clear package manager cache
bun pm cache clean

# Reinstall all dependencies
rm -rf node_modules bun.lock
bun install

# Update dependencies
bun update

# Check for outdated packages
bun outdated
```

#### Git Issues

```bash
# Reset to clean state
git reset --hard HEAD
git clean -fd

# Fix corrupted repository
git fsck --full

# Recover lost commits
git reflog
git checkout -b recovery <commit-hash>
```

#### Configuration Issues

```bash
# Reset VSCode settings
code --reset-settings

# Clear npm cache
npm cache clean --force

# Reconfigure git
git config --global --unset-all user.name
git config --global --unset-all user.email
```

### Environment Variables Template

#### .env.example

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/dbname"

# Authentication
NEXTAUTH_SECRET="your-secret-key"
NEXTAUTH_URL="http://localhost:3000"

# External APIs
API_KEY="your-api-key"
WEBHOOK_SECRET="your-webhook-secret"

# Development
NODE_ENV="development"
PORT="3000"
```

### Docker Setup (Optional)

#### Dockerfile

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

RUN bun run build

EXPOSE 3000

CMD ["bun", "start"]
```

#### docker-compose.yml

```yaml
version: '3.8'
services:
  app:
    build: .
    ports:
      - '3000:3000'
    environment:
      - NODE_ENV=production
    depends_on:
      - db

  db:
    image: postgres:15
    environment:
      POSTGRES_DB: dbname
      POSTGRES_USER: user
      POSTGRES_PASSWORD: password
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

## Memory Triggers

- When setting up new projects
- When environment tools fail
- During onboarding process
- When collaborating with team members
- Before deployment
