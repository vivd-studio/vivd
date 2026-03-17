# Vivd Project State (Current)

> Goal: run Vivd as a reliable multi-tenant SaaS with isolated studio machines, object-storage-backed projects, and predictable publish/preview flows.

## Current Focus

- Stabilize Studio agent/runtime reliability on Fly (revert/rehydrate + eventing + sync correctness).
- Complete near-term product/platform work needed for day-to-day SaaS operations.
- Keep documentation and execution plans concise for active contributors.

## Current Status

- Architecture split is stable: control plane (`packages/backend`) + isolated studio runtime (`packages/studio`).
- Bucket-first runtime for source, preview, and publish is active.
- Fly studio machine orchestration is operational for core lifecycle paths.
- Single-host Docker studio-machine orchestration is now wired behind `STUDIO_MACHINE_PROVIDER=docker`.
- Multi-org auth and tenant host scoping are implemented across core control-plane paths.
- Chat reliability and maintainability work is actively progressing (recent state-management refactors completed).

## Latest Progress

- 2026-03-17: moved the remaining Studio chat sync/controller ownership out of the component-side legacy layer and into `packages/studio/client/src/features/opencodeChat/*`. A new OpenCode chat controller/runtime now owns canonical session selection, derived thinking/streaming/waiting state, sync-facing error derivation, and low-level chat/session mutations; `ChatContext.tsx` was reduced back toward a UI shell that mainly handles input, attachments, model choice, and confirm dialogs. As part of the cleanup, dead legacy files were removed: `useChatActions.ts`, `useChatSessions.ts`, `chatEventHandlers.ts`, and the old component-scoped `chatErrorPolicy.ts` path. Focused OpenCode-chat tests plus a full Studio client build are green, and the core diff for this cleanup slice is deletion-heavy (`142` insertions vs `1330` deletions across the main legacy/component sync files).
- 2026-03-17: refreshed the Super Admin organizations workspace in `packages/frontend`: the app shell now correctly identifies `/vivd-studio/superadmin` as Super Admin instead of falling back to Projects, the Super Admin sidebar now includes the Email destination, the in-page Super Admin tabbar stays aligned with the existing full-width tab styling used elsewhere in the app, and the Organizations section was rebuilt into a more intentional master-detail layout with a searchable org directory, a stronger org summary header, and card-based usage/limits panels. Focused shell tests were added, and the frontend test run plus full frontend build are green.

- 2026-03-17: aligned the Studio chat subscription path more closely with upstream OpenCode transport behavior by adding a dedicated canonical event batcher in `packages/studio/client/src/features/opencodeChat/sync/subscriptionBatcher.ts` and wiring `OpencodeChatProvider` to queue/coalesce high-churn canonical events before dispatching them to the reducer as `events.receivedBatch`. Repeated `session.status` and `message.part.updated` events are now coalesced within a flush window instead of triggering immediate per-event reducer work, stale deltas are skipped when later same-part updates replace earlier ones in the same batch, focused batching/reducer tests were added, and the Studio client build is green.
- 2026-03-17: wired the first single-host Docker studio-machine path across backend, frontend, and deploy config: `STUDIO_MACHINE_PROVIDER=docker` now selects the Docker provider, Caddy runtime routes are shared through `/etc/caddy/runtime.d`, compose files mount the Docker socket plus route volume, backend/superadmin machine management is provider-neutral across Fly and Docker, and the frontend now preserves path-prefixed runtime URLs like `/_studio/<route-id>/...` for health checks and iframe loads.
- 2026-03-17: tightened the default Studio agent instruction template for plugin-backed features in `packages/backend/src/services/agent/AgentInstructionsService.ts` and the disconnected fallback in `packages/studio/server/services/agent/AgentInstructionsService.ts`: the prompt now labels the injected list as enabled plugins for the current project, explicitly steers the agent toward plugin-first handling for Contact Form/Analytics, points it at `vivd_plugins_catalog` and matching `vivd_plugins_*_info` tools when available, and tells it to recommend Vivd support activation instead of defaulting to bespoke replacements when a needed plugin is not enabled.
- 2026-03-17: fixed another Studio chat collapse regression in `packages/studio/client/src/components/chat/MessageList.tsx`: once a `Worked for ...` block has auto-collapsed, later follow-up sends no longer reopen that older run just because the timeline/status effect sees another transition. This keeps completed prior runs collapsed while a new follow-up turn is streaming, and the Studio client build is green.
- 2026-03-17: fixed a canonical Studio chat renderer bug where follow-up runs could strand a `Thought` outside the correct `Worked for ...` block or split the second run’s work trace from its final response. `packages/studio/client/src/features/opencodeChat/render/timeline.ts` now groups turns the way OpenCode does conceptually: one user-anchored turn can accumulate multiple assistant messages via `parentID` instead of assuming a single assistant message per turn. That lets follow-up runs keep all reasoning/tool/text parts inside the correct turn, also fixes interrupted-continue detection for latest turns with multi-message assistant output, and the focused renderer tests plus full Studio client build are green.
- 2026-03-17: moved the Studio chat renderer off the legacy `Message[]`/`chatTimelineBuilder` path and onto a canonical OpenCode view-model in `packages/studio/client/src/features/opencodeChat/render/*`: `MessageList` now reads canonical `selectedMessages` from `OpencodeChatProvider`, builds the visible chat timeline directly from OpenCode session/message/part records, and no longer keeps a separate `liveParts` stream buffer for rendering. The old `chatTimelineBuilder.ts`, `chatTimelineBuilder.test.ts`, `chatMessageUtils.ts`, and `chatMessageUtils.test.ts` were removed, `ChatContext` now exposes only shell/composer state plus `messageCount` instead of a legacy mapped `messages` array, and focused canonical renderer/metrics/reducer tests plus a full Studio client build are green.
- 2026-03-17: fixed a regression in the simplified Studio chat context where session selection could be cleared during normal provider updates: the new `ChatContext` project-reset and auto-select effects were depending on the whole `OpencodeChatProvider` context object instead of stable fields/functions, which caused newly created sessions not to stay selected and existing session tabs to feel unselectable. The fix narrows those effects to stable provider dependencies only, and the Studio client build is green again.

## Active Priorities

1. Execute the clean OpenCode-aligned Studio chat refactor plan in `docs/opencode-chat-refactor-plan.md`.
2. Fix known failing Fly integration: `packages/backend/test/integration/fly_opencode_rehydrate_revert.test.ts`.
3. Implement reversible project archiving per `docs/project-archive-plan.md`.
4. Execute SSE migration Phase 1 per `docs/sse-polling-plan.md`.
5. Implement superadmin project-transfer flow per `docs/superadmin-project-transfer-plan.md`.
6. Implement app-login landing + post-login tenant redirect per `docs/app-login-landing-plan.md`.
7. Validate lifecycle sync hardening in real Fly runs (including larger OpenCode payloads).
8. Add Phase 4 E2E smoke coverage for critical cross-service flows.
9. Finish object-storage source-of-truth migration in backend (remove remaining local-FS assumptions).

## Open Decisions

| Question | Status |
|---|---|
| Fly app strategy (single app vs app-per-tenant) | TBD |
| Concurrency model for edits (single-writer lock vs optimistic) | TBD |
| Build execution location (backend vs studio vs dedicated builder) | TBD |
| Preview artifact exposure (public vs signed URLs) | TBD |
| Studio URL pattern (iframe route vs redirect vs subdomain) | TBD |

## Archive

- Historical progress entries and retired detailed sections are in `docs/PROJECT_STATE_ARCHIVE.md`.
