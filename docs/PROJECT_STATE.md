# Vivd Project State (Condensed)

> Goal: run Vivd as a reliable multi-tenant SaaS with isolated studio machines, object-storage-backed projects, and predictable publish/preview flows.

## Current Status

- Architecture split is in place: control plane (`packages/backend`) and isolated studio runtime (`packages/studio`).
- Bucket-first runtime is active for source, preview, and publish flows.
- Fly studio orchestration is production-ready for core lifecycle paths (start, suspend, reconcile, image rollout).
- OpenCode revert/restore reliability is currently being debugged with trigger-driven (non-periodic) OpenCode sync for `opencode.db*` + `storage/session_diff` on Fly.
- Superadmin machine operations are live (machine list/reconcile/destroy + image selector with semver and `dev-*` tags).
- Multi-org auth and tenant scoping are implemented across core control-plane paths.

## Progress Log

- 2026-02-22: drafted superadmin project-transfer implementation plan in `docs/superadmin-project-transfer-plan.md`, covering org-to-org transfer (including create-new-org flow), project-scoped DB cutover strategy, bucket-prefix migration, safety constraints, and rollout/test plan.
- 2026-02-22: normalized API surface naming across packages to reduce `routers/` vs `routes/` ambiguity: backend now uses `packages/backend/src/trpcRouters/` (tRPC) and `packages/backend/src/httpRoutes/` (Express HTTP), studio server tRPC modules moved to `packages/studio/server/trpcRouters/`, and scraper HTTP route modules moved to `packages/scraper/src/httpRoutes/`; updated backend/studio/scraper imports and affected tests accordingly.
- 2026-02-22: extracted large inline HTTP runtime handlers from entrypoints into explicit route modules to align with the naming split: backend preview/upload/download handlers moved from `packages/backend/src/server.ts` into `packages/backend/src/httpRoutes/projectRuntime.ts`, and studio runtime HTTP handlers moved from `packages/studio/server/index.ts` into `packages/studio/server/httpRoutes/runtime.ts` (with dependency-injected auth/path helpers to preserve behavior).
- 2026-02-22: made scraper builds clean output before compile (`packages/scraper/package.json`: `build` now runs `rm -rf dist && tsc`) so stale legacy `dist/routes/*` artifacts are not carried across naming migrations.
- 2026-02-22: hardened Contact Form submit abuse protection with human-friendly defaults: added per-token and per-IP burst limiting, a minimum repeat interval block (default 2s), and short-window duplicate-payload no-op handling in `packages/backend/src/httpRoutes/plugins/contactForm/submit.ts`; thresholds are env-tunable via `VIVD_CONTACT_FORM_MIN_REPEAT_SECONDS`, `VIVD_CONTACT_FORM_RATE_LIMIT_PER_IP_PER_MINUTE`, `VIVD_CONTACT_FORM_RATE_LIMIT_PER_TOKEN_PER_MINUTE`, and `VIVD_CONTACT_FORM_DUPLICATE_WINDOW_SECONDS`.
- 2026-02-22: documented Contact Form anti-abuse configuration knobs in `.env.example` (with default values and `0` disable semantics) so operators can discover tuning options without reading source.
- 2026-02-22: extended Contact Form anti-abuse defaults with additional low-friction checks: per-IP/per-token hourly caps, submission size caps (total + per-field), and max-link spam heuristics; all are env-tunable and documented in `.env.example`.
- 2026-02-22: strengthened Phase 2 backend business-service tests with behavior that guards real regressions: `packages/backend/test/limits_service.test.ts` now covers org-specific overrides, unlimited-zero semantics, and env fallback on DB read failures; `packages/backend/test/usage_service.test.ts` now covers error-swallowing on session-title updates and OpenRouter/image idempotency-key write semantics.
- 2026-02-22: extended Phase 2 OpenCode runtime hardening with `packages/studio/server/opencode/index.sessions.test.ts`, covering directory-scoped session filtering, backend/emitter status merge precedence, and abort side-effects (`idle` status + completion event emission).
- 2026-02-22: expanded Phase 2 Studio routing hardening with new behavior-focused router suites: `packages/studio/server/trpcRouters/project.router.test.ts` (connected shareable-preview URL resolution + dev-server lifecycle guards) and `packages/studio/server/trpcRouters/agent.router.test.ts` (workspace initialization gating, model-validation handoff, and session operation delegation).
- 2026-02-22: started closing Phase 3 scraper gaps with `packages/scraper/src/services/openrouter.test.ts`, adding meaningful checks for no-key short-circuit behavior, JSON parsing of model output, capped prioritization, and deterministic fallback on upstream failure.
- 2026-02-22: expanded Phase 3 scraper route hardening with new `packages/scraper/src/httpRoutes/findLinks.test.ts` and `packages/scraper/src/httpRoutes/screenshot.test.ts` suites, covering route validation, fallback navigation mode, link dedupe/filtering/max caps, screenshot max-capture behavior, and unhealthy-browser release on classified failures.
- 2026-02-22: expanded Phase 3 frontend routing confidence with `packages/frontend/src/app/router/guards.test.tsx`, covering auth redirect behavior, wrong-tenant control-plane fallback URL scheme selection, assigned-project enforcement for client editors, and single-project/dashboard redirects.
- 2026-02-22: expanded Phase 3 superadmin UI coverage with `packages/frontend/src/components/admin/machines/MachinesTab.test.tsx`, covering provider error display, stats rendering, refresh/refetch wiring, empty-state behavior, and reconcile confirmation flow mutation trigger.
- 2026-02-22: expanded scraper service resilience coverage with `packages/scraper/src/services/scraper.test.ts`, adding regression checks for navigation-failure classification and validation-error propagation while still returning collected content.
- 2026-02-22: added `packages/frontend/src/pages/EmbeddedStudio.test.tsx` to lock down project-loading guard states (loading, query-error, and missing-project paths) so studio shell regressions fail fast.
- 2026-02-22: strengthened `packages/scraper/src/httpRoutes/fullScrape.test.ts` with a no-OpenRouter-key branch check to ensure the route deterministically skips header-vision/subpage enrichment and still returns the primary page scrape.
- 2026-02-22: added `packages/studio/server/opencode/serverManager.missingBinary.test.ts` to verify `serverManager` fails fast with an explicit operator-facing message when the `opencode` CLI is unavailable, preventing ambiguous startup failures.
- 2026-02-22: completed the remaining Phase 2 backend router hardening slice by adding `packages/backend/test/organization_router.test.ts` (tenant-host mapping behavior and active-org selection safety around pinned domains, membership, suspended orgs, and superadmin override path).
- 2026-02-22: advanced Phase 2 test hardening with new control-plane router tests focused on behavior (not coverage-only): `packages/backend/test/usage_router.test.ts` (defaults/delegation), `packages/backend/test/studio_api_router.test.ts` (usage/reporting mapping, resilient thumbnail trigger behavior, workspace-state/checklist semantics), and `packages/backend/test/superadmin_router.test.ts` (Fly provider/image-option edge cases and plugin entitlement ensure/skip paths).
- 2026-02-22: shipped Phase 1 superadmin-managed Contact Form plugin entitlements end-to-end: DB table/migration (`plugin_entitlement`, `packages/backend/drizzle/0016_plugin_entitlements.sql`), entitlement service + APIs (`pluginsListAccess`, `pluginsUpsertEntitlement`, `pluginsBulkSetForOrganization`), and runtime gating in `plugins.contactEnsure` + public submit path.
- 2026-02-22: finalized plugin activation ownership model: project-level `Enable Contact Form` was removed, activation is now superadmin-only via Super Admin → Plugins, and project-level UI is guidance/config-only.
- 2026-02-22: consolidated settings/plugin surfaces onto shared shell conventions (tabs + bounded form widths) to reduce layout drift and simplify future settings work.
- 2026-02-22: completed project tag UX polish (project-card label placement + expanded color palette); tagging data model and API remain unchanged from the shipped tags feature.
- Full historical log moved to `docs/PROJECT_STATE_ARCHIVE.md`.

