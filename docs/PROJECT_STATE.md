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

- 2026-02-24: made route navigation feedback more noticeable with a subtle global top loading indicator on pathname changes (`RouteTransitionLoading`, minimum visible duration), while keeping `RouteLoadingIndicator` as route `Suspense` fallback and avoiding fullscreen in-app flashes.
- 2026-02-24: standardized loading UX across frontend and studio by routing page/tab/query loading placeholders through shared `LoadingSpinner`/`CenteredLoading` components and keeping loading visuals consistent.
- 2026-02-24: hardened chat error handling for provider/platform failures: added session-error sanitization (`chatErrorPolicy.ts`) so frontend banners avoid leaking raw upstream/internal messages, and prevented false `session.completed` emission after terminal `session.status:error` in OpenCode event handling.

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
