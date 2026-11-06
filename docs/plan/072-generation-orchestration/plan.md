# 072 — Component-Aware Generation (F22) — Implementation Plan

**Status:** approved
**Date:** 2026-11-06
**Owner:** follow-up F22 (generation ignores installed components), registered from plan 070. F23 (project orchestration) was split out of this plan 2026-11-06 — see Out of scope and decisions 4/5/6/8, which are preserved verbatim for F23's own plan.

## Goal

The model knows nothing about the components already installed in a
project — every fresh generation re-authors shared chrome, so the seven
screens of the 070 demo could only stay coherent because they were
hand-authored. This plan closes that gap (F22): the generate prompt lists
the project's installed components and teaches the model to *reference*
them, and the client expands each reference through the existing install
seams (fresh keys, provenance, install rows) so a generated screen reuses
the navbar instead of writing a second one. It also makes model-driven
customization of the upcoming project templates (073) coherent from day
one.

## Scope

### In scope

- **F22 — component-aware generation**
  - `lib/playground/catalog-rules.ts`: `CATALOG_RULES` (system-prompt
    block), `parseComponents(value)` (client list validation — malformed
    entries dropped, never fails a generation), `componentBlock(list)`
    (user-prompt listing). Ships as a PAIR exactly like
    `NAVIGATE_RULES`/`siblingScreensBlock` (061 decision 3).
  - Route (`app/api/generate/route.ts`): accept `context.components`,
    append rules + block when the list is non-empty — for fresh generate
    and edit/steer alike.
  - Client (`components/playground/playground.tsx`): compute the list
    from the active scope (project catalog installs + saved component
    templates, cap `MAX_LISTED_COMPONENTS = 12`) and add it to
    `sendNow`'s context the same way `screens` rides today.
  - **Reference marker**: the model emits an empty container
    `{"type":"Stack","props":{"data-component-ref":"<id>"},"children":[]}`
    at the desired position; the completion pipeline expands each marker
    in place (parent + index) before the commit: catalog id →
    `insertCatalogComponent` (records the install, pins the asset's
    latest), template id → `insertTemplate` (provenance stamp, the
    existing template contract). Unknown id → marker dropped +
    `console.warn`, the commit proceeds.
### Out of scope

- **F23 project orchestration (planner + build loop)** — split from this
  plan 2026-11-06 (user sequencing decision): F22 → project templates
  (073) → F23. The template installer (073) builds and proves the
  creation loop (entry → membership → route → installs) that F23's
  planner loop reuses; decisions 4/5/6/8 below are preserved verbatim for
  F23's own plan.

- Referencing components the project does NOT have — the model may only
  use listed ids; installing new assets mid-generation (descoped
  2026-11-06: keeps expansion read-only against the existing picker
  contract).