## Current Priorities

- [ ] Implement superadmin project-transfer flow (existing target org + create-new-org path) with DB cutover and bucket-prefix migration, per `docs/superadmin-project-transfer-plan.md`.
- [ ] Add Phase 4 E2E smoke coverage (lean PR suite + nightly/pre-release full suite) now that the current Phase 2/3 checklist targets are covered.
- [ ] Fix known failing Fly integration: `packages/backend/test/integration/fly_opencode_rehydrate_revert.test.ts` (expected red currently; revert-after-rehydrate path still broken).
- [ ] Complete remaining plugin-system Phase 1 follow-through: inbox/read path UX + operator workflow hardening around entitlements (self-serve/request flow still pending).
- [ ] Validate lifecycle sync hardening in real Fly runs (stop/destroy/warm-reconcile + trigger-driven sync under larger workspace/opencode payloads).
- [ ] Finish object-storage source-of-truth migration in backend (remove remaining local-FS assumptions).
- [ ] Complete email-based auth flows (invite-only signup, self-service password reset, SES integration).
- [ ] Add missing control-plane hardening (audit log, monitoring, rate limiting, abuse controls).
- [ ] Implement billing primitives (Stripe products/prices/webhooks + subscription UX).
- [ ] Finalize build strategy and preview artifact contract (build location, signed vs public artifact access).

