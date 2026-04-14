# Studio Initial-Generation Review

Date: 2026-04-09

## Scope

Review of the current local changes related to:

- Studio handover after scratch generation
- runtime URL / compatibility route selection
- Studio client shell and base-path changes
- initial-generation session start / monitoring
- the reported symptom that normal agent tasks on an already-running Studio usually work, while the first scratch-triggered task on a freshly created Studio is brittle

## Executive Summary

My read is:

- The routing / base-path / same-origin work is directionally correct and is trying to solve real problems.
- The fresh initial-generation path has become more complex and more fragile than the normal "open Studio, then start a task" path.
- The current branch is not fully stable yet: one focused backend regression test is red locally, and the most plausible causes of the brittle behavior are in the initial-generation-only code path rather than in the general agent/runtime path.

The most likely explanation for the live symptom is that the branch now has multiple early-boot heuristics that can prematurely conclude a brand-new session is finished or failed, even though a later manual task on the same Studio works fine.

## What Looks Directionally Right

### 1. Same-origin / compatibility URL handling

The changes in:

- `packages/backend/src/services/studioMachines/runtimeAccessResolver.ts`
- `packages/frontend/src/hooks/useStudioHostRuntime.ts`
- `packages/frontend/src/pages/EmbeddedStudio.tsx`
- `packages/frontend/src/pages/StudioFullscreen.tsx`

are solving a real browser/runtime mismatch: when the host app origin differs from the direct Studio runtime origin, preferring a same-origin compatibility URL is the right general direction.

### 2. Studio shell handoff waiting for a real initial session id

The host-side changes that wait for a real `sessionId` before bootstrapping the iframe are also directionally correct. They reduce the chance that the shell comes up before the initial-generation session is actually known.

### 3. Preview-leave cleanup narrowing

Moving preview-leave cleanup to real unload behavior instead of plain React unmount behavior also looks right. That change should reduce accidental cleanup during remounts and StrictMode-style churn.

## Findings

### 1. `useEvents` can still finalize a fresh run too early because it treats non-assistant message parts as "assistant activity"

Files:

- `packages/studio/server/opencode/useEvents.ts`

Relevant lines:

- `message.part.updated`: `hasObservedAssistantActivity = true` is set before checking whether the message is actually assistant-owned.
- `message.part.delta`: same issue.

Why this matters:

- The new idle-completion guard is meant to avoid treating `session.idle` as terminal until the assistant has actually started doing work.
- In the current code, any message-part activity can flip that guard, including the user's own submitted prompt.
- That means a transient early `session.idle` can still finalize a brand-new run before the assistant has really settled.

Why this matches the reported behavior:

- It would hit the first scratch-triggered task much more often than later manual tasks because the fresh boot path is where startup races, warmup gaps, and transient idle states are most likely.
- It is consistent with "one or two actions happen and then the generation breaks off."

Assessment:

- High-confidence bug.
- This is the strongest single candidate I found for the brittle fresh-boot behavior.

Suggested fix:

- Only set `hasObservedAssistantActivity` when the message is known to be assistant-owned, or when the part type itself proves assistant-side work.
- Add a regression test where:
  - the user message is observed,
  - a transient `session.idle` happens before real assistant output,
  - and the session must not be finalized.

### 2. Initial generation no longer skips the session-start system prompt, making the fragile first run behave differently from ordinary tasks

Files:

- `packages/studio/server/services/initialGeneration/InitialGenerationService.ts`
- `packages/studio/server/opencode/index.ts`

Relevant change:

- `InitialGenerationService` now calls `runTask(...)` without `skipSessionStartSystemPrompt: true`.
- The lower-level OpenCode path still supports skipping that prompt, but initial generation no longer uses it.

Why this matters:

- The first scratch run now carries both:
  - the large scratch-specific initial-generation task prompt, and
  - the normal session-start system prompt.
- Ordinary later tasks do not have the same startup conditions and therefore are not a valid stability comparison for this code path.

Why this matches the reported behavior:

- You explicitly observed that normal agent tasks on an already-running Studio usually work.
- This prompt-path divergence is one of the clearest ways the first run now differs from later runs.

Assessment:

- Medium-confidence regression vector.
- I would not claim this is the only problem, but it is a very plausible contributor and it is currently unprotected by a dedicated regression test.

Suggested fix:

- A/B this immediately by restoring `skipSessionStartSystemPrompt: true` for scratch initial generation and comparing live behavior.
- Add a unit test asserting which prompt mode initial generation is supposed to use.

### 3. The initial-generation monitor is too aggressive about declaring a session failed after short inactivity

Files:

- `packages/studio/server/services/initialGeneration/InitialGenerationService.ts`

Relevant behavior:

