# Chat Events & Streaming Stability (Review + Fix Plan)

This document is a handoff for improving the **Agent Chat** streaming experience (OpenCode → backend → frontend) under slow providers, reconnects, and retry/error conditions.

It is based on a repo review only (no code changes). Primary focus is the event pipeline and the frontend state machine.

---

## Scope

Applies to:
- Backend OpenCode integration + event forwarding (`backend/src/opencode/*`)
- Backend tRPC SSE subscription (`backend/src/routers/agent/subscription.ts`)
- Frontend chat state machine + UI (`frontend/src/components/chat/*`)

Out of scope:
- Generator flows (non-OpenCode)
- Auth/permissions
- UI redesign (only state correctness / resiliency)

---

## Current Architecture (As Implemented)

### Data flow

1. **Frontend** calls `trpc.agent.runTask` (mutation). UI immediately sets `isWaiting=true` locally.
2. **Backend** `runTask()`:
   - ensures an OpenCode session exists
   - starts OpenCode event subscription (`useEvents`)
   - forwards OpenCode events into an in-process `agentEventEmitter`
   - sends the prompt via `client.session.promptAsync()`
   - returns `{ sessionId }` immediately (does not await completion)
3. **Frontend** subscribes to `trpc.agent.sessionEvents` (tRPC SSE subscription):
   - receives deltas/tools/status and updates local streaming state
4. In parallel, **frontend polls**:
   - `getSessionsStatus` (used as “source of truth”)
   - `getSessionContent` (used for message history + recovery)

### Key files
- Backend:
  - `backend/src/opencode/index.ts` (runTask orchestration)
  - `backend/src/opencode/useEvents.ts` (OpenCode SDK → callbacks)
  - `backend/src/opencode/eventEmitter.ts` (buffered session event emitter + async generator)
  - `backend/src/routers/agent/subscription.ts` (tRPC subscription: yields `tracked(eventId, event)`)
  - `backend/src/opencode/serverManager.ts` (spawns/cleans up OpenCode servers)
- Frontend:
  - `frontend/src/components/chat/ChatContext.tsx` (state machine; SSE + polling)
  - `frontend/src/components/chat/MessageList.tsx` (“Done” indicator; “Waiting/Thinking/Generating” label)

---

## Observed Symptoms (User Reports)

1. **“Send new message → immediately shows Done → later starts streaming again.”**
2. **“An error message displays, but the UI still shows ‘Waiting…’.”**
3. **“Sometimes after an error, the session still continues streaming.”**

These are most visible when:
- the provider is slow (long gaps without new SSE data)
- the SSE connection reconnects / resubscribes (tab switching, network blips, server/proxy timeouts)
- OpenCode emits retry/error statuses and later recovers

---

## Why It’s Brittle (Root Causes)

### 1) Too many “sources of truth”

Chat state is derived from multiple concurrent mechanisms:
- **Optimistic UI:** `messages` appended locally when sending
- **SSE events:** drive `isWaiting`, `isStreaming`, `streamingParts`, completion/error
- **Polled statuses:** `getSessionsStatus` is treated as “source of truth”
- **Polled messages:** `getSessionContent` overwrites `messages` wholesale

When these disagree (common on reconnects / long runs), UI can bounce between states.

### 2) Buffered replay + resubscribe without a cursor (causes “Done → streaming later”)

Backend `AgentEventEmitter` buffers *all* events for a session and replays them to new subscribers.

However:
- The frontend subscription does **not** send `lastEventId`.
- When the subscription restarts, the backend replays buffered events from the beginning, including old `session.completed` or `session.error`.
- The frontend applies these as if they were for the current prompt, clearing `isWaiting/isStreaming` early.
- Later, new deltas arrive and streaming resumes, creating the “Done → streaming again” visual glitch.

### 3) No per-prompt correlation (“turn id” / “run id”)

The event model is session-based only. A single OpenCode session can process multiple user prompts over time, but:
- events do not carry a “which prompt/run” identifier
- the frontend cannot reliably distinguish:
  - completion/error for a previous turn vs the current turn
  - late events arriving after UI state resets

