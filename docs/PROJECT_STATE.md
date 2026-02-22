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

- 2026-02-22: simplified Contact Form plugin configuration UX by removing honeypot-field customization from project settings (runtime now uses fixed `_honeypot` to match generated snippets), and clarified redirect/source-host behavior in the Plugins UI; submit redirect handling now falls back to `sourceHosts` when `redirectHostAllowlist` is empty (while still disabling redirects when both lists are empty).
- 2026-02-22: split plugin service internals into scoped modules: moved generic plugin-instance persistence/idempotency logic into `packages/backend/src/services/plugins/core/instanceService.ts` and moved contact-form-specific orchestration into `packages/backend/src/services/plugins/contactForm/service.ts`, while keeping `packages/backend/src/services/plugins/ProjectPluginService.ts` as the stable facade for existing router/tool callers.
- 2026-02-22: split backend tRPC plugin management router into plugin-scoped modules under `packages/backend/src/routers/plugins/` (`catalog.ts`, `contactForm.ts`, `index.ts`) so adding future plugins does not bloat a single `plugins.ts` router file.
- 2026-02-22: split public plugin routing into plugin-scoped route modules: moved contact-form submit endpoint and host validation helpers into `packages/backend/src/routes/plugins/contactForm/` and added aggregator router at `packages/backend/src/routes/plugins/index.ts`, keeping the external endpoint path unchanged (`/plugins/contact/v1/submit`).
- 2026-02-22: refactored plugin module layout to add a dedicated contact-form plugin folder under backend plugins (`packages/backend/src/services/plugins/contactForm/`) and moved contact-specific config, snippets, public-api helpers, and retention cleanup there to keep plugin boundaries clearer as more plugins are added.
- 2026-02-22: completed Contact Form MVP runtime wiring: added `plugins.contactUpdateConfig` backend mutation and project Plugins UI config fields (recipient emails, source hosts, redirect allowlist), wired public submit flow to send email notifications through provider-abstracted delivery (SES adapter + noop fallback/auto-detection), and added automatic contact submission retention cleanup with a 30-day default (`VIVD_CONTACT_FORM_RETENTION_DAYS`).
- 2026-02-22: refreshed Fly shutdown bucket-sync integration coverage in `packages/backend/test/integration/fly_shutdown_bucket_sync.test.ts` to match current runtime contracts: the test now pins `VIVD_OPENCODE_DATA_HOME` in machine env for deterministic OpenCode pathing, validates source + OpenCode marker sync under `storage/session_diff`, and keeps stop/destroy/trigger lifecycle coverage while using the explicit Fly Machines stop endpoint (provider-level `stop` may suspend). Removed warm-reconcile assertions from this bucket-sync suite because warm reconcile behavior is covered by the dedicated `packages/backend/test/integration/fly_reconcile_flow.test.ts`.
- 2026-02-21: improved local studio startup/sync behavior and start dedupe: local provider now deduplicates concurrent start requests per studio key (prevents duplicate cold boots during repeated Edit/start), local periodic object-storage sync now uses exact incremental reconciliation (delete stale keys + upload only changed files, with unchanged detection via per-object `vivd-sha256` metadata) instead of full prefix delete/reupload, local hydration now skips unchanged downloads and removes stale local files using a per-prefix sync manifest (`.vivd-sync-manifest.json`), and Embedded Studio now guards/disables rapid repeated Edit clicks while a start is already pending. Added targeted coverage in `packages/backend/test/local_provider_orchestration.test.ts`, `packages/backend/test/object_storage_sync_exact.test.ts`, and `packages/backend/test/object_storage_download_incremental.test.ts`.
- 2026-02-21: added compatibility migration `packages/backend/drizzle/0014_public_token_hash_compat.sql` to heal legacy plugin schema drift (`public_token_hash` previously `NOT NULL`) by dropping that requirement and enforcing `public_token` population/non-null, so plugin ensure flows pass on older dev databases without full DB reset.
- 2026-02-21: added a minimal project-level Plugins UI at `/vivd-studio/projects/:projectSlug/plugins` (`packages/frontend/src/pages/ProjectPlugins.tsx`) wired to `plugins.catalog`, `plugins.contactInfo`, and `plugins.contactEnsure`, enabling Contact Form activation and token/snippet retrieval for end-to-end public submit testing.
- 2026-02-21: completed Plugins navigation exposure across remaining entry points: studio toolbar overflow menus now include `Plugins` and route back to host app via `vivd:studio:navigate`, and dashboard project cards now include a `Plugins` action in the card overflow menu.
- 2026-02-21: added a local CI runner (`scripts/ci-local.sh`) with npm aliases (`ci:local`, `ci:local:integration`, `ci:local:full`, `ci:local:fly`) to run lint + workspace tests and optional DB/object-storage/Fly integration tiers using `.env` / `.env.local`.
- 2026-02-21: made public plugin API host routing environment-driven in Caddy (`{$VIVD_PUBLIC_PLUGIN_API_HOST:api.vivd.studio}`) and added compose env wiring for Caddy/backend (`VIVD_PUBLIC_PLUGIN_API_HOST`, `VIVD_PUBLIC_PLUGIN_API_BASE_URL`) so staging/prod can use different API hosts without editing the Caddyfile.
- 2026-02-21: added env-gated real-infrastructure hardening tests: backend DB integration coverage for plugin/usage idempotency (`packages/backend/test/integration/db_usage_plugin_services.test.ts`, flag `VIVD_RUN_DB_INTEGRATION_TESTS=1`) and studio object-storage integration coverage for source sync include/exclude/delete + build-meta updates (`packages/studio/server/services/sync/ArtifactSyncService.integration.test.ts`, flag `VIVD_RUN_ARTIFACT_SYNC_BUCKET_TESTS=1`).
- 2026-02-21: completed the First Wave backlog test additions across backend/studio/frontend/scraper with targeted coverage for `createContext` + `orgProcedure`, publish router/service conflict handling, import safety checks (pinned-org mismatch + symlink ZIP rejection), usage/limits threshold behavior, plugin ensure idempotency + unique-conflict recovery, Studio workspace save/discard transitions, Studio artifact-sync guardrails, frontend publish dialog state gating, and scraper full-pipeline success/error paths.
- 2026-02-21: implemented initial public plugin runtime routing split: added backend public endpoint `POST /plugins/contact/v1/submit` (`packages/backend/src/routes/plugins/contactForm/submit.ts`) and wired Caddy host-based routing for `api.localhost` (dev) plus `api.vivd.studio` (default Caddy config) so public plugin traffic is separated from internal `/vivd-studio/api/*`.
- 2026-02-21: extended the concrete test hardening roadmap with a Phase 4 critical E2E smoke layer for cross-service flows, using a small PR smoke subset and a fuller nightly/pre-release suite.
- 2026-02-21: added a concrete cross-repo test hardening plan focused on production-risk paths (auth/context resolution, publish/import safety, studio workspace/sync, and scraper pipeline behavior), with phased delivery and explicit first-wave targets.
- 2026-02-21: retired the bootstrap sanity tool after validating the real Studio custom tool path (`vivd_plugins_catalog`, `vivd_plugins_contact_info`); startup now also cleans stale legacy tool files.
- 2026-02-21: locked public plugin runtime endpoint base to dedicated external host `https://api.vivd.studio` (env override: `VIVD_PUBLIC_PLUGIN_API_BASE_URL`) so website-facing plugin traffic is separated from internal `/vivd-studio/api/*` management APIs.
- 2026-02-21: refactored Studio OpenCode tool provisioning for scale: moved tool logic into typed modules under `packages/studio/server/opencode/toolModules/`, added centralized registry/policy in `packages/studio/server/opencode/toolRegistry.ts`, replaced tool-level contact ensure/snippet actions with a single `vivd_plugins_contact_info` tool, wired per-start tool enable/disable into OpenCode config via `packages/studio/server/opencode/configPolicy.ts` (`VIVD_OPENCODE_TOOLS_ENABLE`, `VIVD_OPENCODE_TOOLS_DISABLE`, `VIVD_OPENCODE_TOOL_FLAGS`), and now pass role/plugin context from backend studio start/restart (`VIVD_ORGANIZATION_ROLE`, `VIVD_ENABLED_PLUGINS`).
- 2026-02-21: hardened plugin Phase-0 migration `packages/backend/drizzle/0013_abnormal_miracleman.sql` to be idempotent (`CREATE TABLE IF NOT EXISTS`, guarded FK creation, `CREATE INDEX IF NOT EXISTS`) so partially applied dev databases do not crash backend startup on `db:migrate`.
- 2026-02-21: started plugin-system Phase 0 implementation: added plugin persistence schema (`project_plugin_instance`, `contact_form_submission`) + migration `packages/backend/drizzle/0013_abnormal_miracleman.sql`, added backend plugin catalog/ensure/info service surface (`packages/backend/src/routers/plugins/index.ts`, `packages/backend/src/services/plugins/ProjectPluginService.ts`), added provider-agnostic email service contract scaffold (`packages/backend/src/services/integrations/EmailDeliveryService.ts`), and provisioned Studio OpenCode tools (`vivd_plugins_catalog`, `vivd_plugins_contact_info`) in `packages/studio/server/opencode/serverManager.ts` (with targeted backend/studio builds and backend plugin/email tests passing).
- 2026-02-21: refactored Studio OpenCode config enforcement into a dedicated policy module (`packages/studio/server/opencode/configPolicy.ts`) with unit coverage (`packages/studio/server/opencode/configPolicy.test.ts`) so future config overrides can be added declaratively.
- 2026-02-21: disabled the OpenCode built-in `question` tool for Studio agent sessions by enforcing `tools.question=false` in spawned server config (`packages/studio/server/opencode/serverManager.ts`), matching current frontend support.
- 2026-02-21: grouped service modules into domain subfolders to reduce root-level service sprawl: backend now uses `services/{project,publish,usage,integrations,storage,system}` (with existing `services/studioMachines/fly/*` modular split preserved), and studio server now uses `services/{sync,patching,project,integrations,reporting}`; imports were rewired and targeted backend/studio builds pass.
- 2026-02-21: restored missing backend domain-service unit coverage at `packages/backend/test/domain_service.test.ts` (reserved organization slug validation).
- 2026-02-21: maintainability cleanup pass completed for onboarding + boundaries: rewrote root/agent docs for current package layout (`README.md`, `AGENTS.md`, `packages/frontend/README.md`), removed unsafe/invalid migration/client-gen scripts (`db:push`, stale `gen:client`), moved frontend tRPC type import off ad-hoc `@backend/*` alias to a curated backend type export (`packages/backend/src/trpcTypes.ts`), and removed backend runtime patching duplicates/tests so patching ownership is studio-only.
- 2026-02-21: started Fly provider modularization by extracting drift/metadata/reconcile-config helpers into `packages/backend/src/services/studioMachines/fly/machineModel.ts`; `provider.ts` now delegates to the new module, and reconcile drift coverage now targets the extracted helper directly (`packages/backend/test/fly_provider_reconcile.test.ts`).
- 2026-02-21: continued Fly provider modularization by extracting startup/restart/create workflows to `packages/backend/src/services/studioMachines/fly/runtimeWorkflow.ts` and warm/batch reconcile workflows to `packages/backend/src/services/studioMachines/fly/reconcileWorkflow.ts`; added characterization coverage in `packages/backend/test/fly_provider_orchestration.test.ts` (dedupe, hard-restart inflight gating, create payload, warm-reconcile guardrails).
- 2026-02-21: further split Fly provider internals into focused modules: Fly Machines API transport/cache (`packages/backend/src/services/studioMachines/fly/apiClient.ts`), lifecycle polling/transition helpers (`packages/backend/src/services/studioMachines/fly/lifecycle.ts`), machine identity/lookup helpers (`packages/backend/src/services/studioMachines/fly/machineInventory.ts`), studio-image resolution/cache (`packages/backend/src/services/studioMachines/fly/imageResolver.ts`), and machine management workflows (`packages/backend/src/services/studioMachines/fly/managementWorkflow.ts`). `provider.ts` now delegates these concerns and remains behavior-compatible under characterization tests.
- 2026-02-21: extracted Fly environment/naming/instance-shape config into `packages/backend/src/services/studioMachines/fly/providerConfig.ts`, moved service normalization into `packages/backend/src/services/studioMachines/fly/machineModel.ts`, and rewired `provider.ts` to explicit workflow dependency wiring (dropping provider size to 643 LOC from 819 while keeping behavior checks green in `packages/backend/test/fly_provider_orchestration.test.ts` and `packages/backend/test/fly_provider_reconcile.test.ts`).
- 2026-02-21: extended plugin-system planning with a required provider-agnostic email delivery abstraction for contact form notifications so email providers can be swapped via adapters/config without plugin API or schema rewrites.
- 2026-02-21: made plugin-system plan execution-ready for kickoff: locked MVP scope decisions (project-level scoping, store+inbox baseline, custom-tools-first integration), added phased delivery breakdown, and documented “custom tools now, optional central `vivd-mcp` later” strategy (`docs/plugin-system-design.md`).
- 2026-02-20: refined website plugin system plan with clearer UI/agent exposure and studio↔bucket sync constraints (`docs/plugin-system-design.md`).
- 2026-02-19: GHCR studio image selection now filters tags by manifest readiness (not tag presence alone), so superadmin image options and latest-semver resolution exclude in-progress/unpullable workflow tags.
- 2026-02-19: updated studio-machine defaults: Fly idle suspend timeout increased to 10 minutes (`FLY_STUDIO_IDLE_TIMEOUT_MS=600000` default), and OpenCode idle server cleanup disabled on studio machines by default (`OPENCODE_IDLE_TIMEOUT_MS=0` in Fly/local machine env).
- 2026-02-19: removed `kill_timeout` from Fly machine drift detection/reconcile triggers to avoid unnecessary warm-reconcile updates; machine create/restart still sets `kill_timeout`.
- 2026-02-18: added root-level integration test runner shortcut (`npm run test:integration`) delegating to backend integration suite for easier full integration runs from repo root.
- 2026-02-18: backend test setup now auto-loads `.env*` files for integration runs (`packages/backend/test/setup.ts`) with backend-local-first + repo-root fallback (`.env.test.local`, `.env.test`, `.env.local`, `.env`).
- 2026-02-18: added opt-in Fly integration coverage for OpenCode rehydrate/revert flow (`packages/backend/test/integration/fly_opencode_rehydrate_revert.test.ts`) validating edit persistence across destroy/recreate and post-hydrate revert behavior.
- 2026-02-18: added bucket-sync trigger requests for non-agent studio edits (text saves, asset create/move/delete, uploads/dropped files, AI image edits/creates, and project patch/discard flows) so source/opencode sync runs after manual edits too.
- 2026-02-18: switched Fly studio bucket sync loop to trigger-only (no periodic interval); current test mode syncs/hydrates OpenCode `opencode.db*` plus `storage/session_diff` after agent-task triggers and on shutdown/final exit.
- 2026-02-18: OpenCode object-storage sync narrowed to `opencode/storage` only (Fly entrypoint + local provider), with legacy read compatibility for `opencode/opencode/storage` and cleanup of stale non-storage OpenCode objects.
- 2026-02-18: hardened studio bucket sync lifecycle: Fly machines now reconcile `kill_timeout` (configurable via `FLY_STUDIO_KILL_TIMEOUT_SECONDS`, default `180s`), studio entrypoint sync loop now supports immediate trigger-driven sync (`/tmp/vivd-sync.trigger`) and parallelized shutdown/final sync with budget warnings (`VIVD_SHUTDOWN_SYNC_BUDGET_SECONDS`), and agent completion now requests an immediate bucket sync. Added coverage in `packages/backend/test/fly_provider_reconcile.test.ts`, `packages/backend/test/integration/fly_shutdown_bucket_sync.test.ts` (new trigger scenario), and `packages/studio/server/opencode/runTask.bucketSync.test.ts`.
- 2026-02-18: added `scripts/delete-ghcr-dev-images.sh` helper to list/delete GHCR container versions with `dev-` tags (dry-run default, `--apply` to execute).
- 2026-02-18: fixed Fly revert/session-diff tracking by aligning studio OpenCode storage path with OpenCode default storage and removing forced `XDG_DATA_HOME` overrides.
- 2026-02-18: superadmin machine image selector shipped (semver + `dev-*` tags from GHCR with persisted override).
- 2026-02-17: OpenCode Vertex support re-enabled (project/location credentials wiring for studio entrypoint + machine env handling).
- 2026-02-17: added Fly+bucket shutdown/restart integration coverage for source/opencode sync (`packages/backend/test/integration/fly_shutdown_bucket_sync.test.ts`).
- Full historical log moved to `docs/PROJECT_STATE_ARCHIVE.md`.

