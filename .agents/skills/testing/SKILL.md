---
name: testing
description: Use when deciding how to validate a Vivd change, choosing the highest-signal tests for backend/frontend/studio/self-host/Fly work, or debugging why local, CI, release-smoke, or production-shaped verification is failing.
---

# Testing

Use this skill when a change needs validation, when a failure only appears in CI/release smokes, or when you need to decide which tests are worth running in this repo.

## Quick Workflow

1. Start with the smallest proof that matches the change:
   - targeted `vitest` file(s) for one module or behavior
   - package `typecheck` for the touched workspace
   - only then broader package/root checks if the change crosses boundaries
2. Prefer the repo's critical regressions over blanket suites. This monorepo has a lot of broad coverage, but a smaller set of tests protects the risky product paths.
3. If the change touches Fly/Docker/self-host/release behavior, move quickly from unit coverage to the relevant smoke or integration path instead of assuming unit tests are enough.
4. Keep the real contract strict. Do not weaken behavior checks like `suspended`, wake thresholds, auth invariants, or routing expectations just to get green.
5. If deployed-instance debugging would materially help, use logs and SSH only when the user provides the host/access details in the conversation. Do not store raw server IPs or private access details in repo docs or skills.

## Fast Test Ladder

- Repo-wide typecheck: `npm run typecheck`
- Common unit/regression baseline: `npm run test:run`
- Studio-only tests: `npm run test:run -w @vivd/studio`
- Backend unit-only: `npm run test:unit -w @vivd/backend`
- Backend integration entrypoint: `npm run test:integration -w @vivd/backend -- <test-file>`
- Local CI wrapper: `npm run ci:local`

During multi-file work, prefer repeating package-level `typecheck` and a few targeted files instead of waiting until the end for a full repo sweep.

## Highest-Signal Tests

- Studio runtime/auth/cleanup regressions:
  - `npm run test:run -w @vivd/studio -- server/http/studioAuth.test.ts server/httpRoutes/runtime.test.ts client/src/components/chat/ChatContext.followup.test.tsx`
- Studio OpenCode persistence/revert regressions:
  - `npm run test:run -w @vivd/studio -- server/opencode/useEvents.test.ts server/opencode/index.sessions.test.ts server/opencode/runTask.bucketSync.test.ts`
  - `STUDIO_IMAGE=vivd-studio:local npm run studio:image:revert-smoke`
- Backend Studio runtime auth + machine drift regressions:
  - `npm run test:run -w @vivd/backend -- studio_api_router.test.ts trpc_context_org_procedure.test.ts fly_lifecycle.test.ts fly_provider_reconcile.test.ts fly_provider_orchestration.test.ts docker_provider.test.ts local_provider_orchestration.test.ts`
- Frontend embedded/hosted Studio regressions:
  - `npm run test:run -w @vivd/frontend -- src/app/router/guards.test.tsx src/hooks/useStudioHostRuntime.test.ts src/pages/EmbeddedStudio.test.tsx`
- Local Docker/self-host browser smoke:
  - `STUDIO_IMAGE=vivd-studio:local npm run studio:host-smoke`
- Release-tag local preflight:
  - `npm run publish:tag -- --dry-run <version>`

These are the strongest default checks when touching auth, Studio boot/wake behavior, runtime routing, host embedding, or release-critical image paths.

## Env-Gated Integration Tests

Some of the most valuable tests only run when the required infra env is present.

- DB-backed backend integration:
  - requires `DATABASE_URL`
  - enable path: `VIVD_RUN_DB_INTEGRATION_TESTS=1`
  - common entry: `npm run test:integration -w @vivd/backend -- test/integration/db_usage_plugin_services.test.ts`
- Bucket/object-storage integration:
  - requires `VIVD_S3_BUCKET` or `R2_BUCKET`
  - enable path: `VIVD_RUN_ARTIFACT_SYNC_BUCKET_TESTS=1`
  - common entry: `npm run test:run -w @vivd/studio -- server/services/sync/ArtifactSyncService.integration.test.ts`
- Fly integration:
  - requires `FLY_API_TOKEN` and `FLY_STUDIO_APP`
  - default drift baseline today is `v1.1.51-repro.2` through `VIVD_FLY_TEST_DRIFT_IMAGE` / `VIVD_FLY_RECONCILE_BASELINE_TAG`
  - critical files:
    - `test/integration/fly_reconcile_flow.test.ts`
    - `test/integration/fly_warm_wake_auth.test.ts`
    - `test/integration/fly_shutdown_bucket_sync.test.ts`
    - `test/integration/fly_opencode_rehydrate_revert.test.ts`

Use `scripts/ci-local.sh` when you want the repo's supported combinations instead of hand-assembling env flags.

## Release And Smoke Surfaces

- Shared CI gate lives in `.github/workflows/reusable-validate.yml`.
- Release preflight lives in `scripts/publish.sh`.
- Image/browser smokes live in:
  - `scripts/studio-image-smoke.mjs`
  - `scripts/studio-image-revert-smoke.mjs`
  - `scripts/studio-docker-host-smoke.mjs`
  - `scripts/backend-image-smoke.mjs`
  - `scripts/scraper-image-smoke.mjs`

When a change affects startup, publish, Studio machine lifecycle, or self-host behavior, read the relevant script before changing tests. In this repo, those scripts often encode the real product contract more accurately than a quick assumption.

## Hard Parts

- Fly tests are real-behavior tests, not mocks with a Fly-shaped name. They are sensitive to warm-vs-cold boot, runtime quiesce, API rate limits, stale machines, and image drift.
- Docker/self-host verification often needs browser-level smoke coverage because failures appear after startup, auth handoff, or runtime URL selection, not in isolated helpers.
- Studio/OpenCode flows can fail because the harness is wrong, not because product behavior is wrong. Keep an eye on startup races, cleanup timing, and visibility/session-sync edge cases.
- Clean CI can fail when local builds passed if workspace alias resolution or package build assumptions leaked into test config.
- Release-image behavior can differ from local source-tree behavior. For image problems, compare the image/smoke path directly instead of assuming source diffs tell the whole story.

## Deployed Debugging

If a bug only reproduces on a hosted or self-host testing instance, use the lowest-risk production-shaped path that can answer the question:

1. product/admin UI evidence
2. application logs
3. container/service state
4. SSH to the host or VPS, if the user explicitly provides access details

Useful things to inspect on a deployed box include service/container status, recent backend/studio/caddy logs, configured image tags, env drift, and whether the running version matches the intended release. Keep any repo guidance generic: mention the need for SSH/VPS access, but do not bake hostnames, IPs, usernames, or secrets into the skill.

## References

- Read [references/test-surfaces.md](references/test-surfaces.md) for the longer map of test commands, dependencies, and recurring failure patterns.
- Read `.agents/skills/fly-studio-machines/SKILL.md` as a companion when the testing problem is specifically about Fly machine wake/reconcile/auth behavior.
- Read `.agents/skills/studio-runtime-debugging/SKILL.md` as a companion when the testing problem is specifically about Studio runtime bootstrap, host smoke, OpenCode-backed persistence, rehydrate, or revert behavior.
