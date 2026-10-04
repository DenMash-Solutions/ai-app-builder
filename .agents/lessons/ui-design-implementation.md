# UI Design Implementation Guidelines

> **Note**: Written for a prior project (dental management system). Treat the principles as guidance; adapt concrete examples to this app.

## Problem Description

- Need to ensure consistent UI implementation across the application
- Multiple developers may work on different views simultaneously
- Risk of deviating from the established design system
- Complex responsive requirements across three breakpoints
- Role-based UI variations add implementation complexity

## Solution Steps

1. **Always reference the UI plan first**
   - Check `docs/UI-PLAN.es.md` before implementing any UI component
   - Review the specific view requirements and design tokens
   - Understand the responsive behavior for the component

2. **Use the established design system**
   - Apply CSS custom properties from the design tokens section
   - Use shadcn/ui components as the foundation
   - Follow the color palette: sky blue primary (`#0EA5E9`), semantic status colors
   - Use DM Sans typography with specified weights and sizes

3. **Build mobile-first responsive layouts**
   - Start with mobile layout (<768px), then enhance for tablet (768-1023px) and desktop (≥1024px)
   - Transform tables to cards on mobile
   - Implement adaptive sidebar behavior
   - Use proper spacing: 24px desktop, 16px mobile

4. **Apply role-based filtering**
   - Admin: Sees everything including Users management
   - Doctor: Sees their own appointments and patient data
   - Assistant: Limited access, no patient creation if restricted
   - Use RoleGuard component for access control

5. **Include proper states**
   - Loading states using skeleton screens
   - Error states with inline validation
   - Empty states with contextual illustrations
   - Hover states and microinteractions

6. **Follow component conventions**
   - Status badges: color + text (never color alone)
   - Cards: white background, rounded-xl, shadow-sm
   - Forms: inline validation, proper error messages
   - Navigation: aria-current="page" for active states

## Prevention Strategies

- Keep the UI plan open during development sessions
- Create reusable components that follow the design system
- Use CSS custom properties instead of hardcoded values
- Test at all three breakpoints before committing
- Review accessibility requirements (focus rings, touch targets, screen readers)
- Document any deviations from the plan with clear reasoning

## Recovery Commands

```bash
# Check if UI plan exists and is accessible
cat docs/UI-PLAN.es.md | head -20

# Verify design tokens are implemented
grep -r "sky-500\|slate-900" app/ --include="*.tsx" --include="*.css"

# Test responsive behavior
# Use browser dev tools to test at 390px, 768px, and 1440px widths

# Check accessibility compliance
# Run lighthouse audit for accessibility score
```

## Related Files

- `docs/UI-PLAN.es.md` - Complete UI design specification
- `app/globals.css` - CSS custom properties and design tokens
- `components/ui/` - shadcn/ui component library
- `lib/roles.ts` - Role-based access control logic