## Concrete Test Hardening Plan

### Baseline (2026-02-21)

- Backend statement coverage: `9.14%` (`packages/backend/src/**`).
- Studio statement coverage: `1.56%` (`packages/studio/**`).
- Frontend statement coverage: `1.02%` (`packages/frontend/**`).
- Scraper statement coverage: `5.76%` (`packages/scraper/src/**`).

### Phase 1 (Critical Runtime Safety)

- Backend auth/context + procedure gating:
  - `packages/backend/src/trpc.ts`
  - Cases: host-pinned org, unknown-host fallback, bearer session fallback, role gating (`protected/org/orgAdmin/projectMember/superAdmin`).
- Backend publish correctness:
  - `packages/backend/src/trpcRouters/project/publish.ts`
  - `packages/backend/src/services/publish/PublishService.ts`
  - Cases: studio-unsaved/older-snapshot conflicts, domain allowlist denial, artifact readiness conflicts, commit mismatch, caddy update + DB upsert/unpublish.
- Backend import safety:
  - `packages/backend/src/httpRoutes/import.ts`
  - Cases: org access denial, pinned-domain org override rejection, symlink archive rejection, root detection, imported artifact sync behavior.
- Studio workspace + sync fundamentals:
  - `packages/studio/server/workspace/WorkspaceManager.ts`
  - `packages/studio/server/services/sync/ArtifactSyncService.ts`
  - Cases: save/discard transitions, commit hash/state reporting, source/opencode sync trigger behavior and failure handling.

### Phase 2 (Control Plane and Studio Reliability)

- Backend organization/superadmin/usage routers (completed 2026-02-22):
  - [x] `packages/backend/src/trpcRouters/organization.ts`
  - [x] `packages/backend/src/trpcRouters/superadmin.ts`
  - [x] `packages/backend/src/trpcRouters/studioApi.ts`
  - [x] `packages/backend/src/trpcRouters/usage.ts`
- Backend business services (completed 2026-02-22):
  - [x] `packages/backend/src/services/usage/LimitsService.ts`
  - [x] `packages/backend/src/services/usage/UsageService.ts`
  - [x] `packages/backend/src/services/plugins/ProjectPluginService.ts`
- Studio routing/agent flows:
  - [x] `packages/studio/server/trpcRouters/project.ts`
  - [x] `packages/studio/server/trpcRouters/agent.ts`
  - [x] `packages/studio/server/opencode/serverManager.ts`
  - [x] `packages/studio/server/opencode/index.ts`

### Phase 3 (UI and Scraper End-to-End Confidence)

- Frontend RTL tests for high-impact flows:
  - [x] `packages/frontend/src/app/router/guards.tsx`
  - [x] `packages/frontend/src/components/projects/publish/PublishSiteDialog.tsx`
  - [x] `packages/frontend/src/pages/EmbeddedStudio.tsx`
  - [x] `packages/frontend/src/components/admin/machines/MachinesTab.tsx`
  - [x] `packages/frontend/src/components/projects/listing/ProjectsList.tsx`
