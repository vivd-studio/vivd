# Studio Runtime Quiesce Plan

Date: 2026-04-02

## Status

Initial slice landed on 2026-04-02:

- `RuntimeQuiesceCoordinator` exists in `packages/studio/server/services/runtime`
- `preview-leave` now routes through `quiesceForSuspend()`
- `WorkspaceStateReporter`, `UsageReporter`, and OpenCode server shutdown are the first integrated subsystems
- Studio runtime/client/tRPC entrypoints now resume the quiesce state on real activity

Still open:

- Fly provider park/reconcile still keeps a fallback drain sleep
- release validation still needs to prove the new contract against published Studio images
- the separate OpenCode revert-smoke session-idle hang is not solved by this plan

## Why This Exists

Vivd currently parks Studio machines by asking the runtime to clean up and then
waiting a short amount of time before calling provider suspend/stop logic.

That works often enough to ship, but it is still brittle because "quiet enough
to suspend" is not an explicit runtime state. Instead, suspendability currently
emerges from a mix of:

- preview-close cleanup requests
- `WorkspaceStateReporter` pausing
- OpenCode server shutdown
- background network traffic naturally draining
- test/provider-side sleep windows

This plan turns suspend readiness into an explicit Studio runtime contract so
Fly warm wake, warm reconcile, and any future idle parking behavior stop
depending on timing guesses.

## Current Problem

Today the important cleanup path lives in:

- `packages/studio/server/httpRoutes/runtime.ts`
- `packages/studio/server/services/reporting/WorkspaceStateReporter.ts`
- `packages/studio/server/services/reporting/UsageReporter.ts`
- `packages/studio/server/opencode/serverManager.ts`
- `packages/backend/src/services/studioMachines/fly/provider.ts`

The current `/vivd-studio/api/cleanup/preview-leave` handler already does real
work:

- pauses `WorkspaceStateReporter`
- stops the OpenCode server for the workspace

That is why the current warm-wake and warm-reconcile smokes can succeed.

But there is still no single runtime-owned answer to:

`Is this Studio actually quiesced and safe to suspend right now?`

That gap causes the recurring failure mode where:

- the cleanup endpoint returns `200`
- the provider still waits with a best-effort drain sleep
- Fly sometimes lands in `stopped` instead of `suspended`

## Goals

- Make suspend readiness an explicit runtime state, not an emergent side effect.
- Keep the design small and local to Studio runtime ownership.
- Replace timing-based sleeps with runtime-owned quiesce completion wherever possible.
- Use the same contract for browser preview-close, provider park, and warm reconcile.
- Preserve the strict `suspended` behavior checks in release/integration smokes.

## Non-Goals

- Do not build a generic OS-style process manager.
- Do not weaken Fly suspend expectations in tests.
- Do not introduce provider-specific runtime logic into Studio.
- Do not block on larger OpenCode persistence/rehydration refactors.

## Proposed Model

### Runtime Quiesce Coordinator

Add a small coordinator in `packages/studio/server` that owns suspend-related
runtime state.

Suggested responsibilities:

- register suspend-relevant subsystems
- track subsystem state:
  - `active`
  - `quiescing`
  - `idle`
- expose:
  - `quiesceForSuspend()`
  - `resumeAfterActivity()`
  - `getQuiesceStatus()`

This should be a Studio runtime coordination primitive, not a global service
framework.

### Subsystem Adapters

The first subsystems to integrate should be:

1. `WorkspaceStateReporter`
2. `UsageReporter`
3. OpenCode runtime ownership via `serverManager`

Each adapter should be minimal. The coordinator does not need to know their
internal logic; it only needs:

- how to request quiesce
- how to tell whether the subsystem is idle

### Preview Leave Contract

Replace the current implicit preview-leave behavior with:

1. mark runtime as `quiescing`
2. stop accepting/starting new suspend-relevant activity
3. quiesce registered subsystems
4. wait until required subsystems are idle
5. return success only when quiesce is actually complete

This keeps `/vivd-studio/api/cleanup/preview-leave` useful, but changes it from
"best-effort cleanup started" to "runtime is now quiet enough for suspend."

### Provider Contract

Once the coordinator exists, Fly/Docker provider code should:

- request runtime quiesce
- rely on quiesce completion
- only keep a very small fallback settle window if still needed

The important shift is:

- current model: `cleanup + sleep + suspend`
- target model: `quiesce-until-idle + suspend`

## Rollout Phases

### Phase 0: Coordinator Skeleton

- add a small runtime quiesce coordinator module
- define status types and a minimal adapter interface
- keep it internal to Studio server

### Phase 1: Integrate Existing Cleanup Owners

- wire `WorkspaceStateReporter` into the coordinator
- wire `UsageReporter` into the coordinator
- wire OpenCode server lifecycle into the coordinator
- keep existing behavior intact while making quiesce state observable

### Phase 2: Replace Preview-Leave Semantics

- update `/vivd-studio/api/cleanup/preview-leave` to call `quiesceForSuspend()`
- return success only after required subsystems are idle
- add structured logging/diagnostics when quiesce fails or times out

### Phase 3: Provider Cutover

- update Fly provider park/reconcile paths to rely on runtime quiesce completion
- reduce or remove fixed post-cleanup drain sleeps
- keep strict `suspended` checks in integration/release smokes

### Phase 4: Validation And Cleanup

- add direct unit tests for the coordinator
- add focused runtime-route tests for preview-leave quiesce behavior
- trim now-redundant timing glue where the explicit contract replaces it

## Testing Plan

Add or update focused coverage for:

- coordinator status transitions
- preview-leave returning only after runtime quiesce completes
- `WorkspaceStateReporter` pause/shutdown interaction
- `UsageReporter` flush/quiesce interaction
- OpenCode server stop/quiesce interaction
- Fly warm wake auth still requiring `suspended`
- Fly warm reconcile still requiring `suspended`

The release smokes should remain behaviorally strict:

- `fly_warm_wake_auth.test.ts`
- `fly_reconcile_flow.test.ts`

The point of this refactor is to make them more reliable without making them easier.

## Open Questions

- Should `UsageReporter` only stop new flush scheduling, or should it also force
  a final flush before declaring `idle`?
- Are there any other runtime subsystems that can keep Studio effectively active
  after preview-close but before suspend?
- Should quiesce state be surfaced in `/health` or a dedicated debug endpoint for
  easier smoke diagnostics?

## Suggested Order

1. Build the coordinator and status model.
2. Integrate the three initial subsystems.
3. Change preview-leave to use explicit quiesce.
4. Switch Fly provider/reconcile to trust quiesce completion.
5. Remove as much timing-based suspend glue as the new contract makes obsolete.

## Done Means

- Studio has one explicit runtime-owned answer to "safe to suspend now?"
- preview-leave only returns success after required subsystems are idle
- Fly park/reconcile logic does not primarily rely on drain sleeps anymore
- release smokes still require `suspended` and stay green for the right reasons
