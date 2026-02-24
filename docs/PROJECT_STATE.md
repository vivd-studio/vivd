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

## Latest Progress (Top 5)

- 2026-02-24: removed the dedicated `docker-compose.self-hosted.yml` variant and standardized compose usage on the primary/local+prod compose files (`docker-compose.yml`, `docker-compose.override.yml`, `docker-compose.prod.yml`) to reduce deployment-surface duplication.
- 2026-02-24: added Resend SDK email delivery adapter behind the existing `EmailDeliveryService` abstraction (`RESEND_API_KEY` auto-detect, optional `VIVD_EMAIL_FROM`, provider fallback preserved), plus Resend webhook feedback ingestion for key deliverability signals (`email.bounced`, `email.complained`) at `/email/v1/feedback/resend`; compose/env templates now include `RESEND_WEBHOOK_SECRET` while existing SES feedback/suppression plumbing remains supported.
- 2026-02-24: implemented bounded agent-run machine keepalive: connected Studio now reports per-run active/idle lease heartbeats to backend (`studioApi.reportAgentTaskLease`), backend touches machines only for active leases, and leases hard-cap via `AGENT_LEASE_MAX_MS` to prevent endless uptime when sessions get stuck or stop signals are missed.
- 2026-02-24: changed Fly studio-machine GC policy from machine-age to visit-inactivity: visits are now persisted from `project.startStudio`, `project.hardRestartStudio`, and `project.touchStudio`, and reconciler destroy logic now targets machines not visited for the configured inactivity window (with created-at fallback for legacy machines missing visit records).
- 2026-02-24: standardized loading UX across frontend and studio by routing page/tab/query loading placeholders through shared `LoadingSpinner`/`CenteredLoading` components and keeping loading visuals consistent.

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
