# Feature Plans Are Mandatory (`docs/plan/{feature}/`)

> **Why**: The structure-editing feature's initial plan mentioned drag-and-drop; it lived only in conversation, was descoped silently, and left **zero trace** in the repo (no `docs/`, no git-history hit for "drag"). If a plan is not in `docs/plan/`, it did not happen.

## Rule

- **Every feature gets `docs/plan/{kebab-feature}/plan.md` BEFORE implementation starts**
- The plan is a **tracked git file** — committed before or with the feature's first code commit
- Scope changes during the session (descoping, adding) **update the plan file in the same turn**, not just the chat
- On completion: set `Status: implemented` and record the verification result
- Root `commit-plan.md` is unrelated **gitignored scratch** for commit batching — never store feature plans there

## Location & naming

- Folder: `docs/plan/{feature}/` — kebab-case slug matching the work (e.g. `docs/plan/structure-editing/`)
- Main file: `docs/plan/{feature}/plan.md`
- Supporting artifacts (research, mockups, decision records) live beside it in the same folder

## Required sections

Use the template at `docs/plan/_template.md`:

1. **Goal** — what and why, one paragraph
2. **Scope** — In scope / **Out of scope** (explicit; every descope records item + rationale + date)
3. **Design decisions** — numbered, with rejected alternatives
4. **Verification** — how it will be proven (chain commands, e2e, MCP checks)
5. **Status** — `draft` → `approved` → `implemented`

## Workflow

1. Draft the plan as part of Step 0 preview (`implementation-protocol.md`)
2. Show it to the user → **wait for approval**
3. Commit the plan (`docs(agents): add {feature} plan`) before/with implementation
4. On scope change: edit the plan in the same change set
5. On completion: update Status + verification results

## Memory Triggers

- Writing a feature preview only in chat → must also write `docs/plan/{feature}/plan.md`
- User says "out of scope" / "cut X" / "later" → update the plan's Out of Scope **same turn**
- Starting ANY code for a feature → does `docs/plan/{feature}/plan.md` exist and is it approved?
