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

- 2026-02-21: restored missing backend domain-service unit coverage at `packages/backend/test/domain_service.test.ts` (reserved organization slug validation).
- 2026-02-21: maintainability cleanup pass completed for onboarding + boundaries: rewrote root/agent docs for current package layout (`README.md`, `AGENTS.md`, `packages/frontend/README.md`), removed unsafe/invalid migration/client-gen scripts (`db:push`, stale `gen:client`), moved frontend tRPC type import off ad-hoc `@backend/*` alias to a curated backend type export (`packages/backend/src/trpcTypes.ts`), and removed backend runtime patching duplicates/tests so patching ownership is studio-only.
- 2026-02-21: started Fly provider modularization by extracting drift/metadata/reconcile-config helpers into `packages/backend/src/services/studioMachines/fly/machineModel.ts`; `provider.ts` now delegates to the new module, and reconcile drift coverage now targets the extracted helper directly (`packages/backend/test/fly_provider_reconcile.test.ts`).
- 2026-02-21: continued Fly provider modularization by extracting startup/restart/create workflows to `packages/backend/src/services/studioMachines/fly/runtimeWorkflow.ts` and warm/batch reconcile workflows to `packages/backend/src/services/studioMachines/fly/reconcileWorkflow.ts`; added characterization coverage in `packages/backend/test/fly_provider_orchestration.test.ts` (dedupe, hard-restart inflight gating, create payload, warm-reconcile guardrails).
- 2026-02-21: added OpenCode custom-tool provisioning in the Studio runtime (starts with a `vivd_test` tool) to enable future agent-callable Vivd plugin operations.
- 2026-02-21: validated Studio agent custom-tool invocation end-to-end in local connected-mode (`vivd_test` returns org/project-scoped output).
- 2026-02-21: documented `vivd_test` as temporary bootstrap tooling in plugin-system planning; remove it after `vivd_plugins_*` tools are implemented and validated.
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

- [ ] Validate lifecycle sync hardening in real Fly runs (stop/destroy/warm-reconcile + trigger-driven sync under larger workspace/opencode payloads).
- [ ] Finish object-storage source-of-truth migration in backend (remove remaining local-FS assumptions).
- [ ] Complete email-based auth flows (invite-only signup, self-service password reset, SES integration).
- [ ] Add missing control-plane hardening (audit log, monitoring, rate limiting, abuse controls).
- [ ] Implement billing primitives (Stripe products/prices/webhooks + subscription UX).
- [ ] Finalize build strategy and preview artifact contract (build location, signed vs public artifact access).

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

Last updated: 2026-02-21
