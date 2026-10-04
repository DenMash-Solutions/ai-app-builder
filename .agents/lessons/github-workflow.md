# GitHub Workflow & Collaboration Lessons

## Key Lessons Learned

### Workflow Optimization

- **Clarify ambiguous workflow states** - "Review Ready" must explicitly include PR being pushed
- **Document tool limitations** - MCP tools may have bugs, always have fallback strategies
- **Use GitHub API directly when tools fail** - Direct API calls can bypass MCP tool issues
- **Update rules immediately when confusion discovered** - Prevents future workflow violations

### Branch Management

- **Use consistent naming convention**: `<type>/<user>/<issue>-<scope>`
- **Always create branch before starting work**
- **Assign issues to track ownership**
- **Clean up branches after merge**

### Common Issues & Solutions

#### PR Assignment/Labeling Issues

- **Problem**: The GitHub MCP update-PR tool may fail with "No update parameters provided"
- **Solution**: Use the generic issue-write/update-issue method instead - PRs are also issues in GitHub API
- **Example**: `update_issue(method="update", issue_number=PR_NUMBER, assignees=["username"])`

#### Solo Project Review Requirements

- **Problem**: Cannot request review from PR author in solo projects
- **Solution**: Updated workflow rules to account for solo vs team projects
- **Guideline**: Assign PR to author for tracking, mark as ready for merge without external review

#### Branch Switching Conflicts

- **Problem**: Local changes prevent switching branches
- **Solution**: Commit or stash changes before switching branches
- **Command**: `git add . && git commit -m "WIP: temporary commit"`

### Workflow States

#### Issue States

- **Open**: Ready to be assigned
- **In Progress**: Branch created and work started
- **Review Ready**: Pull request created AND pushed
- **Done**: Pull request merged and moved to main branch

#### Branch Types

- `feature` - New functionality
- `bugfix` - Bug fixes
- `hotfix` - Critical fixes that need immediate deployment
- `refactor` - Code refactoring without functional changes
- `docs` - Documentation updates
- `test` - Test additions or improvements

### Best Practices

#### Before Starting Work

- [ ] Create new branch with proper naming
- [ ] Assign issue to yourself
- [ ] Ensure main branch is up to date
- [ ] Check for any conflicting work

#### During Development

- [ ] Keep commits focused and atomic
- [ ] Reference issue number in commit messages: `Fixes #123`
- [ ] Update issue with progress as needed
- [ ] Use conventional commit messages

#### Before Creating PR

- [ ] Ensure all tests pass
- [ ] Update documentation if applicable
- [ ] Link PR to the GitHub issue
- [ ] Use issue number in PR title

#### PR Requirements

- [ ] Title clearly describes the change
- [ ] Description references the issue number
- [ ] Assign PR to author for tracking
- [ ] Add appropriate labels
- [ ] Mark as ready for merge (solo) or request review (team)

### Tool Limitations & Workarounds

#### MCP Tool Issues

- Some MCP tools may have bugs or limitations
- Always have fallback strategies for critical workflow steps
- Document tool-specific workarounds in the rules
- Use GitHub API directly when MCP tools fail

#### Git Commands Reference

```bash
# Create and switch to new branch
git checkout -b feature/user/1-project-setup

# Switch branches (clean working directory)
git checkout main

# Stash changes temporarily
git stash push -m "WIP: temporary changes"

# Apply stashed changes
git stash pop

# Force push (use carefully)
git push --force-with-lease origin feature-branch
```

#### GitHub API Examples

```bash
# Create issue via API
curl -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/repos/owner/repo/issues \
  -d '{"title":"Issue title","body":"Issue description"}'
```

### Recovery Commands

```bash
# Reset to last known good state
git reset --hard HEAD

# Clean up uncommitted changes
git clean -fd

# Recover lost branch
git reflog
git checkout -b recovered-branch <commit-hash>

# Undo last commit (keep changes)
git reset --soft HEAD~1
```

## Memory Triggers

- Before creating branches or PRs
- When GitHub tools fail
- During workflow confusion
- When onboarding team members
- Before setting up new repositories
