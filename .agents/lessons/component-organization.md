# Component Organization Patterns

> **Note**: Directory examples (`features/patients/`, dashboard) come from a prior project — apply the organization principles to this repo's structure.

## Overview

This lesson covers the best practices for organizing React components within features, following the successful patterns established in the auth and dashboard features.

## 🏗️ Sub-component Organization (Dashboard Pattern)

### **✅ CORRECT - Sub-component structure**

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

### **Benefits:**

1. **Co-location**: Related components grouped together
2. **Scalability**: Easy to add variants (skeletons, states)
3. **Clean Imports**: Both specific and feature-level imports
4. **Consistency**: Same pattern across all features
5. **Maintainability**: Changes isolated to specific sub-folders

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

## 📁 Feature Structure (Auth Pattern)

### **✅ CORRECT - Complete feature organization**

```
features/patients/
├── actions/           # Server actions (CRUD operations)
│   └── patient.actions.ts
├── components/        # UI components with sub-organization
│   ├── patient-card/
│   ├── patients-list/
│   ├── patients-grid/
│   └── patient-search/
├── hooks/            # Feature-specific hooks
│   ├── use-patients.ts
│   ├── use-patient-actions.ts
│   └── use-patient-search.ts
├── pages/            # Page components
│   ├── patients-page.tsx
│   └── patient-detail-page.tsx
├── utils/            # Feature utilities
│   ├── patient-utils.ts
│   └── patient-constants.ts
└── index.ts          # Clean public API
```

### **Benefits:**

1. **Separation of Concerns**: Business logic vs presentation
2. **Testability**: Pure components + testable hooks
3. **Maintainability**: Clear boundaries between layers
4. **Consistency**: Same pattern across all features
5. **Scalability**: Easy to add new functionality

## 🔧 Index File Patterns

### **✅ CORRECT - Clean sub-component exports**

```typescript
// features/patients/components/patient-card/index.ts
export { PatientCard } from './patient-card';
export { PatientSkeleton } from './patient-skeleton';
```

### **✅ CORRECT - Clean feature exports**

```typescript
// features/patients/index.ts
/**
 * Patients feature public API.
 * Exports all patients-related functionality.
 */

// Components
export { PatientCard, PatientSkeleton } from './components/patient-card';
export { PatientsList, PatientsEmptyState } from './components/patients-list';
export { PatientsGrid } from './components/patients-grid';
export { PatientSearch } from './components/patient-search';

// Hooks
export { usePatients } from './hooks/use-patients';
export { usePatientActions } from './hooks/use-patient-actions';

// Pages
export { PatientsPage } from './pages/patients-page';

// Re-export types from providers
export type { Patient, CreatePatientData, UpdatePatientData } from '@/providers/domain/patients';
```

## 🎯 Component Design Principles

### **1. Single Responsibility**

Each component should have one clear purpose:

```typescript
// ✅ CORRECT - Single responsibility
export function PatientCard({ patient }: Props) {
  // Only handles displaying a single patient
}

export function PatientsGrid({ patients }: Props) {
  // Only handles grid layout
}

export function PatientsList({ patients, loading }: Props) {
  // Only handles list orchestration
}
```

### **2. Pure UI Components**

Components should not contain business logic:

```typescript
// ✅ CORRECT - Pure UI component
export function PatientCard({ patient, user }: Props) {
  const t = useTranslations(); // ✅ No arguments

  return (
    <Card>
      {/* Pure UI rendering */}
    </Card>
  );
}

// ❌ WRONG - Business logic in component
export function PatientCard({ patient }: Props) {
  const [patients, setPatients] = useState([]); // ❌ Business logic

  useEffect(() => {
    loadPatients(); // ❌ Data fetching
  }, []);
}
```

### **3. Feature Hooks for Business Logic**

Move business logic to feature hooks:

```typescript
// ✅ CORRECT - Feature hook
export function usePatients(searchTerm?: string) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);

  // All business logic here

  return { patients, loading, refetch };
}
```

## 🔍 Memory Triggers

When you see these patterns → STOP and check organization:

- **Flat component structure** → No sub-component organization
- **Business logic in components** → Move to hooks
- **Mixed responsibilities** → Separate concerns
- **No index files** → Missing clean exports
- **Translation props** → Violates reusability
- **Large components** → Need to split

## ✅ Organization Checklist

Before implementing components, verify:

- [ ] **Sub-component Folders**: Related components grouped together
- [ ] **Index Files**: Clean exports for each sub-component
- [ ] **Feature Structure**: Follow auth pattern with actions/hooks/utils
- [ ] **Pure UI Components**: No business logic in components
- [ ] **Feature Hooks**: Business logic in dedicated hooks
- [ ] **Clean Imports**: Multiple import options available
- [ ] **Single Responsibility**: Each component has one purpose
- [ ] **Consistent Naming**: Follow established patterns

## 🚀 Benefits of Proper Organization

1. **Maintainability**: Easy to find and modify related code
2. **Scalability**: Simple to add new components and features
3. **Testability**: Isolated components are easy to test
4. **Developer Experience**: Predictable structure across features
5. **Code Reusability**: Components can be reused across contexts
6. **Team Collaboration**: Clear patterns for all developers

## 📚 Real-world Examples

### **Dashboard Feature (Excellent)**

```
features/dashboard/components/upcoming-appointments/
├── appointment-item.tsx
├── appointment-skeleton.tsx
├── upcoming-appointments.tsx
└── index.ts
```

### **Auth Feature (Excellent)**

```
features/auth/
├── actions/auth.actions.ts
├── components/login-form.tsx
├── hooks/use-auth.tsx
├── middleware/auth-middleware.ts
├── pages/login-page.tsx
├── utils/role-utils.ts
└── index.ts
```

### **Patients Feature (Updated)**

```
features/patients/
├── actions/patient.actions.ts
├── components/
│   ├── patient-card/
│   ├── patients-list/
│   ├── patients-grid/
│   └── patient-search/
├── hooks/use-patients.ts
├── pages/patients-page.tsx
├── utils/patient-utils.ts
└── index.ts
```

**Follow these patterns for consistent, maintainable, and scalable component organization!**
