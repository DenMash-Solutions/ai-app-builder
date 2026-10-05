# Controlled Input Drafts Must Win Over Props

> **Lesson source**: `style` field in EditPanel rendered but keystrokes never appeared (`components/editor/property-form.tsx`). Symptom looked like a browser/CDP problem; root cause was the component's own value pipeline.

## Problem Description

- A controlled input that edits committed spec values keeps two sources of truth: the **draft** (what the user is typing) and the **committed value** (props)
- The display function must resolve as `draft ?? serialize(props)` — for **every** field kind
- Bug pattern: a field kind that returns `serialize(props)` directly (bypassing drafts) → every keystroke re-renders the old value → **text vanishes as you type**
- Because the symptom is "nothing happens", it is easily mistaken for an environment failure (window occlusion, CDP key injection, React event-plugin internals) — the debugging detour can dwarf the actual fix

## Solution Steps

1. **Correct value resolution** (draft always takes precedence):

   ```tsx
   const currentText = (field: PropField): string => {
     const draft = drafts[field.name];
     if (draft !== undefined) return draft;
     if (field.kind === PROP_FIELD_KINDS.record) {
       return serializeStyleText(values[field.name]);
     }
     return String(values[field.name] ?? "");
   };
   ```

2. **Commit path reads the draft, then clears it** — `commitText` parses `drafts[name]`, deletes the key (falling back to committed serialization), and only calls `onChange` when the parsed result differs from props
3. **When adding a new field kind** — update `currentText` (display) and `commitText` (parse) together; a kind handled in only one of the two reintroduces the bug class

## Debugging Triage (do this FIRST)

When automation or manual typing "doesn't work" in an input:

1. **App pipeline**: does the component render the keystroke at all? Read the input's `value` immediately after a dispatch — if it reverts synchronously, the app discarded it (draft/props resolution), not the environment
2. **React state**: inspect the fiber hooks directly (`queue.lastRenderedState` vs `memoizedState`) — a mismatch means the draft updated but never committed
3. **Environment last**: only blame window occlusion / CDP / React event internals after the app pipeline is proven to pass drafts through
- Screenshots can be **stale** when the browser window is occluded — `evaluate` reads are ground truth; `isTrusted` keydown events can arrive without the default text-editing action executing

## Verification

- Type into the field and confirm the text **stays** across a re-render (draft precedence) before debugging anything else
- Commit with Enter → spec updated (`property:<name>` revision in history) → committed serialization re-renders in the field
- Unit-test the parse/serialize helpers (`lib/editor/style-text.test.ts`); component behavior verify by typing

## Prevention Strategies

- Never write `value={serialize(props)}` directly on a controlled input that has draft state — always `draft ?? serialize(props)`
- Add a new field kind → update display **and** commit paths in the same change, plus a test for both
- Debug triage order: app code → React state → environment; never start at the bottom

## Memory Triggers

- *"Typing does nothing / text vanishes"* → check the value-source function for draft precedence before any other debugging
- Adding a field kind to `property-form.tsx` → is it in **both** `currentText` and `commitText`?
- Long environment-debugging spiral on a single input → step back and verify the app renders the keystroke at all
