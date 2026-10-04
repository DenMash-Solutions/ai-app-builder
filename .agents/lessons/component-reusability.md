# Component Reusability Principles

> **Note**: Code examples (`features/patients/`, translation props) come from a prior i18n project — apply the reusability principles to this repo.

## Overview

This lesson covers critical principles for creating truly reusable React components that maintain clean separation of concerns and avoid tight coupling with parent components.

## 🏗️ Component Organization Patterns

### **Sub-component Organization (Dashboard Pattern)**

**✅ CORRECT - Sub-component structure:**

```
features/patients/components/
├── patient-card/           # Sub-component folder
│   ├── patient-card.tsx    # Main component
│   ├── patient-skeleton.tsx # Loading state
│   └── index.ts            # Clean exports
├── patients-list/          # Sub-component folder
│   ├── patients-list.tsx   # Main component
│   ├── list-empty-state.tsx # Empty state
│   ├── list-loading-skeleton.tsx # Loading skeleton
│   └── index.ts            # Clean exports
└── patient-search/         # Sub-component folder
    ├── patient-search.tsx  # Main component
    └── index.ts            # Clean exports
```

**Benefits:**

- **Co-location**: Related components grouped together
- **Scalability**: Easy to add variants (skeletons, states)
- **Clean Imports**: Both specific and feature-level imports
- **Consistency**: Same pattern across all features

### **Import Patterns**

**✅ CORRECT - Multiple import options:**

```typescript
// From specific sub-component
import { PatientCard, PatientSkeleton } from '@/features/patients/components/patient-card';

// From feature index (clean API)
import { PatientCard, usePatients } from '@/features/patients';

// From page level
import { PatientsList } from '@/features/patients/components/patients-list';
```

**❌ WRONG - Flat structure:**

```
features/patients/components/
├── patient-card.tsx         # Mixed with other components
├── patient-skeleton.tsx     # No clear ownership
├── patients-list.tsx        # All mixed together
└── patient-search.tsx       # Hard to find related pieces
```

### **Feature Structure (Auth Pattern)**

**✅ CORRECT - Complete feature organization:**

```
features/patients/
├── actions/           # Server actions (CRUD operations)
├── components/        # UI components with sub-organization
├── hooks/            # Feature-specific hooks
├── pages/            # Page components
├── utils/            # Feature utilities
└── index.ts          # Clean public API
```

**Benefits:**

- **Separation of Concerns**: Business logic vs presentation
- **Testability**: Pure components + testable hooks
- **Maintainability**: Clear boundaries between layers
- **Consistency**: Same pattern across all features

## 🚨 Common Reusability Violations

### 1. Translation Props Violation

**❌ WRONG - Component not truly reusable:**

```typescript
interface UpcomingAppointmentsProps {
  appointments: Appointment[];
  loading?: boolean;
  maxItems?: number;
  emptyStateTitle?: string;        // ❌ Violates reusability
  emptyStateDescription?: string;   // ❌ Violates reusability
}

// Parent must know component's translation keys
<UpcomingAppointments
  appointments={data.todayAppointments || []}
  maxItems={10}
  emptyStateTitle={t('dashboard.schedule.emptyState.title')}
  emptyStateDescription={t('dashboard.schedule.emptyState.description')}
/>
```

**Problems:**

- Tight coupling between parent and component
- Parent must know component's internal translation structure
- Component is not truly reusable across different contexts
- Violates single responsibility principle

### 2. Hard-coded Strings Violation

**❌ WRONG - Hard-coded strings in component:**

```typescript
if (displayAppointments.length === 0) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <h3 className="text-lg font-semibold mb-2">No upcoming appointments</h3>
      <p className="text-muted-foreground">Your schedule is clear for now</p>
    </div>
  );
}
```

**Problems:**

- No internationalization support
- Cannot be localized
- Violates i18n compliance requirements

## ✅ Correct Reusability Patterns

### 1. Component Manages Its Own i18n

**✅ CORRECT - Truly reusable component:**

```typescript
import { useTranslations } from 'next-intl';

interface UpcomingAppointmentsProps {
  appointments: Appointment[];
  loading?: boolean;
  maxItems?: number;
}

export function UpcomingAppointments({
  appointments,
  loading,
  maxItems = 5,
}: UpcomingAppointmentsProps) {
  const t = useTranslations(); // ✅ No arguments - truly reusable

  if (displayAppointments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <h3 className="text-lg font-semibold mb-2">
          {t('appointments.emptyState.title')} {/* ✅ Component's own translation */}
        </h3>
        <p className="text-muted-foreground">
          {t('appointments.emptyState.description')} {/* ✅ Component's own translation */}
        </p>
      </div>
    );
  }
}
```

**❌ WRONG - Namespace argument limits reusability:**

