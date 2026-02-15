# Publishing Bucket-First Consolidation Plan

Date: 2026-02-08
Owner: backend + studio + frontend
Status: in progress (phases A-E largely implemented; live Studio unsaved-state reporting added; cleanup/hardening remains)

## Scope
This plan consolidates publishing, preview serving, and checklist handling around object storage as source of truth, while keeping Caddy local serving for published sites.

It captures the decisions agreed in the 2026-02-08 discussion.

## Agreed Decisions
1. Project listing remains DB-first.
2. Publish must not rely on local `projects/<slug>/vN` directories.
3. Preview serving must not rely on local `versionDir` detection/fallback.
4. Generation flows/context may continue using temporary local workspace while running, then sync artifacts to bucket on completion.
5. Local studio provider should stay behaviorally close to production studio flow.
6. Checklist is DB-only (no `.vivd/publish-checklist.json` source of truth).
7. Keep publish/unpublish actions in Studio and outside Studio (preview/dashboard), but use one backend publish pipeline.
8. Publish should reuse already-built preview artifacts when possible (avoid rebuild on publish).
9. Guard against publish/build race conditions with explicit readiness checks.
10. Keep Caddy serving from local `/srv/published` (materialized from bucket artifact), not directly from project workspace.
11. Studio publish in connected mode should go through backend APIs via studio server proxy.
12. Studio publish dialog in connected mode must show real backend publish status (domain/URL/version/time) and expose unpublish.

## Target Architecture
- Source of truth:
  - `source/` (raw project files)
  - `preview/` (ready preview build for Astro; source for static)
  - `published/` (artifact record for what was published)
- Runtime publish serving:
  - Caddy serves `/srv/published/<slug>`
  - backend publish pipeline hydrates this directory from bucket artifact
- Metadata/state:
  - project/version metadata in DB
  - publish checklist in DB
  - published domain mapping in `published_site`

## User Flow (Non-Technical)
- In Studio:
  - User edits and saves.
  - User clicks `Publish changes`.
- In Preview/Dashboard:
  - User clicks `Publish changes` or `Unpublish site` without starting studio.
- Messaging:
  - Show exactly what will be published: last saved/ready build timestamp + version.
  - If Studio has unsaved changes, show warning: `You have unsaved changes in Studio.`
  - Provide CTA button: `Open Studio to save changes`.
  - If latest build is not ready, block publish with clear status (`Build in progress`).
  - Keep technical terms (tags/commits) hidden from primary UI.

## Unsaved-Changes Contract
- Backend should expose publish dialog state inputs:
  - `studioRunning` (is a studio currently active for this project/version)
  - `lastSyncedCommitHash` (latest commit/hash synchronized to bucket artifacts)
  - `publishableCommitHash` (artifact hash that will be published)
- UI state mapping:
  - `publishableCommitHash === lastSyncedCommitHash`: ready
  - `studioRunning && publishableCommitHash !== lastSyncedCommitHash`: unsaved/stale warning, offer `Open Studio to save changes`
  - artifact not ready: block with `Build in progress`

## Publish Contract
Input:
- `slug`, `version`, `domain`
- optional `expectedCommitHash` (or expected artifact revision) from UI

Server behavior:
1. Validate domain and permissions.
2. Resolve publish source from bucket:
   - Astro: `preview/` artifact must be `ready`.
   - Static: `source/` artifact is publish source.
3. Enforce readiness:
   - If not ready, return conflict (`409 build_in_progress` or `artifact_not_ready`).
4. Optional compare-and-swap:
   - if `expectedCommitHash` provided and current artifact hash differs, return conflict (`409 artifact_changed`).
5. Materialize selected artifact into local `/srv/published/<slug>`.
6. Upload/refresh `published/` artifact metadata in bucket.
7. Upsert `published_site` row and reload Caddy.

Unpublish contract:
- Remove Caddy site config + DB mapping + optionally local `/srv/published/<slug>`.
- Must not require studio/checklist execution.

## Race Condition Handling
- Introduce strict artifact readiness checks in publish endpoint.
- Publish only from a completed artifact version/hash.
- Return deterministic errors while build is still running.
- Optional per-project publish lock (DB advisory lock or mutex) to avoid overlapping publish operations.

