# Prompt Mention Instance Labels — Implementation Plan

**Status:** implemented
**Date:** 2026-10-08

## Goal

`@` autocomplete options for repeated keys are indistinguishable: two scoped `product-image` instances both render as `product-image · Image` (the index is missing from the option row, and even with it, `1/8` vs `2/8` does not say *which* product). Enrich each instance option with the element's resolved content (e.g. the bound product name) so the user can tell instances apart at a glance.

## Scope

### In scope

- **`describeInstanceText(spec, chain)`** pure helper in `lib/editor/instance-path.ts`: looks at the element's props in priority order (`text`, `label`, `title`, `name`, `alt`, `placeholder`), resolves each through the existing `resolvePropDisplay`, returns the first non-empty string truncated to 28 chars, else `null`
- **playground scope mapping**: compute `detail` for instance chips only (template chips unchanged)
- **PromptBar option rows**: mini key chip + full suffix from the label (`· Image 2/8`) + muted resolved detail (`· Hydrating Essence`) when present
- **Unit tests** for `describeInstanceText` (item binding, state binding, template string, no-text fallback)
- **e2e**: option row shows instance index + resolved text for the state fixture (`Item A`…`Item F` labels bound via `$item: "label"`)

### Out of scope

- Scope-chip row label changes (chips already show `N/M`; revisit only if requested) (descoped 2026-10-08)
- Hover-highlight of canvas instances from options (descoped 2026-10-08)
- Thumbnails / screenshots in options (descoped 2026-10-08)

## Design decisions

1. **Resolve via existing `resolvePropDisplay`** — rejected: reading raw state via `basePath` + `getByPath`, because `$item` bindings (`text: { $item: "label" }`) would need duplicate resolution logic
2. **Priority-list props, first match wins** — rejected: scanning every prop, because `className`/style-like strings would pollute the snippet
3. **Truncate at 28 chars** — rejected: no truncation, because long titles would blow the 256px dropdown width

## Verification

- [x] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build && bun run test:e2e` — **222/658 unit, 61 e2e**
- [x] Unit: `describeInstanceText` resolves `$item` binding, truncates at 28, `null` for missing chain/keys
- [x] e2e: `@` option for the stateful instance shows `Text 2/6` + `Item B` in the list
- [x] MCP: two scoped product-name-overlay instances → options show `Heading 1/8 · Botanical Cleanser` and `Heading 2/8 · Hydrating Essence`

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-08 | plan drafted — clarified: fix is in `@` option rows, not chip row |
| 2026-10-08 | approved (option "Yes, implement") |
| 2026-10-08 | implemented — 222/658 unit, 61/61 e2e; MCP spot-check: options show distinct instance names |
