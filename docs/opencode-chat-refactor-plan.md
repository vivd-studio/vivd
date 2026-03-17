# OpenCode Chat Refactor Plan

Date: 2026-03-17

## Decision

Vivd should keep its own React chat shell, but the Studio chat integration underneath it should be rebuilt around an upstream OpenCode-style event and state model.

This is a replacement project, not another stabilization pass on the current chat internals.

## Refactor Principles

- Build the new stack beside the legacy one, cut over once, then delete the legacy internals.
- Stay close to upstream OpenCode naming, event families, and component boundaries so future copy/adaptation work stays cheap.
- Preserve upstream field semantics inside the sync core wherever practical (`parentID`, message/part identities, canonical part types) and adapt only at the UI edge.
- Keep one canonical client-side truth: sessions, messages, parts, status, questions, permissions, todos, and diffs.
- Move event ownership to a persistent workspace-level bridge, not a `runTask()`-scoped stream.
- Keep polling only for bootstrap and recovery. Polling must not compete with the live store as a second primary truth.
- Keep Vivd-only UX at the edges: layout, selected-element attachment flow, custom composer affordances, and Studio-specific actions.
- If a temporary flag is needed during migration, gate the entire new stack. Do not build a half-shared old/new core.

## Keep vs Replace

### Keep

- `packages/studio/client/src/components/chat/ChatPanel.tsx` shell responsibilities: panel chrome, title, close affordance
- the session list UX concept
- composer features: model selector, selected-element context, image/file attachments
- Vivd-specific actions and wording such as revert/unrevert and Studio layout integration

### Replace

- the run-scoped server bridge centered on `packages/studio/server/opencode/index.ts`, `packages/studio/server/opencode/useEvents.ts`, and `packages/studio/server/opencode/eventEmitter.ts`
- the current tRPC live contract in `packages/studio/server/trpcRouters/agent.ts` that exposes a reduced session-scoped event stream
- the client orchestration blob in `packages/studio/client/src/components/chat/ChatContext.tsx`
- session/message polling ownership in `packages/studio/client/src/components/chat/useChatSessions.ts`
- imperative stream mutation helpers in `packages/studio/client/src/components/chat/useChatActions.ts` and `packages/studio/client/src/components/chat/chatEventHandlers.ts`
- drift-healing and timeline heuristics as primary architecture in `packages/studio/client/src/components/chat/chatMessageUtils.ts` and `packages/studio/client/src/components/chat/chatTimelineBuilder.ts`
- `streamingParts`, `isWaiting`, and `isStreaming` as primary truth

## Target Architecture

### Server

The server should own one persistent workspace-scoped OpenCode event pump per Studio runtime.

- The pump subscribes once to upstream OpenCode events, keeps replay state, and rebroadcasts canonical events to Studio clients.
- `runTask()` should only submit work and return identifiers. It should not own the event-stream lifecycle.
- Studio should forward canonical event families with minimal reshaping:
  - `session.updated`
  - `session.status`
  - `message.updated`
  - `message.removed`
  - `message.part.updated`
  - `message.part.delta`
  - `message.part.removed`
  - `question.*`
  - `permission.*`
  - `todo.*`
  - diff/review refresh signals
- Snapshot queries still matter for bootstrap and recovery:
  - sessions list
  - session messages
  - session status
  - diff/review data
- Prefer one workspace-scoped live subscription for the new client. Filter by active session in the client store instead of baking that restriction into the transport contract.

### Client

The client should move to a normalized OpenCode-aligned sync core and derive all chat UI from that store.

- Create a new feature root such as `packages/studio/client/src/features/opencodeChat/`.
- Mirror upstream OpenCode boundaries as closely as practical in React:
  - a `global-sdk`-style transport layer for subscription, heartbeat, reconnect, and event coalescing
  - an `event-reducer` for canonical event application
  - a normalized sync store with selectors
  - an upstream-style optimistic submit path
  - timeline and turn components driven by canonical messages and parts
  - dedicated docks for questions, permissions, and follow-up session actions
  - a dedicated review/diff surface
- Normalized state should include at least:
  - `sessionsById`
  - `sessionOrder`
  - `messagesById`
  - `messagesBySessionId`
  - `partsById`
  - `partsByMessageId`
  - `sessionStatusById`
  - `questionsBySessionId`
  - `permissionsBySessionId`
  - `todosBySessionId`
  - `diffsBySessionId`
  - `pendingOptimisticSubmits`
- UI state should be derived from canonical entities:
  - run activity from `sessionStatus` plus unfinished assistant parts
  - streaming output from canonical part deltas
  - turn grouping from message order and `parentID`
  - question and permission flows from dedicated store branches
  - review state from diff data, not from chat message heuristics

## Proposed Module Layout

### Server

Prefer a clean new namespace instead of incrementally mutating the current live bridge.

- `packages/studio/server/opencode/events/workspaceEventPump.ts`
- `packages/studio/server/opencode/events/canonicalEventTypes.ts`
- `packages/studio/server/opencode/events/canonicalEventBridge.ts`
- `packages/studio/server/opencode/events/eventBuffer.ts`
- `packages/studio/server/opencode/sessionBootstrap.ts`
- `packages/studio/server/trpcRouters/agentChat.ts`

Notes:

- `agentChat.ts` is preferable to extending the old `agent.ts` live contract because it gives the new transport a clean boundary and makes cutover/deletion simpler.
- The legacy `agent.ts` routes can remain for the old chat until cutover, but the new chat should not be built on top of the legacy session event stream.

### Client