## Current Priorities

- [ ] Execute phased test hardening plan across backend/studio/frontend/scraper, starting with auth + publish + import + workspace/sync critical paths.
- [ ] Add Phase 4 critical E2E smoke coverage for cross-service flows (lean PR suite + nightly/pre-release full suite).
- [ ] Move plugin-system into Phase 1: implement contact submit runtime endpoint + initial inbox read path on top of Phase 0 scaffolding.
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
  - `packages/backend/src/routers/project/publish.ts`
  - `packages/backend/src/services/publish/PublishService.ts`
  - Cases: studio-unsaved/older-snapshot conflicts, domain allowlist denial, artifact readiness conflicts, commit mismatch, caddy update + DB upsert/unpublish.
- Backend import safety:
  - `packages/backend/src/routes/import.ts`
  - Cases: org access denial, pinned-domain org override rejection, symlink archive rejection, root detection, imported artifact sync behavior.
- Studio workspace + sync fundamentals:
  - `packages/studio/server/workspace/WorkspaceManager.ts`
  - `packages/studio/server/services/sync/ArtifactSyncService.ts`
  - Cases: save/discard transitions, commit hash/state reporting, source/opencode sync trigger behavior and failure handling.

### Phase 2 (Control Plane and Studio Reliability)

- Backend organization/superadmin/usage routers:
  - `packages/backend/src/routers/organization.ts`
  - `packages/backend/src/routers/superadmin.ts`
  - `packages/backend/src/routers/studioApi.ts`
  - `packages/backend/src/routers/usage.ts`