```typescript
export function PatientSearch({ onSearch }: PatientSearchProps) {
  const t = useTranslations('patients'); // ❌ Arguments limit reusability

  // This component can only be used in 'patients' context!
  // What if we want to reuse it for doctors, appointments, etc.?
}

export default async function PatientsPage({ locale }: PatientsPageProps) {
  const t = await getTranslations({ locale }, 'patients'); // ❌ Arguments limit reusability

  // This page can only be used in 'patients' context!
}
```

**✅ CORRECT - No namespace arguments for maximum reusability:**

```typescript
export function PatientSearch({ onSearch }: PatientSearchProps) {
  const t = useTranslations(); // ✅ No arguments - truly reusable
  // Usage: t('patients.search.title')
}

export default async function PatientsPage({ locale }: PatientsPageProps) {
  const t = await getTranslations({ locale }); // ✅ No arguments - truly reusable
  // Usage: t('patients.title')
}
```

**✅ CORRECT - Clean and reusable usage:**

```typescript
<UpcomingAppointments
  appointments={data.todayAppointments || []}
  maxItems={10}
/>
```

### 2. Generic Empty State Component

**✅ CORRECT - Separate reusable empty state:**

```typescript
interface EmptyStateProps {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

export function EmptyState({ title, description, icon: Icon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <Icon className="h-12 w-12 text-muted-foreground mb-4" />
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-muted-foreground">{description}</p>
    </div>
  );
}

// Usage in component:
export function UpcomingAppointments({ appointments, loading, maxItems = 5 }: UpcomingAppointmentsProps) {
  const t = useTranslations();

  if (displayAppointments.length === 0) {
    return (
      <EmptyState
        title={t('appointments.emptyState.title')}
        description={t('appointments.emptyState.description')}
        icon={Calendar}
      />
    );
  }
}
```

## 📋 Translation Structure for Reusable Components

### Component-Specific Namespaces

```json
{
  "appointments": {
    "emptyState": {
      "title": "No upcoming appointments",
      "description": "Your schedule is clear for now"
    },
    "status": {
      "scheduled": "Scheduled",
      "confirmed": "Confirmed",
      "completed": "Completed",
      "cancelled": "Cancelled",
      "no_show": "No Show"
    }
  },
  "dashboard": {
    "title": "Dashboard",
    "welcome": "Welcome back! Here's your clinic overview."
  }
}
```

**Benefits:**

- Component owns its translation namespace
- Clear separation of concerns
- Easy to maintain and test
- Truly reusable across different contexts

## 🎯 Reusability Principles

### 1. Single Responsibility

- Each component should manage its own concerns
- Don't make parent components manage child component's i18n

### 2. Loose Coupling

- Components should not depend on parent's translation context
- Avoid passing translation props for component's internal text

### 3. High Cohesion

- Component's related functionality (including i18n) should be self-contained

### 4. Encapsulation

- Hide implementation details (like translation keys) from parent components

## 🔍 Memory Triggers

When you see these patterns → STOP and check reusability:

- `emptyStateTitle?: string` → Component not truly reusable
- `title?: string` props for internal text → Violates encapsulation
- Parent passing translation keys to child → Tight coupling
- Hard-coded strings in components → No i18n support
- `useTranslations('namespace')` → Arguments limit reusability
- `getTranslations({ locale }, 'namespace')` → Arguments limit reusability
- **Flat component structure** → No sub-component organization
- **Translation props in interfaces** → Violates reusability principles
- **Mixed responsibilities in components** → Business logic + UI mixed

## ✅ Reusability Checklist

Before implementing components, verify:

- [ ] **Self-Contained**: Component manages its own i18n
- [ ] **Clean Interface**: No translation props for internal text
- [ ] **Reusable**: Can be used anywhere without parent knowing translation keys
- [ ] **No Client Arguments**: `useTranslations()` called without namespace arguments
- [ ] **No Server Arguments**: `getTranslations({ locale })` called without namespace arguments
- [ ] **Sub-component Organization**: Related components grouped in folders
- [ ] **Clean Exports**: Index files for clean import APIs
- [ ] **Feature Structure**: Follow auth pattern with actions/hooks/utils separation
- [ ] **Testable**: Easy to test in isolation
- [ ] **Maintainable**: Single responsibility for i18n
- [ ] **Consistent**: Same translation keys across all usages

## 🚀 Benefits of True Reusability

1. **Maintainability**: Changes to component's text only require updating the component
2. **Testability**: Components can be tested in isolation
3. **Reusability**: Same component can be used anywhere
4. **Consistency**: Same translation keys across all contexts
5. **Developer Experience**: Cleaner API for component consumers

---

**REMEMBER: Truly reusable components manage their own concerns, including i18n. Don't make parent components manage child component's internal text!**
