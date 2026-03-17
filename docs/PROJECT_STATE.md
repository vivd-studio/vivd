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

## Latest Progress (Top 2)

- 2026-03-17: fixed false 15s timeout UX for long-running Studio operations by centralizing tRPC request timeout resolution in `packages/studio/client/src/lib/trpcTimeouts.ts` with exact procedure matching, extending long-request budgets for `project.publish` + GitHub sync pull/force-sync + checklist/save flows, removing the publish dialog's separate 15s preflight race, and adding timeout-aware UI handling in publish + GitHub sync dialogs so users see "may still complete" status refresh guidance instead of hard failure when server-side work continues.
- 2026-03-17: hardened the frontend Studio runtime guard before commit: `useStudioRuntimeGuard` now ignores stale in-flight probes/recoveries when the target studio changes, avoids rerender-driven immediate-probe loops by decoupling internal effects from callback identity churn, adds focused regression tests for both behaviors, and is now also wired into `ProjectFullscreen` so assigned-project/single-project fullscreen flows recover suspended studios the same way as the other embed routes.

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