- Backend business services:
  - `packages/backend/src/services/usage/LimitsService.ts`
  - `packages/backend/src/services/usage/UsageService.ts`
  - `packages/backend/src/services/plugins/ProjectPluginService.ts`
- Studio routing/agent flows:
  - `packages/studio/server/routers/project.ts`
  - `packages/studio/server/routers/agent.ts`
  - `packages/studio/server/opencode/serverManager.ts`
  - `packages/studio/server/opencode/index.ts`

### Phase 3 (UI and Scraper End-to-End Confidence)

- Frontend RTL tests for high-impact flows:
  - `packages/frontend/src/app/router/guards.tsx`
  - `packages/frontend/src/components/projects/publish/PublishSiteDialog.tsx`
  - `packages/frontend/src/pages/EmbeddedStudio.tsx`
  - `packages/frontend/src/components/admin/machines/MachinesTab.tsx`
  - `packages/frontend/src/components/projects/listing/ProjectsList.tsx`
- Scraper route + service tests:
  - `packages/scraper/src/routes/fullScrape.ts`
  - `packages/scraper/src/services/scraper.ts`
  - `packages/scraper/src/services/openrouter.ts`
  - `packages/scraper/src/routes/findLinks.ts`
  - `packages/scraper/src/routes/screenshot.ts`

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

