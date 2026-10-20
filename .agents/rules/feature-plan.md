# Feature Plans Are Mandatory (`docs/plan/{NNN}-{feature}/`)

> **Why**: The structure-editing feature's initial plan mentioned drag-and-drop; it lived only in conversation, was descoped silently, and left **zero trace** in the repo (no `docs/`, no git-history hit for "drag"). If a plan is not in `docs/plan/`, it did not happen.

## Rule

- **Every feature gets `docs/plan/{NNN}-{kebab-feature}/plan.md` BEFORE implementation starts** (`{NNN}` = 3-digit sequence number)
- The plan is a **tracked git file** — committed before or with the feature's first code commit
- Scope changes during the session (descoping, adding) **update the plan file in the same turn**, not just the chat
- On completion: set `Status: implemented` and record the verification result
- **`docs/plan/INDEX.md` is the at-a-glance tracker** — every new plan adds its row, and Status changes update it **in the same turn**
- Root `commit-plan.md` is unrelated **gitignored scratch** for commit batching — never store feature plans there

## Location & naming

- Folder: `docs/plan/{NNN}-{kebab-feature}/` — 3-digit number + kebab-case slug
  matching the work (e.g. `docs/plan/013-scrollable-carousel/`)
- Numbering is **chronological** — the next free number is `max(existing) + 1`,
  claimed when the plan file is drafted; numbers never renumber or reshuffle
- Main file: `docs/plan/{NNN}-{kebab-feature}/plan.md`
- Supporting artifacts (research, mockups, decision records) live beside it in the same folder
- Index: `docs/plan/INDEX.md` — sequence table (№, feature, Status, created)

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
5. On completion: update Status + verification results + the `INDEX.md` row

## Memory Triggers

- Writing a feature preview only in chat → must also write `docs/plan/{NNN}-{feature}/plan.md`
- User says "out of scope" / "cut X" / "later" → update the plan's Out of Scope **same turn**
- Starting ANY code for a feature → does `docs/plan/{NNN}-{feature}/plan.md` exist, is it approved, and does `INDEX.md` list it?
- Creating a plan folder → claim `max + 1` as `{NNN}`; never reuse or renumber
