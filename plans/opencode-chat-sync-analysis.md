# OpenCode Chat Sync Analysis

Date: 2026-03-17

## Goal

Compare Vivd's current Studio chat integration against the upstream OpenCode web client, identify why chat/server sync drift still happens, and decide what to reuse versus keep custom.

## Scope

- Vivd Studio chat frontend and event/state flow
- Vivd Studio OpenCode server bridge
- Upstream OpenCode web client sync model and session rendering
- Reuse feasibility for transport, state, and UI

## Current Vivd Architecture

Vivd currently runs `opencode serve` headlessly and wraps it with a custom server-side event bridge plus a custom React chat UI.

Key files:

- `packages/studio/server/opencode/serverManager.ts`
- `packages/studio/server/opencode/index.ts`
- `packages/studio/server/opencode/useEvents.ts`
- `packages/studio/server/opencode/eventEmitter.ts`
- `packages/studio/server/trpcRouters/agent.ts`
- `packages/studio/client/src/components/chat/ChatContext.tsx`
- `packages/studio/client/src/components/chat/useChatSessions.ts`
- `packages/studio/client/src/components/chat/chatEventHandlers.ts`
- `packages/studio/client/src/components/chat/chatMessageUtils.ts`
- `packages/studio/client/src/components/chat/chatTimelineBuilder.ts`

Current flow:

1. Vivd starts or reuses a local OpenCode server per workspace.
2. `runTask()` opens an OpenCode event subscription.
3. Vivd translates upstream events into a smaller custom event stream:
   - `thinking.started`
   - `reasoning.delta`
   - `message.delta`
   - `tool.started`
   - `tool.completed`
   - `tool.error`
   - `session.completed`
   - `session.error`
   - `usage.updated`
4. The React chat combines:
   - optimistic local user messages
   - transient `streamingParts`
   - polled session content
   - polled session status
5. The UI rebuilds a turn model from merged messages and live parts.

## Current Vivd Weak Points

The main weakness is that the chat has multiple partial sources of truth:

- canonical session content from polling
- canonical-ish session status from polling
- custom in-memory event buffers
- local `isWaiting` / `isStreaming` flags
- pending-run timestamps and recovery heuristics
- local timeline reconstruction rules

This is visible in the defensive logic already present in:

- `chatMessageUtils.ts`
- `chatTimelineBuilder.ts`
- `ChatContext.tsx`

Symptoms of this design:

- stale `done` / `idle` can briefly override a just-submitted run
- hydration snapshots can temporarily overwrite optimistic local state
- missed or replayed SSE fragments need custom dedupe and recovery
- assistant messages are merged heuristically after the fact
- interrupted or partially streamed tool states must be inferred in the UI

In short: Vivd is reconstructing a coherent timeline from several loosely synchronized signals instead of maintaining one canonical client-side session store.

## Upstream OpenCode Web Client Architecture

The upstream web client is materially different. It keeps a normalized local store that mirrors server state much more directly.

Key files:

- `vendor/opencode/packages/opencode/src/server/routes/global.ts`
- `vendor/opencode/packages/opencode/src/session/status.ts`
- `vendor/opencode/packages/opencode/src/session/message-v2.ts`
- `vendor/opencode/packages/app/src/context/global-sdk.tsx`
- `vendor/opencode/packages/app/src/context/global-sync.tsx`
- `vendor/opencode/packages/app/src/context/global-sync/event-reducer.ts`
- `vendor/opencode/packages/app/src/context/sync.tsx`
- `vendor/opencode/packages/app/src/components/prompt-input/submit.ts`
- `vendor/opencode/packages/app/src/pages/session/message-timeline.tsx`
- `vendor/opencode/packages/ui/src/components/session-turn.tsx`

Important properties of the upstream design:

- Uses a persistent global event stream with heartbeat and reconnect handling.
- Coalesces frequent updates before applying them to UI state.
- Stores canonical entities directly:
  - sessions
  - messages by session
  - parts by message
  - session status by session
  - permission/question/todo/diff state
- Applies server events into that store with an event reducer.
- Uses optimistic updates only for prompt submission.
- Reconciles optimistic user messages against later canonical server records.
- Renders turns directly from canonical messages and parts, especially via `parentID`, instead of reconstructing a parallel stream model.

## What OpenCode Does Better

### 1. Single normalized state model

OpenCode's client keeps one structured store for session state. Vivd currently has to reconcile several overlapping models.

### 2. Canonical event payloads

OpenCode uses richer events such as:

- `session.status`
- `message.updated`
- `message.removed`
- `message.part.updated`
- `message.part.delta`
- `message.part.removed`

Vivd currently collapses these into a simpler event layer and loses structure that the UI later needs to infer back.

### 3. Better optimistic path

