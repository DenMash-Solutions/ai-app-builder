---
description: Scan the browser console for JS errors, failed requests, and rendering issues (requires chrome-devtools MCP server — not configured in this project yet)
---

> **Requires**: the `chrome-devtools` MCP server. Add it to `opencode.json` (`"mcp"`) before running; otherwise skip and report that it is unavailable.

## Overview

This workflow uses the chrome-devtools MCP server to scan browser console for JavaScript errors, warnings, failed API calls, and other issues that could affect the application functionality. It provides automated browser control and comprehensive error reporting.

## Steps

### 1. Browser Setup

- Opens browser and navigates to the app
- Ensures proper state (authentication if applicable)
- Sets up error monitoring via chrome-devtools MCP

### 2. Error Detection

- Scans browser console for JavaScript errors using chrome-devtools
- Identifies failed network requests and API call failures
- Detects component rendering issues and React errors
- Catches unhandled promise rejections and type errors

### 3. Error Categorization

- **Console Errors**: JavaScript syntax errors, runtime exceptions
- **Network Errors**: Failed API calls, timeout issues, CORS problems
- **Component Errors**: React rendering failures, missing props, hydration issues
- **Performance Issues**: Slow loading, memory leaks, layout shifts
- **TypeScript Errors**: Type mismatches, compilation issues

### 4. Error Reporting

- Generates structured JSON error report with severity levels
- Provides actionable debugging steps with code snippets
- Categorizes errors by type and component affected
- Includes browser screenshots for visual evidence

### 5. Browser Automation

- Automated browser control via chrome-devtools MCP
- Captures screenshots for visual debugging
- Monitors network activity and performance metrics
- Provides comprehensive debugging environment

## Usage

**IMPORTANT**: When the user asks to run this command or mentions executing this workflow, the agent MUST immediately start executing the workflow steps below WITHOUT asking for confirmation first.

This workflow is triggered by agent using MCP capabilities. The agent will:

1. **Initialize Browser**: Use chrome-devtools MCP to open browser and navigate to the app
2. **Monitor Console**: Scan for JavaScript errors, warnings, and console messages
3. **Check Network**: Monitor failed API calls and network requests
4. **Capture Screenshots**: Take screenshots of any issues found
5. **Analyze Errors**: Categorize and prioritize issues by severity
6. **Generate Fixes**: Create and implement fixes for detected errors
7. **Verify Solutions**: Test fixes and confirm errors are resolved
8. **Generate Report**: Create structured report with issues and fixes applied

**Start execution immediately upon user request to run this workflow.**

## Agent Implementation

The agent should use these MCP capabilities for error detection AND fixing:

```typescript
// 1. Navigate to the page
await mcp1_navigate_page({
  type: 'url',
  url: 'http://localhost:3000/',
});

// 2. Wait for page load and monitor console
const consoleMessages = await mcp1_list_console_messages();

// 3. Check network requests for failures
const networkRequests = await mcp1_list_network_requests();

// 4. Take initial screenshot
const screenshot = await mcp1_take_screenshot();

// 5. Analyze and categorize errors
const errorAnalysis = analyzeErrors(consoleMessages, networkRequests);

// 6. Generate and apply fixes
const fixes = await generateAndApplyFixes(errorAnalysis);

// 7. Verify fixes worked
const verification = await verifyFixes(fixes);

// 8. Take final screenshot showing fixes
const afterFixScreenshot = await mcp1_take_screenshot();

// 9. Generate comprehensive report
const errorReport = {
  initialErrors: errorAnalysis,
  fixesApplied: fixes,
  verificationResults: verification,
  screenshots: {
    before: screenshot,
    after: afterFixScreenshot,
  },
  timestamp: new Date().toISOString(),
};
```

## Error Analysis & Fix Implementation

### Error Categorization Function

```typescript
function analyzeErrors(consoleMessages, networkRequests) {
  return {
    critical: consoleMessages.filter((msg) => msg.level === 'error'),
    warnings: consoleMessages.filter((msg) => msg.level === 'warning'),
    networkErrors: networkRequests.filter((req) => req.status >= 400),
    reactErrors: consoleMessages.filter((msg) => msg.message.includes('React')),
    performanceIssues: [], // From performance traces
  };
}
```

### Fix Generation Function

```typescript
async function generateAndApplyFixes(errorAnalysis) {
  const fixes = [];

  // Fix JavaScript errors
  for (const error of errorAnalysis.critical) {
    const fix = await generateJavaScriptFix(error);
    await applyFix(fix);
    fixes.push(fix);
  }

  // Fix network errors
  for (const networkError of errorAnalysis.networkErrors) {
    const fix = await generateNetworkFix(networkError);
    await applyFix(fix);
    fixes.push(fix);
  }

  return fixes;
}
```

### Fix Application Examples

