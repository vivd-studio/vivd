# SSE Migration Plan (Polling Triage)

## Goal

Replace high-churn, event-driven polling with SSE where it is clearly more robust and lower-latency, while keeping polling for keepalive and recovery paths where polling is still the better safety mechanism.

## Decision Matrix

### Replace with SSE (high confidence)

1. Scratch generation status in wizard and project list
   - Current polling:
     - `packages/frontend/src/pages/scratch-wizard/ScratchWizardContext.tsx` (`refetchInterval: 1500`)
     - `packages/frontend/src/components/projects/listing/ProjectsList.tsx` (2s while non-completed projects exist)
   - Why SSE wins: generation state changes are discrete events (`pending -> scraping/analyzing/... -> completed|failed`), and immediate push removes bursty polling load.

2. Publish dialog state/checklist/status in control-plane UI
   - Current polling:
     - `packages/frontend/src/components/projects/publish/PublishSiteDialog.tsx` (5s/10s)
   - Why SSE wins: publish state changes only when specific backend events occur (workspace reports, checklist updates, publish/unpublish completion).

3. Connected-mode publish/checklist views in Studio UI
   - Current polling:
     - `packages/studio/client/src/components/publish/PublishDialog.tsx` (5s/10s)
     - `packages/studio/client/src/components/publish/usePrePublishChecklist.ts` (1s live polling)
   - Why SSE wins: checklist updates are explicitly incremental item events; push gives immediate progress and less request pressure.

4. Recent-project invalidation in sidebar
   - Current polling:
     - `packages/frontend/src/components/shell/AppSidebar.tsx` (30s)
   - Why SSE wins: this is primarily a freshness signal problem, so event-driven query invalidation is cleaner than fixed-interval refresh.

### Keep polling (intentional)

1. Studio/session keepalive heartbeats
   - `packages/frontend/src/pages/EmbeddedStudio.tsx`
   - `packages/frontend/src/pages/ProjectFullscreen.tsx`
   - `packages/frontend/src/pages/StudioFullscreen.tsx`
   - Reason: this is liveness signaling, not state-sync polling.

2. Chat polling fallback in Studio
   - `packages/studio/client/src/components/chat/ChatContext.tsx`
   - Reason: this is a deliberate safety net when SSE events are missed; keep as recovery path.

3. Dev server startup status polling
   - `packages/studio/client/src/components/preview/PreviewContext.tsx`
   - Reason: short-lived bootstrap polling is simple and resilient for start/install transitions.

4. Low-frequency usage snapshots
   - `packages/frontend/src/components/admin/usage/UsageStatsCard.tsx`
   - `packages/studio/client/src/components/chat/ChatContext.tsx` (`usage.status`)
   - Reason: low cadence and not strongly event-driven; SSE is optional, not required.

## Robustness Requirements (non-negotiable)

1. SSE must work across multiple backend instances.
2. Missed/disconnected clients must recover via replay or query reconciliation.
3. Polling fallback remains available for critical workflows until parity is proven.

## Proposed Backend Event Backbone

Use Postgres `LISTEN/NOTIFY` as the shared event bus for control-plane subscriptions:

1. Emit events on write paths that already define state transitions:
   - `packages/backend/src/services/project/ProjectMetaService.ts`
     - `createProjectVersion`
     - `updateVersionStatus`
     - `touchUpdatedAt`
     - `upsertPublishChecklist`
   - `packages/backend/src/trpcRouters/studioApi.ts`
     - `touchProjectUpdatedAt`
     - `reportWorkspaceState`
     - `upsertPublishChecklist`
   - `packages/backend/src/trpcRouters/project/publish.ts`
     - `publish`
     - `unpublish`
     - `updatePublishChecklistItem`

2. Add typed tRPC subscriptions in backend (`project.*`) over existing SSE transport.
3. Keep payloads minimal and event-oriented (mainly invalidation signals + key identifiers).

## Rollout Plan

### Phase 1: Generation + project-list freshness

1. Add backend `project.generationEvents` subscription (org + optional slug/version scope).
2. Wire emission from `ProjectMetaService.updateVersionStatus` and project creation paths.
3. Switch:
   - `ScratchWizardContext` from 1.5s polling to SSE + fallback query refetch.
   - `ProjectsList` active-generation polling to SSE invalidation.

Exit criteria:

- No 1.5s/2s generation polling loops in frontend.
- Generation state updates appear in UI within ~1s of transition.

### Phase 2: Publish dialogs + checklist updates

1. Add backend `project.publishEvents` subscription for state/checklist/status changes.
2. Emit on workspace-state reports, checklist upserts/item updates, publish/unpublish mutations.
3. Switch:
   - `PublishSiteDialog` to SSE-driven invalidation (remove 5s/10s polling).
   - Connected-mode Studio publish views to SSE via studio-side bridge subscription.

Exit criteria:

- Publish/checklist UIs update without fixed interval polling while dialogs are open.
- Live checklist progress remains at least as responsive as current 1s polling.

### Phase 3: Sidebar + selective studio polling cleanup

1. Invalidate `project.list` from project activity SSE events.
2. Remove 30s sidebar polling loop.
3. Reevaluate `gitHasChanges` 5s studio polling and replace only if event coverage is complete.

Exit criteria:

- Sidebar freshness no longer depends on a fixed timer.
- Studio polling reductions do not regress unsaved-change detection.

## Guardrails

1. Do not remove chat recovery polling.
2. Do not replace keepalive heartbeats with SSE.
3. Ship each phase behind a feature flag and keep fallback polling toggleable.