- `TERMINAL_IDLE_GRACE_MS` is `10_000`.
- `deriveMonitoredSessionOutcome(...)` marks the session as failed after that idle window whenever the status is no longer `busy` or `retry` and the latest assistant message is not marked completed.
- `startMonitor(...)` then writes `failed` state back into the manifest/backend status.

Why this matters:

- On a cold Studio boot, a run can have short quiet periods while the runtime, tools, workspace state, or provider side settle.
- A 10-second grace period is aggressive for the most fragile path in the system.
- Once this path flips the manifest/backend state to `failed`, follow-on recovery logic starts treating the session as stale/broken.

Why this matches the reported behavior:

- It fits a run that starts, performs a little work, then gets classified as failed too early.
- It also explains why the same Studio can feel stable once it is already warm.

Assessment:

- Medium-to-high confidence robustness problem.
- Even if this is not the root cause, it amplifies transient startup instability into a hard failed state.

Suggested fix:

- Do not mark initial generation failed on short idle alone.
- Prefer explicit terminal signals such as:
  - session error,
  - explicit completion,
  - or a much longer idle window combined with stronger evidence that the run is actually dead.

### 4. Local compatibility-route creation is currently too dependent on env-derived "local development origin", and one backend regression test is red

Files:

- `packages/backend/src/services/studioMachines/compatibilityRoutePolicy.ts`
- `packages/backend/src/services/studioMachines/local.ts`

Observed test result:

- Focused backend run fails in `packages/backend/test/local_provider_orchestration.test.ts`
- Failure: expected a compatibility URL for the local provider, but `getUrl(...)` returned `compatibilityUrl: null`

Why this matters:

- `shouldCreateStudioCompatibilityRoutes(...)` now enables platform compatibility routes only when `resolveAuthBaseUrlFromEnv(process.env)` looks like a local-development origin.
- That makes compatibility-route behavior depend on process env shape rather than the actual runtime/request topology.
- In local connected/self-host style setups, that is brittle.

Assessment:

- High-confidence regression in the local platform/testing path.
- This is concrete, not speculative: the focused backend suite is red on it.

Suggested fix:

- Base this decision on the actual request/runtime topology rather than only on env-derived public origin.
- At minimum, make the local-provider path deterministic in tests and local connected development.

## Test Results From This Review

### Backend

Command:

`npm run test:run -w @vivd/backend -- test/studio_runtime_access_resolver.test.ts test/compatibility_route_policy.test.ts test/project_studio_backend_url.test.ts test/local_provider_orchestration.test.ts`

Result:

- `studio_runtime_access_resolver`: pass
- `compatibility_route_policy`: pass
- `project_studio_backend_url`: pass
- `local_provider_orchestration`: fail

Failure summary:

- expected local provider `getUrl(...)` to return a compatibility URL
- actual result returned `compatibilityUrl: null`

### Frontend

Command:

`npm run test:run -w @vivd/frontend -- src/hooks/useStudioHostRuntime.test.ts src/hooks/useStudioRuntimeGuard.test.tsx src/pages/EmbeddedStudio.test.tsx`

Result:

- all targeted tests passed

### Studio

Command:

`npm run test:run -w @vivd/studio -- server/services/initialGeneration/InitialGenerationService.test.ts server/opencode/useEvents.test.ts client/src/components/chat/ChatContext.followup.test.tsx client/src/components/preview/previewLeave.test.ts server/httpRoutes/client.test.ts server/http/basePathRewrite.test.ts`

Result:

- all targeted tests passed

Important caveat:

- The current Studio tests do not cover the most suspicious live failure mode I found:
  - user prompt observed,
  - early transient idle on a fresh run,
  - session incorrectly treated as terminal.

## Overall Judgment

This branch is mixed:

- The routing / same-origin / shell-handoff work is going in the right direction.
- The initial-generation-only behavior is currently becoming less robust, not more robust.

If I had to summarize it for the developer in one sentence:

> The access-routing changes look like real hardening, but the fresh initial-generation lifecycle now has multiple premature-terminal heuristics and one prompt-path divergence that together make the cold-start scratch run more brittle than the normal "Studio already running" task flow.

## Recommended Next Actions

1. Fix `useEvents` so only assistant-side activity arms idle completion.
2. Restore `skipSessionStartSystemPrompt: true` for scratch initial generation and compare live behavior.
3. Relax or redesign the 10-second idle-to-failed heuristic in `InitialGenerationService`.
4. Fix the local compatibility-route policy so the local provider reliably exposes the compatibility URL in intended local platform flows.
5. Add one production-shaped regression test for:
   - fresh Studio boot,
   - scratch initial generation,
   - at least several recorded assistant actions without premature completion/failure.

## What I Did Not Run

- I did not run the full publish flow.
- I did not run Fly integration tests, because they are infra-dependent and slower than the targeted review loop above.
- I did not change runtime code in this review; this document is analysis only.