- Parallel generation — sequential by design (rate-limit/quota safety,
  lessons `e2e-auth-quota` / mistake #27) (descoped 2026-11-06).
- Planner-driven edits of EXISTING screens — it creates new screens only;
  existing ones are listed to avoid duplicates, then edited via steer
  (descoped 2026-11-06).
- Cross-screen data-source wiring design (queries stay per-spec as the
  model declares them under `DATA_SOURCE_RULES`) (descoped 2026-11-06).
- Auto-repair/re-run of a partially failed plan beyond the per-screen
  retry offer (descoped 2026-11-06).
- A new `ComponentRef` schema type / registry renderer (see decision 1).

## Design decisions

1. **Reference = marker element expanded client-side at completion.** The
   model writes an empty container carrying `data-component-ref`; the
   client replaces it in place through the same seams the picker uses.
   Rejected: the model emits the full expanded subtree inline — that is
   exactly F22's failure (a `data-template-id` with no install row, not
   pinnable/updatable, and fresh keys are the client's job anyway);
   rejected: a dedicated `ComponentRef` schema type — the node never
   renders (expansion always precedes commit), so a schema + registry
   entry for a phantom type is vocabulary cost for nothing; rejected:
   reusing `data-template-id` as the marker — it already marks REAL
   expanded roots, which edit mode passes back in as context (a `Badge`
   root may legitimately have zero children, so "empty + provenance" is
   not a safe discriminator).
2. **Rules ship as a pair (061 decision-3 pattern).** `CATALOG_RULES`
   append only when the request carries a non-empty `context.components`;
   the block ships only with the rules. On a project with no components
   the vocabulary is simply not offered — an unknown reference no-ops
   (dropped + warn), so the model is never invited to guess.
3. **Expansion runs in the completion pipeline before the dangling-ref
   heal** — after `validateDataSources`, before `danglingChildRefs` — so a
   marker can never be mistaken for a dangling ref, an expanded subtree
   still gets healed if the stored version is broken, and both generate
   and edit ops pass through one seam (no second commit path).
   *Decisions 4-6 and 8 concern F23, which was split out of this plan
   2026-11-06; they are preserved below, verbatim, for F23's own plan.*
4. **(F23 — preserved) Planner is its own endpoint, not a generate mode.** `POST /api/plan`
   returns plain JSON. Rejected: a `mode:"plan"` on `/api/generate` —
   that route's contract is JSONL spec streaming with line repair,
   deadline and empty-completion machinery that a screen list shares only
   the model call with; rejected: client-side heuristic planning — no
   model judgment, and the screen list is the product.
5. **(F23 — preserved) Orchestration is a client-side sequential loop in `lib/playground/
   orchestrate.ts`**, driving the EXISTING generation path (`send`) rather
   than a server-side batch — reuses locale/model/sibling/component
   context, MSW interception, and the completion pipeline unchanged;
   progress and failures stay visible in the UI that owns them.
   Rejected: server batch endpoint (would fork the context-building logic
   the client already owns and bypass `useUIStream`'s lifecycle).
6. **(F23 — preserved) Plan preview before anything is written.** The user accepts the
   proposed screen list (names/routes editable) before the first entry
   exists — a rejected/closed dialog writes nothing. Rejected: fire the
   plan straight into creation (a bad plan is 6 wrong screens to clean up).
7. **Component source = project catalog installs + saved templates**
   (user decision 2026-11-06). Catalog entries expand through
   `insertCatalogComponent` (install row + pin), template entries through
   `insertTemplate` (provenance only — the existing template contract).
   Rejected: installs-only — the real "E2E Shop 070" project's seven
   navbars are template installs, so the block would help nobody where it
   was needed most; rejected: templates-only — expansions would never get
   install rows, recreating the orphan-provenance problem F22 names.
8. **(F23 — preserved) Trigger = explicit Build project action with plan preview**
   (user decision 2026-11-06). The prompt bar offers it in project scope;
   the planner runs, the preview dialog shows the screen list, and only
   acceptance writes anything. Rejected: automatic routing of empty-
   project prompts through the planner — "add a hero section" would
   trigger a whole-project build; rejected: a project-panel dialog — it
   separates the flow from the prompt bar that owns generation context.

## Verification

- [ ] `bun run format && bun run lint && bunx tsc --noEmit && bun run test`
- [ ] Unit — `lib/playground/catalog-rules.test.ts`: rules pair behavior
      (empty list ⇒ no rules/block), `parseComponents` drops malformed
      entries and caps at 12, block lists ids/names only.
- [ ] Unit — expansion: marker → catalog install recorded + subtree in
      place (fresh keys, `data-template-id`), template path stamps only,
      unknown id dropped without failing, marker inside an edit spec.
- [ ] e2e — one new test asserts a component reference expands (install
      row + rendered subtree). Existing generate e2e stay green (no
      components in those contexts ⇒ the block never ships).
- [ ] Full chain: `bun run lint && bunx tsc --noEmit && bun run test` +
      `bun run test:e2e` (or the per-spec scripts).
- [ ] Optional MCP: on the real account, install a navbar in a project,
      generate a new screen, confirm the navbar expanded and the picker
      shows the new install.

*F23's verification items (`orchestrate.test.ts`, `/api/plan` parsing
tests, the 3-screen build e2e + MSW `*/api/plan` handler) moved out with
the split (2026-11-06) and belong to F23's own plan.*

## Status log

| Date | Note |
| ---- | ---- |
| 2026-11-06 | Drafted (Step 0 done: lessons grep — `template-derived-strings` #22 "check what the prompt teaches"; json-render skill loaded; seams researched: `NAVIGATE_RULES` pair, `handleInsertCatalogComponent`, completion pipeline, `setMembershipRoute`, MSW `*/api/generate`). |
| 2026-11-06 | Clarifying questions answered by the user: component source = installs + templates (decision 7), trigger = explicit action + plan preview (decision 8). |
| 2026-11-06 | **Scope change (user sequencing decision): F23 split out** — order is F22 → project templates (073) → F23; F23 items moved to Out of scope, decisions 4/5/6/8 preserved for F23's plan, F23 verification items moved out. 072 = F22 only. |
| 2026-11-06 | **Approved** by user (alongside 073 and 074). |
