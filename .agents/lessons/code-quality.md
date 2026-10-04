# Code Quality & Formatting Lessons

## Key Lessons Learned

### Prettier Configuration

- **Always establish code formatting standards early** - Prettier configuration prevents inconsistent formatting
- **Add format scripts to package.json** - Makes formatting accessible and repeatable
- **Configure IDE settings** - VSCode format-on-save prevents manual formatting errors
- **Use conventional commits** - Provides clear change history and automated version management

### Common Issues & Solutions

#### PowerShell vs Bash Syntax

- **Problem**: Using bash syntax in PowerShell environment
- **Solution**: Use PowerShell-specific commands (`Set-Content` instead of `echo`, proper escaping)
- **Example**: `Set-Content -Path ".prettierrc" -Value '{"semi": true}'`

#### File Encoding Issues

- **Problem**: Corrupted configuration files due to encoding
- **Solution**: Use proper file creation methods, verify file contents
- **Prevention**: Use IDE file creation instead of command-line when possible

#### JSON Configuration Errors

- **Problem**: Invalid JSON in configuration files
- **Solution**: Validate JSON syntax, use proper escaping
- **Prevention**: Use IDE JSON validation, copy-paste verified JSON

### Best Practices

#### Setup Checklist

- [ ] Install Prettier as dev dependency
- [ ] Create .prettierrc configuration file
- [ ] Add format script to package.json
- [ ] Configure VSCode settings for auto-formatting
- [ ] Test formatting on sample files

#### Maintenance

- [ ] Run `bun run format` before commits
- [ ] Check formatting with `npx prettier --check .`
- [ ] Update configuration when team preferences change
- [ ] Document any custom formatting rules

### Recovery Commands

```bash
# Reformat entire project
bun run format

# Check formatting issues
npx prettier --check .

# Reinstall prettier if corrupted
bun remove prettier && bun add -D prettier
```

### Configuration Templates

#### Basic .prettierrc

```json
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 80,
  "tabWidth": 2,
  "useTabs": false,
  "bracketSpacing": true,
  "bracketSameLine": false,
  "arrowParens": "always",
  "endOfLine": "lf"
}
```

#### VSCode Settings

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.prettier": "always",
    "source.removeUnusedImports": "always",
    "source.organizeImports": "always"
  }
}
```

## Memory Triggers

- When setting up new projects
- When formatting is inconsistent
- Before code reviews
- When onboarding team members
