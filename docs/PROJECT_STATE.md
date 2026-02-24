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

## Latest Progress (Top 9)

- 2026-02-24: fixed backend unit-test harness regressions so targeted coverage runs are stable again: aligned contact-form permission test assertions with current verification error copy, corrected email-delivery test env isolation (`VIVD_FROM_EMAIL`), updated plugin-service DB mocks for external-recipient verification lookups, and hardened router/process tests against sandbox timing/bind behavior (`127.0.0.1` listen + explicit stop polling).
- 2026-02-24: adjusted control-plane sidebar search active-state border to use the primary accent color for stronger visibility while focused; unfocused/typed states still avoid a persistent border outline.
- 2026-02-24: updated control-plane sidebar search input styling so the border outline appears only while the field is actively focused; typed search text now keeps a subtle background emphasis without a persistent border.
- 2026-02-24: refined Studio chat activity timeline UX to be denser/cleaner and less noisy: reduced spacing in chat bubbles/rows, removed tool-status icons, replaced generic `Tool Call` labels with action-oriented labels (for example `Exploring...`/`Explored` and `Editing...`/`Edited` with filename extraction from tool input), standardized expandable activity rows for Thought/tool lines, emphasized action verbs over filenames, moved chevrons inline with labels, and hid chevrons until row hover/focus for a cleaner baseline; added subtle timestamps on user messages plus a collapsible per-response "worked session" section (auto-collapsed when complete) so action traces can be revealed on demand while response text remains always visible; consolidated run traces to a single worked section per run (including merged contiguous assistant fragments); during live generation, action rows now render directly (no worked divider until response exists) with slot-stable fallback rows (`Waiting...` and in-between `Working...`) so there is no blank transition between completed and next active steps, and active loading states now use animated dot cycling plus a subtle moving gradient; additionally, in-flight/polled agent fragments are now suppressed while loading and worked sections are only shown when response text exists, preventing `Worked for ...` from appearing alongside live `Waiting...`; live action labels remain visible until final response while inner tool/thought details stay collapsed by default, and only the worked-session container is expanded during active runs; shared divider styling now unifies `Worked for ...` and `Done` indicators with matched spacing/length, and agent response + worked-divider tracks now span the full chat content width; dark-mode user bubble contrast is now slightly stronger to avoid an overly light appearance; raw OpenCode tool error payloads remain suppressed from end-user chat output while preserving clear failure styling.
- 2026-02-24: hardened Studio chat reliability around stuck states by (1) sanitizing surfaced session errors to avoid leaking provider/platform internals, (2) suppressing false `session.completed` after terminal `session.status:error`, and (3) preferring OpenCode status API over stale emitter `busy` overrides so refreshed sessions do not remain pinned in `Waiting...`.
- 2026-02-24: implemented contact-form recipient verification onboarding: project/plugin-scoped pending verification records, public verification link endpoint, idempotent add/resend flow, and Contact Form panel recipient UX updates (verified list + add-from-dropdown + pending resend) so external recipients can verify without being added as org members; follow-up wiring now also accepts `VIVD_FROM_EMAIL` as a sender-env alias (plus compose passthrough) to reduce sender misconfiguration.
- 2026-02-24: removed the dedicated `docker-compose.self-hosted.yml` variant and standardized compose usage on the primary/local+prod compose files (`docker-compose.yml`, `docker-compose.override.yml`, `docker-compose.prod.yml`) to reduce deployment-surface duplication.
- 2026-02-24: added Resend SDK email delivery adapter behind the existing `EmailDeliveryService` abstraction (`RESEND_API_KEY` auto-detect, optional `VIVD_EMAIL_FROM`, provider fallback preserved), plus Resend webhook feedback ingestion for key deliverability signals (`email.bounced`, `email.complained`) at `/email/v1/feedback/resend`; compose/env templates now include `RESEND_WEBHOOK_SECRET` while existing SES feedback/suppression plumbing remains supported.
- 2026-02-24: implemented bounded agent-run machine keepalive: connected Studio now reports per-run active/idle lease heartbeats to backend (`studioApi.reportAgentTaskLease`), backend touches machines only for active leases, and leases hard-cap via `AGENT_LEASE_MAX_MS` to prevent endless uptime when sessions get stuck or stop signals are missed.
- 2026-02-24: changed Fly studio-machine GC policy from machine-age to visit-inactivity: visits are now persisted from `project.startStudio`, `project.hardRestartStudio`, and `project.touchStudio`, and reconciler destroy logic now targets machines not visited for the configured inactivity window (with created-at fallback for legacy machines missing visit records).

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
