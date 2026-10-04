# Code Generation Rules

## Code Quality Standards

### Formatting

- **All code must be formatted using Prettier** (`bun run format`, check with `bun run format:check`)
- Prettier config lives at `.prettierrc` — keep it consistent across the project
- Run Prettier before commits

### Modern Practices

- **Never use deprecated code** - always use current APIs and syntax
- **Research official documentation** when uncertain about modern practices
- Prefer functional programming patterns where appropriate
- Use TypeScript strict mode for type safety

## Best Practices

### General Principles

- **DRY (Don't Repeat Yourself)** - extract reusable logic
- **KISS (Keep It Simple, Stupid)** - favor simple solutions
- **SOLID principles** - single responsibility, open/closed, etc.
- **YAGNI (You Aren't Gonna Need It)** - avoid over-engineering

### Code Structure

- Use clear, descriptive variable and function names
- Keep functions small and focused on single responsibility
- Organize imports properly (third-party, then internal)
- Use consistent file naming conventions

### Error Handling

- Always handle potential errors gracefully
- Use proper TypeScript error types
- Implement meaningful error messages
- Log errors appropriately for debugging

### Performance

- Optimize for readability first, then performance
- Use lazy loading where beneficial
- Implement proper caching strategies
- Avoid unnecessary re-renders in React

### Security

- Validate all user inputs
- Use environment variables for sensitive data
- Implement proper authentication and authorization
- Follow OWASP security guidelines

### Testing

- Write unit tests for business logic
- Use integration tests for critical flows
- Maintain good test coverage
- Test edge cases and error scenarios

### Documentation

- Document complex logic with comments
- Use JSDoc for public APIs
- Keep README files updated
- Document configuration and setup

## Technology-Specific Guidelines

### React/Next.js

- Use functional components with hooks
- Implement proper state management
- Use TypeScript for all components
- Follow React best practices for performance

### Database

- Use parameterized queries to prevent SQL injection
- Implement proper indexing strategies
- Use transactions for data consistency
- Follow database normalization principles

### API Design

- Use RESTful principles for APIs
- Implement proper HTTP status codes
- Use consistent response formats
- Document API endpoints clearly

## Code Review Checklist

- [ ] Code follows Prettier formatting
- [ ] No deprecated APIs or syntax
- [ ] Proper error handling implemented
- [ ] Security best practices followed
- [ ] Tests written and passing
- [ ] Documentation updated
- [ ] Performance considerations addressed
- [ ] Code is readable and maintainable