Keep the shell light and move the new internals into a new feature tree.

- `packages/studio/client/src/features/opencodeChat/index.ts`
- `packages/studio/client/src/features/opencodeChat/provider.tsx`
- `packages/studio/client/src/features/opencodeChat/types.ts`
- `packages/studio/client/src/features/opencodeChat/sync/global-sdk.ts`
- `packages/studio/client/src/features/opencodeChat/sync/event-reducer.ts`
- `packages/studio/client/src/features/opencodeChat/sync/store.ts`
- `packages/studio/client/src/features/opencodeChat/sync/selectors.ts`
- `packages/studio/client/src/features/opencodeChat/sync/bootstrap.ts`
- `packages/studio/client/src/features/opencodeChat/submit/submit.ts`
- `packages/studio/client/src/features/opencodeChat/timeline/message-timeline.tsx`
- `packages/studio/client/src/features/opencodeChat/timeline/session-turn.tsx`
- `packages/studio/client/src/features/opencodeChat/composer/composer-region.tsx`
- `packages/studio/client/src/features/opencodeChat/docks/question-dock.tsx`
- `packages/studio/client/src/features/opencodeChat/docks/permission-dock.tsx`
- `packages/studio/client/src/features/opencodeChat/review/review-tab.tsx`

Notes:

- `packages/studio/client/src/components/chat/ChatPanel.tsx` can remain the entrypoint, but it should become a thin wrapper around the new feature.
- Existing presentational pieces can be copied into the new tree if they are still useful, but the sync/state core should be clean-room code.

## Feature-Parity Targets

### Phase-1 must-haves

- reliable message and tool sync with one canonical store
- optimistic user submit with canonical reconciliation
- reload/reconnect safety without stale terminal-state flashes
- timeline rendering from canonical messages/parts, not merged live buffers

### Upstream parity targets after core cutover

- `question` support with a proper dock and reply flow
- permission request UI aligned with upstream concepts
- session diff/review surface with dedicated state and rendering
- todo/follow-up/revert surfaces that read from canonical session state

Important:

- keep the `question` tool disabled in `packages/studio/server/opencode/configPolicy.ts` until the question dock and reply flow exist end to end
- diff/review should be modeled as its own feature surface, not folded into the message stream model

## Migration Plan

### Phase 0: Freeze Legacy Growth

- Stop adding new sync logic to the current `components/chat` internals except for critical bug blockers.
- Treat the current chat internals as legacy and document them as replacement targets.

### Phase 1: Reset the Server Contract

- Add the persistent workspace event pump and canonical event buffering/replay.
- Introduce a clean new tRPC live contract for the refactor path.
- Keep legacy polling and legacy `sessionEvents` only for the existing chat until cutover.

### Phase 2: Build the New Client Core

- Implement the normalized sync store, reducers, selectors, bootstrap load, reconnect logic, and event coalescing.
- Keep this isolated from the old `ChatContext` code.
- Add reducer-level tests before any UI cutover.

### Phase 3: Rebuild Submit and Timeline

- Reimplement prompt submission with optimistic user-message insertion and canonical reconciliation.
- Rebuild the timeline from canonical messages and parts.
- Port the existing Vivd shell and composer features onto the new store.

### Phase 4: Add Upstream Parity Surfaces

- Add question dock support and only then re-enable the question tool.
- Add permission-request UI.
- Add diff/review state and rendering.
- Add follow-up/todo/session-action surfaces that align with upstream concepts.

### Phase 5: Cut Over and Delete

- Switch `ChatPanel.tsx` to the new feature tree.
- Remove the legacy state/sync modules and the old reduced event bridge.
- Reduce polling to bootstrap/recovery only.
- Delete compatibility shims that only existed for migration.

## Explicit Deletion Targets After Cutover

- `packages/studio/client/src/components/chat/ChatContext.tsx`
- `packages/studio/client/src/components/chat/useChatSessions.ts`
- `packages/studio/client/src/components/chat/useChatActions.ts`
- `packages/studio/client/src/components/chat/chatEventHandlers.ts`
- `packages/studio/client/src/components/chat/chatMessageUtils.ts`
- `packages/studio/client/src/components/chat/chatTimelineBuilder.ts`
- legacy tests that only validate the old heuristic timeline and stale-state recovery model
- the reduced session-scoped event emitter contract used by the old chat
- the run-scoped `useEvents` callback fan-out as the primary transport mechanism

## Validation Plan

### Server tests

- canonical event translation and replay ordering
- reconnect from `lastEventId`
- workspace event buffer behavior across multiple sessions
- no dropped `message.part.delta` updates when a full part update arrives first or later

### Client tests

- reducer correctness for `message.updated`, `message.part.updated`, `message.part.delta`, removals, and status changes
- optimistic submit reconciliation when canonical messages arrive with different ids/timestamps
- timeline derivation from canonical message/part state
- reconnect/reload bootstrap without stale `done` or `idle` flashes
- question and permission flow tests once those surfaces exist
- diff/review data fetch and render tests

### Manual verification

- reload during a long-running tool call
- reconnect after temporary network loss
- switch between active and completed sessions
- complete a run with interleaved text and tool parts
- revert/unrevert after a completed run
- answer a question prompt once question support is enabled

## Final Direction

Vivd should keep its own chat product surface, but the implementation underneath should become structurally close to upstream OpenCode.

That means:

- keep the React UI and Vivd-specific UX
- copy the upstream transport and store ideas aggressively
- align module boundaries and naming where practical
- do one clean cutover instead of continuing to accumulate chat-specific recovery heuristics