- Scraper route + service tests:
  - [x] `packages/scraper/src/httpRoutes/fullScrape.ts`
  - [x] `packages/scraper/src/services/scraper.ts`
  - [x] `packages/scraper/src/services/openrouter.ts`
  - [x] `packages/scraper/src/httpRoutes/findLinks.ts`
  - [x] `packages/scraper/src/httpRoutes/screenshot.ts`

### Phase 4 (Critical E2E Smoke)

- Scope: only high-value cross-service flows that lower-level tests cannot fully validate.
- Initial scenarios:
  - auth + organization resolution on control-plane host vs tenant-pinned host
  - project creation/generation to reachable preview URL
  - studio edit flow where unsaved changes block publish, then save allows publish
  - publish/unpublish lifecycle and served-domain behavior
  - plugin contact submit to inbox/read path (after submit endpoint lands)
- Run cadence:
  - PR: run 2-3 fast E2E smoke tests
  - nightly/pre-release: run the full E2E smoke matrix

### First Wave Status (Complete)

- The initial hardening wave is complete across backend/studio/frontend/scraper for auth/context, publish/import safety, usage/plugins, workspace/sync, and scraper success/error behavior.
- Detailed per-test checklist history is preserved in `docs/PROJECT_STATE_ARCHIVE.md`.

## Consolidated Completed Milestones

- Studio runtime: standalone package extraction, connected/standalone operation, bucket hydration/sync, bucket-backed preview.
- Fly machines: machine reuse, warm reconciliation, stale cleanup, image drift handling, performance and cold-start resilience.
- Plugins: Contact Form runtime + public submit path, superadmin-managed entitlements (`plugin_entitlement`), and superadmin-only activation flow.
- Projects dashboard: project tags shipped end-to-end (`project_meta.tags`, `project.updateTags`, card display/edit, list filtering).
- Test hardening: Phase 1 first-wave critical-path coverage delivered; follow-on depth/smoke layers remain active priorities.
- Agent/editor reliability: OpenCode `1.2.6` upgrade, revert/unrevert integration testing, selector-mode and streaming UX fixes.
- OpenCode storage cleanup: bucket sync narrowed to `opencode/storage`, legacy `opencode/opencode/storage` compatibility migration, stale non-storage key cleanup.
- Control plane: tenant scoping, project/usage limits, bucket isolation, publish-domain governance rollout.
- Auth/admin: superadmin organization/machine management, multi-org membership and active-org switching.

## Open Decisions

| Question | Status |
|---|---|
| Fly app strategy (single app vs app-per-tenant) | TBD |
| Concurrency model for edits (single-writer lock vs optimistic) | TBD |
| Build execution location (backend vs studio vs dedicated builder) | TBD |
| Preview artifact exposure (public vs signed URLs) | TBD |
| Studio URL pattern (iframe route vs redirect vs subdomain) | TBD |
| Project-transfer semantics: require unpublished in v1 and move usage-history rows by default? | TBD |

## Operational Notes

- OpenCode bucket sync (current test mode) writes `opencode.db*` plus `storage/session_diff` under `tenants/<tenant>/projects/<slug>/opencode/`; `snapshot/` and auth/cache/log artifacts remain excluded.
- Legacy fallback is still supported for hydrate from `.../opencode/opencode/storage/` to avoid data loss during transition.
- Dev image workflow:
  - Push: `./scripts/push-studio.sh [dev-tag]`
  - Cleanup `dev-*` GHCR tags: `./scripts/delete-ghcr-dev-images.sh` (dry-run default, add `--apply` to delete)

## Related Documents

- `docs/superadmin-project-transfer-plan.md`
- `docs/refactoring-day-checklist.md`
- `docs/old/publishing-bucket-first-plan.md`
- `docs/old/tenant-subdomain-domain-governance-plan.md`
- `docs/old/dokploy-traefik-wildcard-setup.md`
- `docs/PROJECT_STATE_ARCHIVE.md`

Last updated: 2026-02-22