### First Wave Backlog (Concrete)

- [x] Added backend tests for `createContext` and `orgProcedure` behavior matrix in `packages/backend/src/trpc.ts`.
- [x] Added router-level tests for publish conflict branches in `packages/backend/src/routers/project/publish.ts`.
- [x] Added service-level tests for publish lock + artifact readiness branches in `packages/backend/src/services/publish/PublishService.ts`.
- [x] Added import route tests for unsafe zip/org mismatch in `packages/backend/src/routes/import.ts`.
- [x] Added limits/usage tests for blocked state and threshold behavior in `packages/backend/src/services/usage/LimitsService.ts` and `packages/backend/src/services/usage/UsageService.ts`.
- [x] Added plugin service tests for idempotent ensure + unique-conflict recovery in `packages/backend/src/services/plugins/ProjectPluginService.ts`.
- [x] Added studio workspace save/discard tests in `packages/studio/server/workspace/WorkspaceManager.ts`.
- [x] Added studio artifact sync/hydration tests in `packages/studio/server/services/sync/ArtifactSyncService.ts`.
- [x] Added frontend publish dialog behavior tests in `packages/frontend/src/components/projects/publish/PublishSiteDialog.tsx`.
- [x] Added scraper full pipeline error/success tests in `packages/scraper/src/routes/fullScrape.ts`.

## Consolidated Completed Milestones

- Studio runtime: standalone package extraction, connected/standalone operation, bucket hydration/sync, bucket-backed preview.
- Fly machines: machine reuse, warm reconciliation, stale cleanup, image drift handling, performance and cold-start resilience.
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

## Operational Notes

- OpenCode bucket sync (current test mode) writes `opencode.db*` plus `storage/session_diff` under `tenants/<tenant>/projects/<slug>/opencode/`; `snapshot/` and auth/cache/log artifacts remain excluded.
- Legacy fallback is still supported for hydrate from `.../opencode/opencode/storage/` to avoid data loss during transition.
- Dev image workflow:
  - Push: `./scripts/push-studio.sh [dev-tag]`
  - Cleanup `dev-*` GHCR tags: `./scripts/delete-ghcr-dev-images.sh` (dry-run default, add `--apply` to delete)

## Related Documents

- `docs/refactoring-day-checklist.md`
- `docs/old/publishing-bucket-first-plan.md`
- `docs/old/tenant-subdomain-domain-governance-plan.md`
- `docs/old/dokploy-traefik-wildcard-setup.md`
- `docs/PROJECT_STATE_ARCHIVE.md`

Last updated: 2026-02-22
