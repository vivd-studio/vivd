# Vivd Project State (Condensed)

> Goal: run Vivd as a reliable multi-tenant SaaS with isolated studio machines, object-storage-backed projects, and predictable publish/preview flows.

## Current Status

- Architecture split is in place: control plane (`packages/backend`) and isolated studio runtime (`packages/studio`).
- Bucket-first runtime is active for source, preview, and publish flows.
- Fly studio orchestration is production-ready for core lifecycle paths (start, suspend, reconcile, image rollout).
- OpenCode revert/restore reliability is restored by using OpenCode default storage layout and syncing only `opencode/storage`.
- Superadmin machine operations are live (machine list/reconcile/destroy + image selector with semver and `dev-*` tags).
- Multi-org auth and tenant scoping are implemented across core control-plane paths.

## Progress Log

- 2026-02-18: OpenCode object-storage sync narrowed to `opencode/storage` only (Fly entrypoint + local provider), with legacy read compatibility for `opencode/opencode/storage` and cleanup of stale non-storage OpenCode objects.
- 2026-02-18: added `scripts/delete-ghcr-dev-images.sh` helper to list/delete GHCR container versions with `dev-` tags (dry-run default, `--apply` to execute).
- 2026-02-18: fixed Fly revert/session-diff tracking by aligning studio OpenCode storage path with OpenCode default storage and removing forced `XDG_DATA_HOME` overrides.
- 2026-02-18: superadmin machine image selector shipped (semver + `dev-*` tags from GHCR with persisted override).
- 2026-02-17: OpenCode Vertex support re-enabled (project/location credentials wiring for studio entrypoint + machine env handling).
- 2026-02-17: added Fly+bucket shutdown/restart integration coverage for source/opencode sync (`packages/backend/test/integration/fly_shutdown_bucket_sync.test.ts`).
- Full historical log moved to `docs/PROJECT_STATE_ARCHIVE.md`.

## Current Priorities

- [ ] Close machine lifecycle reliability gaps (especially failing stop/destroy/warm-reconcile sync integration case).
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

- OpenCode bucket sync target should be `tenants/<tenant>/projects/<slug>/opencode/storage/`.
- Legacy fallback is still supported for hydrate from `.../opencode/opencode/storage/` to avoid data loss during transition.
- Dev image workflow:
  - Push: `./scripts/push-studio.sh [dev-tag]`
  - Cleanup `dev-*` GHCR tags: `./scripts/delete-ghcr-dev-images.sh` (dry-run default, add `--apply` to delete)

## Related Documents

- `docs/refactoring-day-checklist.md`
- `docs/publishing-bucket-first-plan.md`
- `docs/tenant-subdomain-domain-governance-plan.md`
- `docs/dokploy-traefik-wildcard-setup.md`
- `docs/PROJECT_STATE_ARCHIVE.md`

Last updated: 2026-02-18