## Checklist Consolidation (DB-Only)
- Studio agent still executes checklist.
- On run/fix, studio writes checklist result to backend DB immediately.
- Backend APIs expose checklist status/freshness for preview/dashboard publish dialogs.
- Remove file-backed dependency as authoritative source.

Freshness rule:
- Checklist considered stale when project changed after `checklist.runAt` or snapshot hash mismatch.
- Outside studio, allow viewing checklist state; running checklist deep-links into Studio if needed.

## Local vs Production Parity
- Keep local provider hydration/sync flow aligned with Fly provider:
  - hydrate workspace from bucket
  - periodic sync to bucket
  - publish consumes bucket artifacts, not local workspace path assumptions
- Avoid local-only behavior differences in publish/preview logic.

## Implementation Plan

### Phase A: API and Metadata Contract
1. Add/standardize artifact readiness contract (preview/source/published metadata, commit/hash semantics).
2. Add backend procedure to query publishable artifact state (`ready`, hash, builtAt, source kind).
3. Add backend checklist read endpoint for publish UIs (with freshness info).
4. Add backend publish-state fields for unsaved-change hinting (`studioRunning`, sync hash, publishable hash).

### Phase B: Bucket-First Publish Pipeline
1. Refactor `PublishService.publish` to read from bucket artifact, not `getVersionDir`.
2. Materialize artifact to `/srv/published/<slug>` for Caddy.
3. Keep `published/` bucket artifact in sync and store published hash/commit in DB.
4. Add readiness/CAS checks and race-safe failure modes.

### Phase C: Bucket-First Preview Serving
1. Refactor `/api/preview/:slug/v:version` to determine serving mode from bucket metadata, not local `versionDir` inspection.
2. Remove local filesystem fallback path for preview in connected/production mode.
3. Keep explicit dev-only fallback behind flag if required.

### Phase D: Checklist DB Migration (Runtime)
1. Studio checklist mutations call backend to upsert checklist into `project_publish_checklist`.
2. Studio checklist queries read from backend DB in connected mode.
3. Remove `.vivd/publish-checklist.json` as source of truth.

### Phase E: Unified Publish UI
1. Add publish/unpublish controls to preview/dashboard using backend publish APIs.
2. Keep Studio publish control, but route through studio-server -> backend APIs.
3. Use non-technical labels (`Publish changes`, `Unpublish site`).
4. Display exact artifact being published and readiness state.
5. In connected mode, Studio publish dialog must show backend publish status (published URL/domain, version, publishedAt).
6. In connected mode, Studio publish dialog must include `Unpublish` action using backend API.
7. Add explicit warning when Studio has unsaved changes + CTA `Open Studio to save changes`.
8. Add deterministic dialog states: `Ready`, `Build in progress`, `Unsaved changes in Studio`.
9. Add conflict UX for `artifact_changed` (`Refresh status` + retry).
10. Add unpublish confirmation UX including domain/version affected.

### Phase F: Cleanup and Hardening
1. Remove remaining backend publish/preview reliance on local project directories.
2. Add publish lock + retry/backoff where needed.
3. Add audit logs for publish/unpublish/checklist actions.

## Validation & Acceptance Criteria
- `project.list` works with empty local `projects/` when DB + bucket are present.
- Preview endpoint serves fully from bucket artifacts (no local `versionDir` dependency in connected/prod mode).
- Publish succeeds with bucket artifact only; fails clearly when artifact not ready.
- Publishing from Studio and Dashboard yields identical backend behavior and output.
- In connected mode, Studio publish dialog shows real published URL/status from backend and supports unpublish.
- Publish dialogs outside Studio clearly warn on unsaved Studio changes and provide `Open Studio to save changes`.
- Publish dialog always shows artifact source + built time + short hash before confirm.
- Unpublish works without starting studio.
- Checklist status visible in publish UIs via DB; no file authority required.
- No regressions in Caddy routing and published domain lifecycle.

## Out of Scope
- Replacing Caddy local serving with direct bucket serving.
- Full multi-tenant org scoping redesign (handled in existing SaaS roadmap phases).

## Risks
- Transitional period where some routes still expect local dirs.
- Build metadata consistency across save/build/publish flows.
- Studio connected-mode API boundaries if publish is moved from local git-tag flow.

Mitigation:
- Gate behavior with explicit connected-mode checks.
- Add targeted integration tests for publish readiness and preview serving.
- Roll out in phases with feature flags where needed.
