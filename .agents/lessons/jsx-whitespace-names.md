# JSX Whitespace Is Stripped — Names and Text Run Together

> **Lesson source**: Playwright `hasText: /^Text\b/` matched 0 options in `component-picker.tsx` although the a11y tree showed "Text Paragraph text". JSX drops whitespace that exists only as formatting between expressions, so adjacent spans concatenate.

## Problem Description

- JSX strips whitespace-only text between an expression/element and a newline — `<span>{type}</span>\n<span>{key}</span>` renders "Headingheading-1", not "Heading heading-1"
- Two failure modes with the same root cause:
  - **`textContent` matchers** — `hasText: /^Text\b/` fails against `"TextParagraph text"` (no word boundary)
  - **Accessible-name ambiguity** — Chromium's a11y tree may insert a space while Playwright's own accname computation does not (or vice versa), so `getByRole(..., { name })` results are **tool-dependent and flaky**
- The UI looks perfectly fine to humans (CSS gaps separate the spans visually) — the bug only surfaces in automation

## Solution Steps

1. **Insert an explicit text node between adjacent spans** you ever expect to match:

   ```tsx
   <span className="…">{child.type}</span>
   {" "}
   <span className="…">{childKey}</span>
   ```

2. `{" "}` survives JSX transformation → `textContent` and accname both become `"Heading heading-1"` — deterministic across Chromium tree AND Playwright
3. When writing a matcher, prefer the form you can verify: read `textContent` via `evaluate` once instead of guessing

## Verification

- `element.textContent` must contain the space (check via `evaluate_script`, not by eyeballing the UI)
- Playwright: assert the element is found by **both** `hasText` and `getByRole` name — if they disagree, the space node is missing

## Prevention Strategies

- Two adjacent JSX spans whose combined text should be readable/matchable → always add `{" "}` between them
- A11y-tree names are **not** a reliable oracle for Playwright selectors — verify against actual matcher results
- New list/row component used by e2e → fix the spans **before** writing the test, not after it fails

## Memory Triggers

- Playwright finds 0 elements but the a11y snapshot shows the exact name → whitespace between JSX spans, not a selector bug
- `"TextParagraph"`, `"Headingheading-1"`-style concatenated `textContent` → missing `{" "}`
- Selector works in one tool and not another → accname computation differs; make the DOM deterministic