OpenCode inserts the user message and its parts optimistically, then reconciles when the server emits canonical state. Vivd also does optimistic submit, but then merges it with separate streaming fragments and polled snapshots, which creates more room for transient drift.

### 4. Better event transport

OpenCode's `global-sdk.tsx` does batching/coalescing, heartbeat handling, reconnect loops, and stale-delta suppression when a newer full part update has arrived. Vivd's current chat subscription is much thinner and relies more on polling fallback.

### 5. Turn rendering from data, not heuristics

OpenCode renders conversation turns from normalized messages and parts. Vivd currently derives a second-order timeline model with more inference rules and more edge cases.

## Reuse Assessment

### Full OpenCode chat UI

Not recommended.

Reasons:

- It is Solid-based while Vivd Studio chat is React-based.
- It is tightly coupled to OpenCode app contexts (`useSync`, `useGlobalSync`, `useSDK`, prompt state, session layout, etc.).
- It assumes OpenCode's routing, settings, prompt editor, and side-panel model.
- Porting or embedding it would be a major integration project, not a targeted chat reliability fix.

### Reusing upstream UI components directly

Generally not recommended as a primary strategy.

The most relevant UI component, `SessionTurn`, is coupled to upstream data/context contracts and Solid component APIs. Its rendering ideas are useful, but direct reuse would likely cost more than rebuilding the equivalent behavior in Vivd.

### Reusing upstream sync/state patterns

Strongly recommended.

This is the highest-value takeaway from the upstream codebase.

Vivd should borrow:

- normalized client-side session/message/part store shape
- event coalescing and reconnect strategy
- optimistic submit + canonical reconciliation pattern
- turn derivation from canonical messages and `parentID`

## Recommendation

Vivd should keep its own chat UI, but rewrite the transport/state layer under it to follow the OpenCode model much more closely.

### Keep custom

- Vivd-specific composer UX
- selected-element attachment flow
- image/file attachment affordances
- Studio-specific controls and layout
- revert/unrevert affordances
- product-specific styling and wording

### Replace or refactor

- current custom live `streamingParts` model
- local `isWaiting` / `isStreaming` as primary truth
- custom chat-only event schema as the main frontend contract
- merge heuristics that stitch together polled snapshots and streamed fragments

## Recommended Target Architecture

### Backend / Studio bridge

Expose or forward richer canonical OpenCode events to the client instead of only the reduced Vivd-specific stream.

Minimum useful set:

- `session.status`
- `message.updated`
- `message.removed`
- `message.part.updated`
- `message.part.delta`
- `message.part.removed`

Optional but useful:

- permission/question/todo/diff events if Vivd wants richer action docks later

### Frontend state

Replace the current chat-local stream state with a normalized store:

- `sessionsById`
- `messagesBySessionId`
- `partsByMessageId`
- `sessionStatusById`

Then:

- derive "working" from `sessionStatus` plus unfinished assistant messages
- derive rendered turns from canonical messages and `parentID`
- keep optimistic submit only for the user message path
- reconcile optimism as canonical events arrive

### Rendering

Keep Vivd's custom look and layout, but drive it from canonical message/part state rather than from a secondary streaming model.

## Suggested Migration Path

### Phase 1: transport and store

- Add a normalized chat store in Studio client.
- Extend the Studio event bridge to emit canonical message/part/status events.
- Add coalescing and replay-safe dedupe at the event ingest layer.

### Phase 2: optimistic submit

- Move prompt submission toward the upstream OpenCode pattern:
  - optimistic user message insertion
  - optimistic parts insertion
  - server reconciliation on canonical events

### Phase 3: rendering migration

- Keep existing React chat UI shell.
- Rebuild `MessageList` / timeline rendering against canonical message/part store.
- Remove most of the pending-run hydration heuristics once canonical state is sufficient.

### Phase 4: cleanup

- Reduce or remove polling that exists only to heal drift from the current split model.
- Keep lightweight fallback polling for resilience, not as a primary synchronizer.

## Bottom Line

OpenCode's implementation is better in the area that matters most here: state synchronization.

Vivd should not replace its chat UI with the upstream web client, but it should strongly consider replacing its current streaming/state integration with an OpenCode-style normalized event/store model. That is the most likely path to fixing the current sync drift without giving up Vivd-specific UX.

## Feature Parity Gaps vs Upstream OpenCode Client

Vivd's current Studio chat is behind the upstream OpenCode client in several concrete areas.

### 1. Question tool support

Upstream OpenCode supports the `question` flow properly end to end:

- `question.asked` / `question.replied` / `question.rejected` are stored in the normalized sync layer
- questions render in a dedicated dock UI
- the dock supports:
  - single-choice questions
  - multi-choice questions
  - custom free-text answers
  - multi-step progress across multiple questions
  - explicit reject/dismiss flow