This is a foundational reason the UI has to add heuristics and “recovery” logic.

### 4) Error semantics are ambiguous (“retry” vs “final failure”)

Backend `useEvents` converts OpenCode `session.status` of type `retry` or `error` into a `session.error` event forwarded to the UI.

But:
- a `retry` status is not necessarily terminal; streaming can continue later
- the UI treats `session.error` as “stop waiting/streaming”, but does not clearly model “retrying”
- the UI can show an error banner while the session legitimately continues (retry succeeded)

### 5) UI logic can show “Done” based on message history, not run completion

`MessageList.tsx` shows “Done” when:
- last message is role `agent`
- and `!isThinking && !isLoading`

Because message history can be overwritten by polling, the last message may become an old agent message while a new run is in-flight (especially after resubscribe/recovery), triggering “Done” incorrectly.

### 6) Timeouts / disconnects are not explicitly handled

Relevant observations:
- Backend `useEvents` has a 60s inactivity timer but only logs; it doesn’t emit a “timeout” event or change state.
- There is no explicit SSE heartbeat/keepalive event from backend → frontend.
- The OpenCode server manager cleans up servers after idle time; “idle” tracking does not obviously update during long-running work.

These contribute to reconnect/resubscribe behavior and state desync.

---

## Design Goals (What “Good” Looks Like)

The streaming UX should satisfy:
- **Monotonicity:** A run cannot go from “completed” back to “streaming” for the same run.
- **Idempotency:** Replayed events must be safely ignorable (no duplicated deltas, no repeated completion).
- **Correlation:** Events map to a specific user prompt/run; the UI can ignore events from other runs.
- **Explicit retry model:** “Retrying” is a distinct state from “Failed” and from “Waiting”.
- **Single authoritative run state:** Polling and SSE should not fight; one should be authoritative, the other recovery.

---

## Recommended Path to Improvements (Implementation Roadmap)

The steps below are ordered to deliver value early and reduce risk. Each step has acceptance criteria.

### Step 0 — Instrumentation & Repro Harness (no behavior change)

Goal: Make it easy to confirm fixes and diagnose regressions.

Suggested additions:
- Frontend: persist and display:
  - subscription connect/disconnect counts
  - last `eventId` processed
  - current “run id” (once added)
- Backend: structured logging for:
  - subscription start/stop with sessionId + lastEventId
  - runTask start with sessionId + runId
  - event emission counts and last sequence

Acceptance criteria:
- A developer can reproduce “Done → streaming again” and see which events caused it (eventId + type).

### Step 1 — Make SSE resumable for real (use `lastEventId`)

Problem addressed: buffered replay on resubscribe causes stale completion/error to be re-applied.

Changes:
- Frontend:
  - store the last processed `eventId` per `selectedSessionId`
  - pass it as `lastEventId` input into `trpc.agent.sessionEvents.useSubscription`
- Backend:
  - already supports `lastEventId` in input and emitter generator replay offset; ensure it’s wired end-to-end

Acceptance criteria:
- Rapidly toggling subscription conditions (e.g., brief disconnect) does not replay old `session.completed`.
- “Done → streaming later” no longer happens due to replay.

Notes:
- This does not fully solve “multi-run correlation” (Step 2), but it eliminates the worst replay artifacts.

### Step 2 — Add per-run correlation (`runId` / `turnId`)

Problem addressed: events are session-scoped, but UI needs prompt/run-scoped guarantees.

High-level design:
- When a prompt is sent, generate a `runId` (UUID or monotonic counter) and treat it as the *current run* for that session.
- Attach `runId` to every emitted backend → frontend event for that run.
- Frontend stores `activeRunId` for the current send and ignores events whose `runId` ≠ `activeRunId`.

Implementation options:
- **In-memory only (fastest):**
  - store `currentRunIdBySessionId` in backend process memory
  - risk: backend restart loses mapping (acceptable if you treat poll as recovery)
- **Persisted (more robust):**
  - store run metadata in DB (sessionId, runId, startedAt, completedAt, status)
  - enables “resume on refresh” cleanly

