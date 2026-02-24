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
- Multi-org auth and tenant host scoping are implemented across core control-plane paths.
- Chat reliability and maintainability work is actively progressing (recent state-management refactors completed).

## Latest Progress (Top 3)

- 2026-02-24: extracted chat mutations/actions + confirm dialog management into `useChatActions.ts` and unified pending-preview message dispatch with normal send flow via shared `sendTask()` (removed ad-hoc `setTimeout` send path).
- 2026-02-24: refactored Studio chat context by extracting shared contracts and focused helpers (`chatTypes.ts`, `useChatAttachments.ts`, `chatEventHandlers.ts`, `chatMessageUtils.ts`), reducing coupling and duplicate logic.
- 2026-02-24: extracted chat session lifecycle orchestration into `useChatSessions.ts` (session/status/message polling, auto-select, hydration, and subscription gating).

## Active Priorities

1. Fix known failing Fly integration: `packages/backend/test/integration/fly_opencode_rehydrate_revert.test.ts`.
2. Implement reversible project archiving per `docs/project-archive-plan.md`.
3. Execute SSE migration Phase 1 per `docs/sse-polling-plan.md`.
4. Implement superadmin project-transfer flow per `docs/superadmin-project-transfer-plan.md`.
5. Implement app-login landing + post-login tenant redirect per `docs/app-login-landing-plan.md`.
6. Validate lifecycle sync hardening in real Fly runs (including larger OpenCode payloads).
7. Add Phase 4 E2E smoke coverage for critical cross-service flows.
8. Finish object-storage source-of-truth migration in backend (remove remaining local-FS assumptions).

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
