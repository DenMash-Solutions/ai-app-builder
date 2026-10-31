# Ecommerce Reference Application (end-to-end proof)

**Status:** draft
**Date:** 2026-10-31

## Goal

Prove the whole architecture with one coherent multi-screen application: a
user builds, reuses components from, and publishes an ecommerce app without
assembling unrelated standalone UIs.

## Scope

### In scope

- One project with **7 screens**: Home, Products, Product details, Cart,
  Checkout, Orders, Order details
- **6 catalog components**: Navigation bar, Product card, Product grid,
  Price display, Cart item, Checkout summary — installed from at least two
  different versions and reused in a second project
- **4 data resources**: Products, Customers, Cart, Orders
- The 15-scenario script as an automated e2e spec
  (`e2e/ecommerce.spec.ts`) plus a scripted MCP spot-check
- Seed specs committed under `demo/`, seeded from the existing keyless
  Pokédex specs' provenance (`demo/*-keyless-spec.json`)
- README/docs section describing how to replay the demo

### Out of scope

- Payments, real commerce backend, external API quota in CI (fixtures only)
- Marketing/landing pages beyond the Home screen
- Marketplace behavior — components are authored, not purchased

## The 15 scenarios (acceptance script)

1. Create an ecommerce project
2. Generate multiple screens into it
3. Add a component from the catalog (install a specific version)
4. Reuse that component version in a second project
5. Publish a newer catalog version → existing installations unchanged
6. Fork the component in project A → project B still on the original
7. Connect shared data resources
8. Navigate between screens via the navigate action
9. Test dynamic routes (product details by id)
10. Publish the project
11. Access the live application
12. Update the project and verify routing and persistence
13. Handle change → old URL redirects
14. Second project unaffected throughout
15. Anonymous visitor sees published pages only

**Acceptance:** a user can build and publish a coherent multi-screen
application without manually assembling unrelated standalone UIs — and every
existing single-UI flow still works.

## Design decisions

1. Seed from the existing Pokédex specs and their patterns (route params,
   navigate, shared session) — rejected: generating every spec fresh,
   because non-deterministic generation makes the e2e flaky (quota lessons).
2. Data comes from committed keyless fixtures — rejected: live external
   APIs, because CI quota and network lessons already caused failures.
3. The demo doubles as the regression fixture for routing and catalog
   versioning — rejected: throwaway hand-only demo, because the source
   document requires repeatable verification.

## Files

`demo/` specs, `e2e/ecommerce.spec.ts`, catalog seeds, README section,
en/es copy if any new UI is needed for the script.

## Tasks

### 1. Seed assets (demo/)

- [ ] 7 screen specs seeded from the keyless Pokédex patterns (route
      params, navigate, shared session — decision 1)
- [ ] 6 component catalog assets spanning at least two versions
- [ ] 4 keyless data fixtures: Products, Customers, Cart, Orders
      (decision 2)
- [ ] README/docs section describing how to replay the demo

### 2. The 15 scenarios as e2e (`e2e/ecommerce.spec.ts`)

- [ ] Scenarios 1-7: create project, generate screens, install a catalog
      version, reuse it in a second project, publish v2 with installations
      unchanged, fork in A leaving B intact, connect shared data
- [ ] Scenarios 8-9: navigate between screens; dynamic product route
- [ ] Scenarios 10-13: publish, access live app, update with routing and
      persistence, handle change redirects the old URL
- [ ] Scenarios 14-15: second project unaffected throughout; anonymous
      visitor sees published pages only
- [ ] Scripted MCP spot-check run alongside and logged

### 3. Acceptance

- [ ] All 15 scenarios automated or scripted, exit 0
- [ ] Full gate (format, lint, tsc, unit, build, e2e); console clean except
      the known Radix warning; i18n key parity intact

## Verification

- [ ] `bun run format && bun run lint && bunx tsc --noEmit && bun run test && bun run build && bun run test:e2e`
- [ ] All 15 scenarios automated or scripted; exit 0
- [ ] Second project isolation asserted (component + data + routes)
- [ ] MCP spot-check run and logged; console clean (known Radix warning
      excepted); i18n key parity intact

## Status log

| Date | Event |
| ---- | ----- |
| 2026-10-31 | plan drafted |