Acceptance criteria:
- A prior run’s `session.completed` cannot end the current run’s UI state.
- Late-arriving deltas after completion are ignored (or explicitly treated as a new run, if applicable).

### Step 3 — Model retry vs terminal failure explicitly

Problem addressed: “session.error” is used for retryable states, confusing UI.

Changes:
- Backend:
  - differentiate events:
    - `session.retry` (non-terminal; includes attempt + nextRetryAt)
    - `session.failed` (terminal; includes message)
  - or keep `session.error` but add an explicit `isTerminal` boolean
- Frontend:
  - introduce explicit states:
    - `isRetrying` (or `runState = retrying`)
    - `runState = failed` (terminal)
  - do not force-clear `isWaiting` on retry if the expected behavior is “still working, but delayed”

Acceptance criteria:
- UI never shows “Waiting…” and “Failed” simultaneously.
- If the backend recovers from retry, the UI transitions cleanly back to streaming/waiting.

### Step 4 — Reduce state fighting: define a single authoritative state machine

Problem addressed: polling and SSE compete; `messages` is overwritten; heuristics cause oscillation.

Recommended direction:
- Define a single `runState` (idle | waiting | streaming | retrying | completed | failed).
- Make one input authoritative:
  - Prefer SSE for “live run state”
  - Use polling only for recovery and history sync
- Avoid wholesale `setMessages(mappedMessages)` overwriting optimistic UI while a run is active:
  - merge messages until the server confirms the optimistic user message is present
  - or keep separate “optimisticMessages” overlay until acked

Acceptance criteria:
- No “Done” based purely on message history.
- No disappearance of the just-sent user message during long runs/reconnects.

### Step 5 — Keepalive / long-run resiliency

Problem addressed: long gaps can trigger disconnects that reintroduce resubscribe edge cases.

Options:
- Backend: emit a lightweight heartbeat event on active subscriptions (e.g. every 15–30s).
- Server: ensure appropriate keepalive/timeout settings for SSE behind proxies (if applicable).
- OpenCode server manager: ensure “lastActivity” is touched during an active run so the server doesn’t get cleaned up mid-run.

Acceptance criteria:
- Long (multi-minute) runs do not trigger SSE disconnect/reconnect loops.
- OpenCode servers aren’t killed mid-run due to idle cleanup logic.

---

## UI-Specific Fixes (Small but Important)

### Fix “Done” indicator logic

Current behavior: “Done” is derived from message history.

Recommendation:
- derive “Done” from the run state for the current run (e.g., `runState === completed`)
- optionally show “Done” only if the latest completion corresponds to the current `runId`

### Ensure terminal events clear *all* waiting flags

If the UI maintains internal refs like `isWaitingForAgent`, ensure they are cleared on:
- terminal failure
- explicit cancel
- session switch

---

## Suggested Acceptance Test Checklist (Manual)

Run with `VITE_DEBUG_CHAT=true` and reproduce:
- **Slow provider:** induce long gaps between events; ensure no premature “Done”.
- **Reconnect:** kill network briefly / reload tab during streaming; ensure resume without replay artifacts.
- **Retry:** force a quota/retry scenario; ensure UI shows “Retrying” (not “Waiting” + error), then recovers.
- **Session switching:** switch sessions mid-stream; ensure the previous session’s buffered completion cannot end the new session’s run.

---

## Appendix: Code Hotspots

- Replay/buffering:
  - `backend/src/opencode/eventEmitter.ts` (`createSessionStream`, `sessionBuffers`)
  - `backend/src/routers/agent/subscription.ts` (`tracked(eventId, event)`)
- OpenCode → emitter forwarding:
  - `backend/src/opencode/useEvents.ts` (status mapping, idle handling)
  - `backend/src/opencode/index.ts` (runTask; emits `session.completed`/`session.error`)
- Frontend state machine:
  - `frontend/src/components/chat/ChatContext.tsx` (SSE + polling + optimistic messages)
  - `frontend/src/components/chat/MessageList.tsx` (“Done” indicator)