Relevant upstream files:

- `vendor/opencode/packages/app/src/context/global-sync/event-reducer.ts`
- `vendor/opencode/packages/app/src/pages/session/composer/session-question-dock.tsx`
- `vendor/opencode/packages/app/src/pages/session/composer/session-composer-region.tsx`

Vivd currently disables the `question` tool in Studio config policy:

- `packages/studio/server/opencode/configPolicy.ts`

So Vivd is currently missing both transport support and UI support for this feature.

### 2. Permission request UX

Upstream OpenCode has a dedicated permission dock with:

- allow once
- allow always
- reject
- permission-specific descriptions
- pattern display

Relevant upstream files:

- `vendor/opencode/packages/app/src/pages/session/composer/session-permission-dock.tsx`
- `vendor/opencode/packages/app/src/pages/session/composer/session-composer-region.tsx`

Vivd currently avoids this complexity partly by disabling `question` and simplifying the frontend flow, but this also means it is not aligned with upstream interaction patterns for agent blocking states.

### 3. Diff / review UI

Upstream OpenCode has materially richer diff and review support:

- session diff fetching and refresh
- review tab
- side-panel file/diff navigation
- unified and split diff modes
- focused file / diff navigation
- line comment hooks
- revert / unrevert integration around changed turns

Relevant upstream files:

- `vendor/opencode/packages/app/src/pages/session/review-tab.tsx`
- `vendor/opencode/packages/app/src/pages/session/session-side-panel.tsx`
- `vendor/opencode/packages/app/src/pages/session.tsx`

Vivd has its own revert affordances and activity rendering, but not upstream-level review/diff integration inside the chat/session experience.

### 4. Canonical event coverage

Upstream OpenCode's client consumes richer canonical event types than Vivd currently forwards to its frontend, especially:

- `session.status`
- `message.updated`
- `message.removed`
- `message.part.updated`
- `message.part.delta`
- `message.part.removed`
- `session.diff`
- `question.*`
- `permission.*`

Vivd currently narrows most of this into a chat-specific event stream and then reconstructs missing structure later. That keeps the UI lighter in the short term, but it moves more complexity into local heuristics and makes it harder to stay compatible with upstream improvements.

### 5. Session-level docks and surrounding UX

Upstream OpenCode has a more complete "session surface" around the prompt/composer:

- question dock
- permission dock
- todo dock
- follow-up dock
- revert dock
- session review tab
- session side panel

Vivd should not necessarily copy all of these verbatim, but the upstream decomposition is useful because it gives clear feature boundaries that can be mirrored in React without inventing entirely separate concepts.

## Alignment Strategy: Keep Vivd Close to Upstream

If the goal is to make future borrowing from upstream OpenCode practical, Vivd should optimize not only for behavior, but for structural similarity.

That means:

### 1. Mirror upstream data boundaries

Prefer matching upstream concepts:

- session
- message
- part
- session status
- session diff
- permission request
- question request
- todo state

Even if the UI stays different, using the same conceptual boundaries will make it much easier to copy logic from upstream later.

### 2. Prefer canonical event names and payload shapes where possible

Vivd does not need to expose the entire upstream transport unchanged, but it should bias toward forwarding or preserving upstream-compatible event categories instead of inventing narrower chat-only abstractions.

This is especially important for:

- status updates
- part updates
- part deltas
- permission/question flows
- diff updates

### 3. Keep React UI, but align component responsibilities

Vivd can still keep a custom React UI while matching the same coarse upstream component boundaries:

- timeline / turn rendering
- review surface
- prompt/composer region
- question dock
- permission dock
- follow-up dock
- revert dock

This would make future implementation borrowing much more direct, even if the code cannot be copied literally because of the framework difference.

### 4. Avoid over-custom intermediate abstractions

The more Vivd invents chat-specific local abstractions like:

- custom reduced event schemas
- local-only status flags as primary truth
- bespoke turn reconstruction rules

the harder it becomes to adopt upstream improvements later.

Where possible, Vivd should remove abstractions that only exist to translate away upstream structure and then re-infer it later.

### 5. Treat upstream as the reference model

For OpenCode-backed chat/session behavior, Vivd should treat upstream OpenCode as the reference implementation unless there is a product-specific reason to diverge.

Good default rule:

- if upstream already has a stable data model or state transition for a feature, Vivd should try to mirror it
- only UI presentation should diverge by default

## Recommended Compatibility Goal

The practical target should be:

"Vivd keeps a custom React chat experience, but its transport, state model, and session feature boundaries stay as close as reasonably possible to upstream OpenCode."

That gives Vivd the best of both worlds:

- custom product UX
- less sync drift
- easier future reuse of upstream fixes and features
- lower long-term maintenance cost for the OpenCode integration