```typescript
// Example: Fix missing import error
async function generateJavaScriptFix(error) {
  if (error.message.includes('Cannot find module')) {
    return {
      type: 'import_fix',
      description: 'Add missing import statement',
      action: 'add_import',
      target: error.sourceFile,
      code: `import { MissingComponent } from './components';`,
    };
  }

  // Example: Fix API endpoint error
  if (error.message.includes('404')) {
    return {
      type: 'api_fix',
      description: 'Fix API endpoint route',
      action: 'update_route',
      target: 'api/routes.ts',
      code: `// Add missing route handler`,
    };
  }
}
```

### Verification Function

```typescript
async function verifyFixes(fixes) {
  const verification = [];

  // Refresh page to check fixes
  await mcp1_navigate_page({ type: 'reload' });

  // Wait for reload
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Check if errors are resolved
  const newConsoleMessages = await mcp1_list_console_messages();
  const remainingErrors = newConsoleMessages.filter((msg) => msg.level === 'error');

  verification.push({
    fixesApplied: fixes.length,
    errorsResolved: errorAnalysis.critical.length - remainingErrors.length,
    success: remainingErrors.length === 0,
  });

  return verification;
}
```

## Available Chrome DevTools MCP Functions

- `mcp1_navigate_page()` - Navigate to URLs
- `mcp1_list_console_messages()` - Get console errors/warnings
- `mcp1_list_network_requests()` - Monitor network activity
- `mcp1_take_screenshot()` - Capture visual evidence
- `mcp1_take_snapshot()` - Get page DOM structure
- `mcp1_evaluate_script()` - Execute JavaScript for debugging
- `mcp1_performance_start_trace()` - Performance analysis
- `mcp1_lighthouse_audit()` - Accessibility/SEO analysis

## Complete Workflow Flow

### Phase 1: Detection (Steps 1-4)

1. **Navigate & Load**: Open the app, wait for full page load
2. **Scan & Monitor**: Collect console errors, network failures, React issues
3. **Capture Evidence**: Take screenshots of error states
4. **Categorize & Prioritize**: Sort by severity and impact

### Phase 2: Analysis (Step 5)

5. **Error Analysis**: Break down errors by type, source, and fix complexity

### Phase 3: Fixing (Steps 6-7)

6. **Generate Fixes**: Create specific code fixes for each error type
7. **Apply Solutions**: Implement fixes using MCP tools

### Phase 4: Verification (Steps 8-9)

8. **Verify Resolution**: Refresh page, confirm errors are resolved
9. **Final Evidence**: Capture after-fix screenshots

### Phase 5: Reporting

10. **Comprehensive Report**: Document entire process with before/after comparison

## Requirements

- Chrome browser with devtools access
- chrome-devtools MCP server available
- Application running locally
- Network connectivity for API calls

## Output

The workflow generates a comprehensive error detection AND fixing report:

- **Initial Analysis**: Categorized errors by severity and type
- **Fixes Applied**: Automated fixes implemented with code changes
- **Verification Results**: Before/after comparison showing resolution
- **Screenshots**: Visual evidence (before fix + after fix)
- **Performance Metrics**: Page load times, network status, component render times
- **Code Changes**: Specific files modified with fix implementations
- **Success Rate**: Percentage of errors successfully resolved

## Common Error Patterns & Auto-Fixes

### 1. Import/Module Errors

```typescript
// Error: Cannot find module './MissingComponent'
// Auto-Fix: Add missing import statement
await mcp1_evaluate_script({
  function: `() => {
    const code = document.createElement('script');
    code.textContent = "import { MissingComponent } from './components';";
    document.head.appendChild(code);
    return location.reload();
  }`,
});
```

### 2. API Endpoint Errors

```typescript
// Error: 404 - GET /api/users
// Auto-Fix: Create missing API route
await mcp1_evaluate_script({
  function: `() => {
    // Create missing route file content
    const routeContent = \`export async function GET() {
      return Response.json({ users: [] });
    }\`;
    // Save to file system (if possible) or suggest manual action
    console.log('Create file: app/api/users/route.ts');
    return routeContent;
  }`,
});
```

### 3. React Component Errors

```typescript
// Error: Component failed to render
// Auto-Fix: Fix component props or state
await mcp1_evaluate_script({
  function: `() => {
    // Identify missing props or state issues
    const errorElement = document.querySelector('[data-react-error]');
    if (errorElement) {
      console.log('React Error:', errorElement.textContent);
      // Suggest specific fix based on error type
    }
    return { needsPropsFix: true, error: errorElement.textContent };
  }`,
});
```

### 4. CSS/Styling Errors

```typescript
// Error: CSS class not found
// Auto-Fix: Add missing CSS class
await mcp1_evaluate_script({
  function: `() => {
    // Check for missing CSS classes
    const styles = document.styleSheets;
    const missingClasses = [];
    // Analyze and suggest missing class definitions
    return { missingClasses, suggestedFixes: missingClasses.map(cls => \`.${cls} { /* styles */ }\`) };
  }`,
});
```
