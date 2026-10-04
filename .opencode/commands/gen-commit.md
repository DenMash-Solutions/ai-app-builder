---
description: Generate conventional commit messages with intelligent change grouping and atomic commits
---

# Generate Commit Messages Workflow

This workflow analyzes all changes, groups them intelligently by scope/feature, and creates atomic commits with proper conventional commit messages.

## Steps

1. **Analyze all changes** - Examine git status and diff to understand what changed

   ```bash
   git status --porcelain
   git diff
   ```

2. **Intelligent grouping** - Group changes by related scope/feature following these rules:
   - Prioritize new and independent files
   - Ensure files don't break app dependencies
   - Prefer atomic commits
   - Group related functionality together

3. **Show grouping summary** - Display groups with files and suggested commit messages

   ```
   Group 1: feat(core): add authentication module
   ├── src/auth/login.js
   ├── src/auth/register.js
   └── src/auth/middleware.js

   Group 2: feat(ui): add user dashboard
   ├── components/Dashboard.jsx
   └── styles/dashboard.css
   ```

4. **Process groups one by one** - Handle each group sequentially with user confirmation
   - Stage files for current group
   - Generate conventional commit message using git-commit skill
   - Add optional body with bullet points if additional information needed
   - Display commit preview as command before asking for confirmation
   - Present commit message for approval

5. **User confirmation shortcuts**:
   - `y` - Accept grouping and proceed to commit message review
   - `yy` - Accept grouping and commit message directly
   - `n` - Skip this group
   - `r` - Regroup files

6. **Create commits** - Apply approved commit messages
   ```bash
   git add <group-files>
   git commit -m "<approved-commit-message>"
   ```

## Commit Message Format

The workflow generates commit messages following this structure:

```
<type>[scope]: <description>

[optional body with bullet points]
- Change 1 summary
- Change 2 summary
- Change 3 summary
```

**Example with body:**

```
feat(auth): implement user authentication

- Add login and registration components
- Implement JWT token validation
- Create authentication middleware
- Add user session management
```

**Command preview example:**

```bash
git commit -m "feat(auth): implement user authentication

- Add login and registration components
- Implement JWT token validation
- Create authentication middleware
- Add user session management"
```

## Usage

Run this workflow when you:

- Have multiple changes that need intelligent grouping
- Want to ensure atomic, dependency-safe commits
- Need to organize complex changes into logical units
- Want to review and approve commit messages before committing

## Grouping Algorithm

The workflow uses these heuristics for grouping:

- **File relationships**: Files in same directory or related directories
- **Feature cohesion**: Files that implement the same feature
- **Dependency analysis**: Ensure grouped files don't break existing functionality
- **Atomic principle**: Each group should be independently commitable

## Notes

- Uses the git-commit skill for conventional commit message generation
- Follows conventional commits specification: `<type>[scope]: <description>`
- Processes groups sequentially to maintain control over each commit
- Prioritizes new files and independent functionality
- Ensures no dependency conflicts between groups
