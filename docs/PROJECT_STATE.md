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

- 2026-02-25: simplified Studio chat composer focus styling further by removing the remaining focus outer glow; active state is now shown by border-color change only (single outline, no secondary ring).
- 2026-02-25: fixed a critical Studio streaming regression that could mirror the user's own prompt in the assistant lane when text parts arrived before role metadata: `useEvents` now buffers unknown-role text deltas per message and only flushes once the message is confirmed assistant (dropping buffered chunks for user-role messages), while keeping fine-grained assistant streaming intact.
- 2026-02-25: improved Studio chat motion polish with low-risk UI behavior changes: message-list autoscroll is now "stick to bottom" aware (smoothly following live output only while the viewer is near the bottom, without yanking when manually reading older messages), and chat rows/streamed response chunks now use subtle fade/slide-in transitions for a smoother perceived text handoff during generation.
- 2026-02-25: removed the Studio chat composer “double border” focus artifact by replacing stacked focus shadows with a single outer glow around the active border, keeping focus visibility clear without a duplicated outline.
- 2026-02-25: tuned chat visual hierarchy across all light themes by deepening secondary/muted/border/chat-user tokens (so level differences are clearer than near-flat grays), and strengthened composer active-state visibility with a more explicit ring-color focus border/glow while keeping the outline physically thin.
- 2026-02-25: hardened Studio OpenCode streaming against event-order/schema variance: `useEvents` now handles `message.part.delta` directly and avoids dropping assistant text when `message.part.updated` arrives before `message.updated(role=assistant)`, reducing cases where responses appear only as one final chunk.
- 2026-02-25: refined Studio chat visual rhythm and theming: worked-session action lists now use symmetric vertical padding so spacing from the `Worked for ...` divider matches spacing to the response below; message-list bottom padding was reduced slightly (`pb-16` mobile / `pb-20` desktop); dark-mode chat composer surface now aligns closer to the chat background across themes (lower contrast jump); composer focus styling now uses a thinner, higher-contrast outline instead of a thick ring; and mono-theme gray tokens were darkened modestly (light + dark) for stronger surface definition.
- 2026-02-25: improved Studio response streaming fidelity with no artificial chunking by preferring OpenCode native `message.part.updated.properties.delta` payloads when available (and falling back to text-length diff only when delta is absent), so UI updates can follow upstream fine-grained response parts directly.
- 2026-02-25: increased Studio chat message-list bottom spacing substantially (`pb-20` mobile / `pb-24` desktop) so the last visible messages/actions sit clearly above the composer instead of appearing cramped against the input surface.
- 2026-02-25: completed another Studio chat timeline/rendering stabilization pass: interleaved agent runs (for example `text -> tool -> text`) now preserve strict event order in the UI instead of forcing text to the end; worked-session wrapping is only applied to non-interleaved completed runs; markdown rendering is normalized so headings use the same base font size as body text (with stronger weight instead of larger size); and composer wrapper top padding was removed to reduce the visible gap/cutoff between the message list and input area at the bottom.
- 2026-02-25: increased Studio chat message-list bottom padding to allow deeper end-of-thread scroll position (more breathing room beneath the latest message before the composer), improving readability of final lines during long responses.
- 2026-02-25: adjusted Studio chat bottom anchoring to prevent last-response text clipping behind the composer: replaced the previous negative-margin zero-height bottom sentinel with a minimal positive-height anchor and tiny message-list bottom padding, preserving near-tight alignment while restoring full scroll reach for the final lines.
- 2026-02-25: fixed missed worked-session auto-collapse after response completion by removing a global `isRunInProgress` guard from collapse-timer scheduling; previously, a run that completed while any run was still marked active could skip scheduling and remain expanded indefinitely.
- 2026-02-25: fixed Studio chat status-row overlap during live runs by suppressing `Working...` fallback when the ordered active action row is already `Thinking...` or another running action, preventing duplicate simultaneous state lines in the action list.
- 2026-02-25: re-enabled sending new chat prompts during `Waiting...` in Studio by removing the `isWaiting` early-return guard in `ChatContext.handleSend`; duplicate-protection while actively streaming (`isStreaming`) and during in-flight submit mutations (`runTaskMutation.isPending` / `isSending`) remains in place.
- 2026-02-25: stabilized user-message layout during optimistic->persisted transitions in Studio chat by reserving a fixed-height slot for the `Revert to before this` action, preventing vertical bubble jumps when message IDs arrive and the revert control becomes available.
- 2026-02-25: further stabilized Studio chat run rendering: action-part ordering now tracks first-seen IDs across both streaming and persisted message parts to reduce in-run row shuffling; worked-session bodies are now scrollable when expanded (bounded max height), and bottom-of-list spacing was tightened (`Done` gets no trailing margin + zero-height bottom anchor) so chat content scrolls closer to the composer instead of stopping early above input.
- 2026-02-25: fixed Studio chat run activation/collapse edge cases after send: active-run assignment now only targets a pending unpaired user turn (or a synthetic pending turn), which prevents previously completed `Worked for ...` sections from re-opening when a new message starts; completion auto-collapse now keys off runs that were observed in-progress and later became completed, including transitional `in-progress -> other -> completed` paths.
- 2026-02-24: added a new monochrome color theme (`mono`) across shared/frontend/studio theme systems with near-white light mode and near-black dark mode, and upgraded both frontend and studio theme selectors to show compact per-theme color indicators beside labels so users can preview palette direction before switching.
- 2026-02-25: refined Studio chat run UX with lower-jank transitions and readability tweaks: worked-session auto-collapse is now scheduled once per completed run from parent state (instead of per-row local mount effects), reducing duplicate open/close flicker; thought panels now auto-follow incoming text only while expanded; loading-wave animation is slower/subtler; message-list container padding is increased while bottom padding is removed so content scrolls closer to the composer; tool action verbs are emphasized over targets (for example `Edited` vs filename), and dark-mode user bubbles are slightly darker for contrast.
- 2026-02-24: refactored Studio chat rendering around a dedicated timeline/view-model builder (`chatTimelineBuilder`) so run/action visibility is derived in one place instead of interleaved across `MessageList`; this stabilizes in-flight action persistence, prevents mid-generation collapse churn, and enables smooth auto-collapse animation when a run transitions from active actions to the final worked section while keeping the response outside toggleable activity rows.
- 2026-02-24: made Vivd frontend branding gradients theme-aware in key entry points by replacing static icon usage with an inline SVG that reads theme tokens (`--primary`/`--chart-2`) and by switching sidebar/create-view hardcoded green/amber gradient styles to the same token-based gradient, so brand accents now follow the selected color theme.
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
9. Add a Studio preview layout setting to toggle panel positions between `Assets left + Agent right` and `Agent left + Assets right`, with persisted per-user preference.

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
