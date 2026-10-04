# GitHub Issue Workflow Rules

## Branch Naming Convention

For each issue you work on, you must create a new branch following this pattern:

```
<type>/<user>/<issue>-<scope>
```

### Examples:

- `feature/mario/1-project-set-up`
- `bugfix/mario/42-login-validation`
- `hotfix/mario/99-critical-security-patch`

### Branch Types:

- `feature` - New functionality
- `bugfix` - Bug fixes
- `hotfix` - Critical fixes that need immediate deployment
- `refactor` - Code refactoring without functional changes
- `docs` - Documentation updates
- `test` - Test additions or improvements

## Issue-Based Development Process

0. **Pre-Action Confirmation**
   - **Before creating or editing any GitHub resources (issues, PRs, branches)**
   - **Always ask for user confirmation first**
   - **Show a detailed preview of intended actions including:**
     - What will be created/edited
     - All parameters and configurations
     - Expected outcomes
     - Any side effects
     - **GitHub URLs for reference** (issue links, branch links, etc.)
   - **Wait for explicit user approval before proceeding**

1. **Before Starting Work**
   - **Check if branch exists locally and remotely** using `git branch -a` and `git ls-remote origin`
   - If branch exists: checkout existing branch
   - If branch doesn't exist: create new branch using naming convention
   - Reference the issue number in the branch name
   - **Assign the issue to the user working on it**
   - Ensure the issue is assigned to you

2. **During Development**
   - Keep commits focused and atomic
   - Reference the issue number in commit messages: `Fixes #123`
   - Update the issue with progress as needed

3. **Before Creating Pull Request**
   - Ensure all tests pass
   - Update documentation if applicable
   - Link the pull request to the GitHub issue

4. **Pull Request Requirements**
   - Title should clearly describe the change
   - Description must reference the issue number
   - Use the same issue number in the PR title if possible
   - **Assign the PR to the author** for tracking
   - **Add appropriate labels** (e.g., enhancement, bugfix, feature-name)
   - **For solo projects**: Mark as ready for merge without external review
   - **For team projects**: Request review from appropriate team members

## Issue States

- **Open**: Ready to be assigned
- **In Progress**: Branch created and work started
- **Review Ready**: Pull request created AND pushed
- **Done**: Pull request merged and moved to main branch

## Post-Completion Steps

After completing an issue:

- Ensure the pull request is merged
- **Move back to the main branch**
- Clean up local feature branch if needed

## Troubleshooting & Lessons Learned

### Common Issues and Solutions

1. **PR Assignment/Labeling Issues**
   - **Problem**: The GitHub MCP update-PR tool may fail with "No update parameters provided"
   - **Solution**: Use the generic issue-write/update-issue method instead - PRs are also issues in GitHub API
   - **Example**: `update_issue(method="update", issue_number=PR_NUMBER, assignees=["username"])`

2. **Solo Project Review Requirements**
   - **Problem**: Cannot request review from PR author in solo projects
   - **Solution**: Updated workflow rules to account for solo vs team projects
   - **Guideline**: Assign PR to author for tracking, mark as ready for merge without external review

3. **Branch Switching Conflicts**
   - **Problem**: Local changes prevent switching branches
   - **Solution**: Commit or stash changes before switching branches
   - **Command**: `git add . && git commit -m "Update workflow rules"`

### Best Practices

- **Always verify tool functionality** - If a tool fails repeatedly, search for alternative approaches
- **Document workarounds** - Add solutions to workflow rules for future reference
- **Test workflow updates** - Ensure new rules work before relying on them
- **Use GitHub API directly** - When MCP tools fail, fall back to direct GitHub API calls

### Tool Limitations

- Some MCP tools may have bugs or limitations
- Always have fallback strategies for critical workflow steps
- Document tool-specific workarounds in the rules
