# 074 — Agent Chat (project-aware advice, questions, suggestions) — Implementation Plan

**Status:** approved
**Date:** 2026-11-06
**Owner:** user-initiated idea (2026-11-06: "a way the agent can chat with the user so it can ask questions about the project and give suggestions"). Sequencing decided same day: 072 (F22) → 073 (templates) → **074 chat** → F23 (stays a follow-up; its planner interview reuses this plan's question primitive).

## Goal

Today the model only ever answers a prompt with a spec — there is no way
for it to ask *you* anything, and no surface for it to volunteer advice.
This plan adds a conversational channel: the agent knows the project
(screens, installed components, data sources), answers questions about
it, can **ask structured questions back** (option chips + free text),
and proposes next steps as one-tap **suggestions that map to existing
actions** (prefill the prompt bar, run a steer). It is the "customize by
asking" half of 073's template flow and the interview primitive F23's
planner will consume.

## Scope

### In scope

- **`POST /api/chat`** — non-streaming JSON endpoint (the `/api/plan`
  reasoning from 072 decision 4, same again here): request
  `{message, context, history}` → `{reply, questions?, suggestions?}`.
  Reuses the generate route's model resolution (`resolveModel`),
  rate-limit detection (429 → same client handling) and locale rules
  (`i18nRules`). History window capped (last ~12 messages) — the route
  never trusts the client's whole transcript.
- **Context** — built client-side and reused from 072's seams:
  sibling-screen list (`context.screens`), component list
  (`context.components`), plus a **sources summary** (union of the
  project screens' declared `dataSources`/`queries` with configured
  status — the settings-Sources computation from 073). One
  `projectChatContext()` helper so prompt and chat payloads cannot drift.
- **Chat model — `lib/playground/chat.ts`**: types
  (`ChatMessage`, `ChatQuestion {prompt, options?}`,
  `ChatSuggestion {label, intent, payload}`), the
  `SUGGESTION_INTENTS` object constant (no string literals), and a
  local-first store — per-scope history keyed like other playground
  state, capped (~40 messages), `subscribe` pattern, **Clear** action.
- **UI — `components/playground/chat-drawer.tsx`**: right-side drawer
  mirroring `history-drawer.tsx` (open/close, scroll, a11y labels).
  Renders: message list (user/agent), **question cards** (tap an option
  chip or type free text → sends it as the next message), **suggestion
  cards** (tap → executes the intent through the wiring below).
  Entry point: a chat icon button in `tool-rail.tsx` (same shape as
  pick/dnd/xray/clear), with an unread-dot when the last message is an
  agent question/suggestion.
- **Intent executors (playground wiring)** — v1 ships exactly two, both
  existing seams:
  - `prefill_prompt` → injects the suggestion's prompt into the prompt
    bar draft (new seed seam: prompt-bar already has an internal `value`
    state with an injection point — expose it as a controlled seed);
    the user reviews and hits generate themselves.
  - `steer` → runs the suggestion's payload as an edit op through the
    existing `send`/completion pipeline on the active screen (the tap is
    the user's confirmation; no new commit path).
- **i18n** — drawer strings, tool-rail label, question/suggestion empty
  states in `lib/i18n/locale/en.json`.

### Out of scope

- **Agent-initiated messages** (proactive pop-ins after generations or
  on project open) — v1 is user-opens-the-drawer only; cost/noise control
  (descoped 2026-11-06).
- **Autonomous writes / tool-calling** — the agent never edits a spec or
  project without the user tapping an existing action (descoped
  2026-11-06; revisit after v1 primitives are proven).
- **F23 plan-interview consumption** — F23 reuses the question primitive
  when it lands (follow-up, sequenced after this plan).
- Streaming replies (decision 6), chat history sync across devices
  (local-first, disposable context — decision 5), message edit/delete
  (Clear only), voice/images, chat on non-project screens (playground
  scope only) — all descoped 2026-11-06.

## Design decisions

1. **Own `POST /api/chat` endpoint, plain JSON.** Rejected: emitting
   questions/suggestions as special lines inside `/api/generate`'s JSONL
   stream — that contract is spec-only (line repair, deadlines,
   empty-completion handling, MSW replay) and steer already exists as
   the follow-up mechanism; rejected: hanging chat off a generate mode —
   prose and specs share only the model call.
2. **Placement = side drawer in the playground** (user decision
   2026-11-06). Rejected: a thread inside the prompt bar (long
   conversations crowd the streaming view); rejected: a separate chat
   page (you'd flip away from the canvas being discussed). Mirrors the
   proven `history-drawer` pattern.
3. **Powers = advice + structured questions + intent suggestions**
   (user decision 2026-11-06). Rejected: text-only advice — suggestions
   that can't do anything feel inert; rejected: suggestions that execute
   freely — a mis-tap would commit a spec change, and per-write
   confirmation UX costs as much as the intent plumbing anyway.
4. **Intents map only to existing seams (v1: `prefill_prompt`,
   `steer`).** No new commit paths; the model proposes, the user's own
   action (hitting generate / the tap that IS the confirmation) commits.
   Rejected: a generic tool interpreter (`run_any_action`) — every tool
   needs its own confirmation story and failure UI before it can exist.
5. **History is local-first and disposable** — per-scope localStorage
   with the usual store discipline, capped, Clear button, never synced.
   Rejected: a `chat_messages` table — no sync story exists for
   conversational scratch context, and it would add RLS/migration surface
   for data the user can lose without harm.
6. **Non-streaming replies.** Rejected: SSE streaming prose — needs new
   streaming machinery + buffering UI; replies are short (a few
   sentences + structured fields). Revisit only on measured latency.
7. **Context comes from one shared builder** (`projectChatContext()`
   over 061/072's lists + 073's source union), so the agent's knowledge
   and the generate prompt's knowledge cannot drift apart.
   Rejected: a dedicated server-side context endpoint — the client owns
   these stores (local-first) and already builds this for generate.
8. **Sequencing (user decision 2026-11-06): 072 → 073 → 074 → F23.**
   This plan lands after templates (so the agent can discuss
   template-installed components via 072's list) and before F23 (whose
   planner interview reuses the question primitive). Recorded in
   `docs/follow-ups.md` the same turn.

## Verification

- [ ] `bun run format && bun run lint && bunx tsc --noEmit && bun run test`
- [ ] Unit — `app/api/chat`: request validation (missing/oversized
      history truncated to the window, empty message rejected, context
      parsed leniently), rate-limit/429 mapping, response shape
      (`reply` always present, `questions`/`suggestions` optional and
      shape-checked — malformed model output degrades to plain reply).
- [ ] Unit — `lib/playground/chat.ts` store: per-scope isolation, cap
      enforcement, Clear, subscribe notifications.
- [ ] Unit — intents: suggestion with `prefill_prompt` → seed payload
      reaches the prompt-bar seam; `steer` payload → produces the edit op
      shape `send` expects; unknown intent ignored (no throw).
- [ ] Unit — `projectChatContext()`: screens + components + sources
      summary, empty project → minimal context.
- [ ] e2e — MSW gains a `*/api/chat` handler; one test: open drawer via
      tool-rail → ask a question → reply renders → tap a question option
      chip → the answer appears as the next user message → tap a
      `prefill_prompt` suggestion → prompt bar shows the seeded text →
      generate runs (existing MSW handler) and the spec commits. Existing
      e2e stay green (drawer closed by default ⇒ zero impact).
- [ ] Full chain: `bun run lint && bunx tsc --noEmit && bun run test` +
      `bun run test:e2e` (or the per-spec scripts).
- [ ] Optional MCP/live: on a real project, ask "what screens do I
      have?" (correct list), ask a question with chips, tap a suggestion
      and confirm the prefill.

## Status log

| Date | Note |
| ---- | ---- |
| 2026-11-06 | Drafted (Step 0: lessons grep `suggest|chat|interview|question` — only `implementation-checklist` matched, nothing topic-specific; json-render skill loaded earlier this session; seams researched: prompt-bar `value`/`setValue` injection point, tool-rail button pattern, `history-drawer` shape, MSW `http.post("*/api/…")` pattern, generate route's `resolveModel`/`RATE_LIMIT_PATTERN`/429 handling). User decisions: side drawer (decision 2), advice+questions+intent suggestions (decision 3), sequence 072 → 073 → 074 → F23 (decision 8). |
| 2026-11-06 | **Approved** by user (alongside 072 and 073). |
